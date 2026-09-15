#!/usr/bin/env bun
/**
 * harvest-queries — build a retrieval test collection from real agent transcripts.
 *
 * The measurement in `grep-hygiene.ts` assumed its own relevance judgment ("prose is noise").
 * That assumption is the thing under study, so it cannot also be the instrument. This builds the
 * judgment from behaviour instead: when an agent searched for X and then opened file F, F is
 * evidence that F was relevant to X. Weak evidence per event, useful in aggregate — the same
 * click-through logic search engines have used for decades.
 *
 * Output is a corpus of {query, repo, answeredBy[]} — the (query, document, relevance) triples
 * that IR calls a test collection and that this project previously had none of.
 *
 * Usage: bun harvest-queries.ts [--out corpus/queries.json] [--limit N]
 *
 * PRIVACY: the corpus contains real queries and paths from private repositories. It is written
 * under corpus/, which is gitignored. Only aggregates should ever be published.
 */

import { randomUUID } from "node:crypto";
import {
  chmodSync, closeSync, constants, existsSync, fchmodSync, linkSync, lstatSync, mkdirSync,
  mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { HDERIVE_VERSION, deriveHints } from "./hint-derive.ts";

/** This checkout, whose gitignored `corpus/` is the only place private output may land. */
export const HARVEST_ROOT = dirname(fileURLToPath(import.meta.url));

// ── shell parsing ─────────────────────────────────────────────────────────────

/** Quote-aware tokenizer. Not a shell — just enough to recover a search pattern. */
export function tokenize(cmd: string): string[] {
  const out: string[] = [];
  let cur = "", quote: string | null = null, has = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    if (quote) {
      if (c === "\\" && quote === '"' && i + 1 < cmd.length) { cur += cmd[++i]; has = true; }
      else if (c === quote) quote = null;
      else { cur += c; has = true; }
      continue;
    }
    if (c === '"' || c === "'") { quote = c; has = true; continue; }
    if (/\s/.test(c)) { if (has) { out.push(cur); cur = ""; has = false; } continue; }
    if (c === "\\" && i + 1 < cmd.length) { cur += cmd[++i]; has = true; continue; }
    cur += c; has = true;
  }
  if (has) out.push(cur);
  return out;
}

const SEARCH_CMD = new Set(["rg", "grep", "egrep", "ag", "ack", "ast-grep", "sg"]);
/** Flags that consume the following token, so it is not mistaken for the pattern. */
const FLAG_TAKES_VALUE = new Set([
  "-e", "--regexp", "-g", "--glob", "-t", "--type", "-m", "--max-count", "-A", "-B", "-C",
  "--lang", "-p", "--pattern", "-r", "--replace", "--iglob", "-f", "--file",
]);

/**
 * Recover the search pattern from a shell command. Returns every pattern found, since one
 * command may chain several searches with `|` or `&&`.
 */
/**
 * Split a command into pipeline/sequence segments WITHOUT breaking inside quotes.
 * Splitting the raw string first would turn `rg "foo|bar"` into `rg "foo` and silently harvest
 * `foo` as if it were the whole query.
 */
export function segments(cmd: string): string[] {
  const out: string[] = [];
  let cur = "", quote: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { quote = c; cur += c; continue; }
    if (c === "\\" && i + 1 < cmd.length) { cur += c + cmd[++i]; continue; }
    if (c === "|" || c === ";" || (c === "&" && cmd[i + 1] === "&")) {
      if (cmd[i + 1] === c) i++;
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function extractQueries(cmd: string): string[] {
  const found: string[] = [];
  for (const segment of segments(cmd)) {
    const tok = tokenize(segment);
    const at = tok.findIndex((t) => SEARCH_CMD.has(t.replace(/^.*\//, "")));
    if (at === -1) continue;
    let explicit: string | null = null, positional: string | null = null;
    for (let i = at + 1; i < tok.length; i++) {
      const t = tok[i]!;
      const longAttached = t.match(/^--(?:regexp|pattern)=(.*)$/s);
      if (longAttached) {
        explicit ??= longAttached[1] ?? null;
        continue;
      }
      const shortAttached = t.match(/^-[ep](.+)$/s);
      if (shortAttached) {
        explicit ??= shortAttached[1] ?? null;
        continue;
      }
      if (FLAG_TAKES_VALUE.has(t)) {
        // `-e PATTERN` / `-p PATTERN` name the pattern outright; other value-flags consume theirs.
        if (t === "-e" || t === "--regexp" || t === "-p" || t === "--pattern") explicit ??= tok[++i] ?? null;
        else i++;
        continue;
      }
      if (t.startsWith("-")) continue;
      positional ??= t;
    }
    const q = explicit ?? positional;
    if (q) found.push(q);
  }
  return found;
}

/**
 * A query is usable only if it is the kind of thing this project is about: a concept an agent
 * looked for. Regex metacharacters, paths and long boolean alternations are searches for syntax,
 * not for meaning, and would measure the regex engine rather than the repository.
 */
export function isConceptQuery(q: string): boolean {
  if (q.length < 3 || q.length > 40) return false;
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(q)) return false;
  if (/\.(ts|tsx|js|md|json|ya?ml|txt|sh|py)$/i.test(q)) return false; // a filename, not a concept
  if (/^-/.test(q)) return false;
  return true;
}

// ── transcript walk ───────────────────────────────────────────────────────────

type Event =
  | { kind: "search"; query: string; cwd: string; hints?: string[] }
  | { kind: "read"; path: string; cwd: string };

function hintsFromTask(task: string | null, query: string): string[] {
  if (task === null) return [];
  const title = task.split("\n", 1)[0] ?? "";
  const body = task.slice(title.length);
  return deriveHints(title, body, query);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Transcript rows that have the shape of a user message but whose text a human did not type.
 * Each was found in real transcripts passing the original type/userType/role/string filter
 * (2026-09-15): the prompt a parent agent writes for a subagent (`isSidechain`), skill bodies and
 * caveats (`isMeta`), compaction summaries (assistant prose), background-task notifications that
 * carry agent results, and captured command output. Issue 15 forbids all of them as task context.
 */
const INJECTED_USER_TEXT = /^\s*<(task-notification|local-command-stdout|local-command-stderr|local-command-caveat|bash-stdout|bash-stderr|system-reminder)>/;

/** The text of a message a human typed, or null for every other row. */
export function humanTaskText(row: unknown): string | null {
  if (!isRecord(row) || row["type"] !== "user" || row["userType"] !== "external") return null;
  if (row["isSidechain"] === true || row["isMeta"] === true || row["isCompactSummary"] === true) return null;
  const message = row["message"];
  if (!isRecord(message) || message["role"] !== "user" || typeof message["content"] !== "string") return null;
  // Newer transcripts label provenance directly; older ones carry neither field.
  if (isRecord(row["origin"]) && row["origin"]["kind"] !== "human") return null;
  if (row["promptSource"] === "system" || row["promptSource"] === "sdk") return null;
  if (INJECTED_USER_TEXT.test(message["content"])) return null;
  return message["content"];
}

/** Parse one transcript without ever treating assistant/tool content as task context. */
export function eventsFromTranscript(text: string, withHints = false): Event[] {
  const events: Event[] = [];
  let lastUserTask: string | null = null;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let d: unknown;
    try { d = JSON.parse(line); } catch { continue; }
    if (!isRecord(d)) continue;
    if (withHints) lastUserTask = humanTaskText(d) ?? lastUserTask;
    const cwd = d["cwd"];
    const message = d["message"];
    const content = isRecord(message) ? message["content"] : undefined;
    if (typeof cwd !== "string" || !cwd || !Array.isArray(content)) continue;
    for (const b of content as unknown[]) {
      if (!isRecord(b) || b["type"] !== "tool_use") continue;
      const input = isRecord(b["input"]) ? b["input"] : {};
      if (b["name"] === "Bash" && typeof input["command"] === "string") {
        for (const q of extractQueries(input["command"])) {
          if (isConceptQuery(q)) {
            events.push({
              kind: "search", query: q, cwd,
              ...(withHints ? { hints: hintsFromTask(lastUserTask, q) } : {}),
            });
          }
        }
      } else if ((b["name"] === "Read" || b["name"] === "Edit") && typeof input["file_path"] === "string") {
        events.push({ kind: "read", path: input["file_path"], cwd });
      }
    }
  }
  return events;
}

function eventsFrom(file: string, withHints = false): Event[] {
  try { return eventsFromTranscript(readFileSync(file, "utf8"), withHints); }
  catch { return []; }
}

/** How many reads after a search still count as "that search led here". */
const ATTRIBUTION_WINDOW = 3;

export type CorpusEntry = { query: string; repo: string; answeredBy: Record<string, number>; searches: number };
export type HintCorpusEntry = CorpusEntry & { hints: string[] };
export type HintCorpus = { hderive: typeof HDERIVE_VERSION; observations: HintCorpusEntry[] };

/** Resolve a transcript CWD to its nearest real Git checkout root, including worktrees. */
export function repositoryRootFromCwd(cwd: string): string | null {
  if (!existsSync(cwd)) return null;
  let cursor: string;
  try {
    cursor = realpathSync(cwd);
    if (!statSync(cursor).isDirectory()) return null;
  } catch {
    return null;
  }
  while (true) {
    const marker = join(cursor, ".git");
    if (existsSync(marker)) {
      const info = lstatSync(marker);
      if (info.isDirectory() || info.isFile()) return cursor;
    }
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

/** True when `candidate` is the root itself or a path inside it, with a real path boundary. */
export function pathIsWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** The preregistered observation unit: one real repository, lower-cased query, ordered hints. */
export function observationKey(repo: string, query: string, hints: readonly string[]): string {
  return `${repo}\0${query.toLowerCase()}\0${JSON.stringify(hints)}`;
}

export function harvest(files: string[], withHints = false): (CorpusEntry | HintCorpusEntry)[] {
  const byKey = new Map<string, CorpusEntry | HintCorpusEntry>();
  for (const f of files) {
    const events = eventsFrom(f, withHints);
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      if (e.kind !== "search") continue;
      const hints = withHints ? (e.hints ?? []) : [];
      const cwd = existsSync(e.cwd) ? realpathSync(e.cwd) : resolve(e.cwd);
      const repo = repositoryRootFromCwd(cwd) ?? cwd;
      const key = withHints
        ? observationKey(repo, e.query, hints)
        : `${repo}\0${e.query.toLowerCase()}`;
      const entry = byKey.get(key) ?? {
        query: e.query.toLowerCase(), repo,
        answeredBy: Object.create(null) as Record<string, number>, searches: 0,
        ...(withHints ? { hints } : {}),
      };
      entry.searches++;
      // The next few file opens in the same session are the behavioural relevance signal.
      let taken = 0;
      for (let j = i + 1; j < events.length && taken < ATTRIBUTION_WINDOW; j++) {
        const n = events[j]!;
        if (n.kind === "search") break; // a new search means the old one stopped driving reads
        if (n.cwd !== e.cwd) continue;
        const unresolved = isAbsolute(n.path) ? resolve(n.path) : resolve(cwd, n.path);
        // macOS exposes /var as /private/var, and transcript CWDs may also be symlink aliases.
        // Rebase an absolute logical path through the real CWD without resolving the answer itself:
        // later validation must still see and reject a symlinked file.
        const absolute = isAbsolute(n.path) && !pathIsWithin(repo, unresolved)
          ? resolve(cwd, relative(resolve(e.cwd), unresolved))
          : unresolved;
        const rel = relative(resolve(repo), absolute);
        if (rel.length === 0 || !pathIsWithin(resolve(repo), absolute)) {
          continue; // repo root or outside measurement
        }
        entry.answeredBy[rel] = (entry.answeredBy[rel] ?? 0) + 1;
        taken++;
      }
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()].filter((e) => Object.keys(e.answeredBy).length > 0);
}


// ── private output boundary ──────────────────────────────────────────────────

/** Private transcript output may only land under this checkout's real `corpus/` directory. */
export function privateCorpusPath(candidate: string, cwd = process.cwd()): { root: string; path: string } {
  if (!candidate) throw new Error("--out needs a path under corpus/");
  const root = resolve(cwd, "corpus");
  const path = resolve(cwd, candidate);
  if (path === root || !path.startsWith(root + sep)) {
    throw new Error(`private transcript output must stay under ${root}`);
  }
  return { root, path };
}

/** Write transcript-derived data without leaving it group/world-readable or following a symlink. */
export function writePrivateCorpus(candidate: string, data: string, cwd = process.cwd()): void {
  const { root, path } = privateCorpusPath(candidate, cwd);
  if (existsSync(root)) {
    const info = lstatSync(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`${root} must be a real directory`);
  } else {
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  chmodSync(root, 0o700);

  const parent = dirname(path);
  const nested = relative(root, parent).split(sep).filter(Boolean);
  let cursor = root;
  for (const component of nested) {
    cursor = join(cursor, component);
    if (existsSync(cursor)) {
      const info = lstatSync(cursor);
      if (!info.isDirectory() || info.isSymbolicLink()) {
        throw new Error(`private output parent ${cursor} must be a real directory`);
      }
    } else {
      mkdirSync(cursor, { mode: 0o700 });
    }
    chmodSync(cursor, 0o700);
  }
  const realRoot = realpathSync(root);
  const realParent = realpathSync(parent);
  if (realParent !== realRoot && !realParent.startsWith(realRoot + sep)) {
    throw new Error("private output parent escaped corpus/");
  }
  if (existsSync(path)) {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${path} must be a regular file`);
  }

  const noFollow = "O_NOFOLLOW" in constants ? constants.O_NOFOLLOW : 0;
  const temporary = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let fd = openSync(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    0o600,
  );
  try {
    fchmodSync(fd, 0o600);
    writeFileSync(fd, data, "utf8");
    closeSync(fd);
    fd = -1;
    // Rename replaces the directory entry rather than truncating a potentially pre-planted hard
    // link. The temporary file lives beside the destination, so this is one atomic filesystem move.
    renameSync(temporary, path);
  } finally {
    if (fd !== -1) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}
// ── main ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const withHints = argv.includes("--with-hints");
  const outAt = argv.indexOf("--out");
  const out = outAt === -1
    ? (withHints ? "corpus/hint-queries.json" : "corpus/queries.json")
    : argv[outAt + 1];
  if (!out) throw new Error("--out needs a path under corpus/");
  const limit = argv.includes("--limit") ? Number(argv[argv.indexOf("--limit") + 1]) : Infinity;

  if (argv.includes("--selftest")) {
    const eq = (a: unknown, b: unknown, m: string) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    };
    eq(tokenize(`rg -n "foo bar" src`), ["rg", "-n", "foo bar", "src"], "quoted token");
    eq(tokenize(`rg 'a b' -g '*.ts'`), ["rg", "a b", "-g", "*.ts"], "single quotes");
    eq(extractQueries(`rg -n createClient src/`), ["createClient"], "positional pattern");
    eq(extractQueries(`rg -e authHandler -g '*.ts' .`), ["authHandler"], "-e pattern beats glob value");
    eq(extractQueries(`cd /x && rg -il retryPolicy`), ["retryPolicy"], "after cd");
    eq(extractQueries(`ls -la`), [], "not a search");
    eq(extractQueries(`rg -g '*.ts' --type ts sessionToken`), ["sessionToken"], "value-flags consumed");
    eq(isConceptQuery("createClient"), true, "concept");
    eq(isConceptQuery("foo.*bar"), false, "regex is not a concept");
    eq(extractQueries(`rg -eauthHandler src`), ["authHandler"], "attached -e pattern");
    eq(extractQueries(`sg -pNodeName src`), ["NodeName"], "attached -p pattern");
    eq(extractQueries(`rg --regexp=authHandler src`), ["authHandler"], "--regexp= pattern");
    eq(extractQueries(`sg --pattern=NodeName src`), ["NodeName"], "--pattern= pattern");
    eq(isConceptQuery("index.ts"), false, "filename is not a concept");
    eq(isConceptQuery("ab"), false, "too short");
    eq(segments(`rg "a|b" src`), ['rg "a|b" src'], "pipe inside quotes does not split");
    eq(segments(`rg foo | head`), ["rg foo", "head"], "real pipe splits");
    eq(segments(`cd /x && rg bar`), ["cd /x", "rg bar"], "&& splits");
    // Without quote-aware segmentation this harvested "a" as though it were the whole query.
    // Before quote-aware segmentation this returned ["auth"] — a truncated query harvested as
    // though it were the whole thing. Now the alternation survives intact and is rejected below.
    eq(extractQueries(`rg -n "auth|session" src`), ["auth|session"], "alternation not truncated");
    eq(isConceptQuery("auth|session"), false, "...and is then rejected as a concept query");
    eq(extractQueries(`rg createClient | head -5`), ["createClient"], "query survives a pipe");
    eq(
      hintsFromTask("Fix `validateSession` with authContext and retryPolicy", "validateSession"),
      ["authContext", "retryPolicy"],
      "task hints come from the latest external user string and exclude the query",
    );
    const transcriptRoot = mkdtempSync(join(tmpdir(), "hay-harvest-transcript-"));
    try {
      const transcript = join(transcriptRoot, "fixture.jsonl");
      const rows = [
        { type: "user", userType: "external", cwd: "/repo", message: { role: "user", content: "Fix `validateSession` using authContext" } },
        { type: "assistant", userType: "external", cwd: "/repo", message: { role: "assistant", content: "assistantLeak and assistantContext" } },
        { type: "user", userType: "external", cwd: "/repo", message: { role: "user", content: [{ type: "tool_result", content: "toolResultLeak" }] } },
        // Each row below has the user-message shape and was seen passing the original filter.
        { type: "user", userType: "external", isSidechain: true, cwd: "/repo", message: { role: "user", content: "Find sidechainLeak for the parent" } },
        { type: "user", userType: "external", isMeta: true, cwd: "/repo", message: { role: "user", content: "Skill body metaLeak" } },
        { type: "user", userType: "external", isCompactSummary: true, cwd: "/repo", message: { role: "user", content: "Summary compactLeak" } },
        { type: "user", userType: "external", origin: { kind: "task-notification" }, promptSource: "system", cwd: "/repo", message: { role: "user", content: "<task-notification>notifyLeak</task-notification>" } },
        { type: "user", userType: "external", promptSource: "sdk", cwd: "/repo", message: { role: "user", content: "Scripted sdkLeak" } },
        { type: "user", userType: "external", cwd: "/repo", message: { role: "user", content: "<local-command-stdout>stdoutLeak</local-command-stdout>" } },
        { type: "user", userType: "external", cwd: "/repo", message: { role: "user", content: "<bash-stdout>bashLeak</bash-stdout>" } },
        { type: "assistant", cwd: "/repo", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "src/readPathLeak.ts" } }] } },
        { type: "assistant", cwd: "/repo", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "rg validateSession src" } }] } },
        { type: "assistant", cwd: "/repo", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "/repo" } }] } },
        { type: "assistant", cwd: "/repo", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "src/answer.ts" } }] } },
        { type: "assistant", cwd: "/repo", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "__proto__" } }] } },
        { type: "assistant", cwd: "/repo", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "/repo/..config" } }] } },
      ].map((row) => JSON.stringify(row)).join("\n");
      writeFileSync(transcript, rows);
      const hinted = harvest([transcript], true) as HintCorpusEntry[];
      const expectedAnswers = Object.fromEntries([
        ["src/answer.ts", 1], ["__proto__", 1], ["..config", 1],
      ]);
      eq(hinted, [{
        query: "validatesession", repo: "/repo", answeredBy: expectedAnswers, searches: 1,
        hints: ["authContext"],
      }], "only the preceding external plain-string user message supplies context");
      if (JSON.stringify(hinted).match(/assistantLeak|toolResultLeak|readPathLeak|sidechainLeak|metaLeak|compactLeak|notifyLeak|sdkLeak|stdoutLeak|bashLeak/)) {
        throw new Error("assistant, tool-result, read-path, or injected content leaked into task hints");
      }
      // The fixture's last injected row would mask an earlier one, so each is also checked alone.
      for (const row of rows.split("\n").map((line) => JSON.parse(line) as unknown)) {
        if (/Leak/.test(JSON.stringify(row)) && humanTaskText(row) !== null) {
          throw new Error(`injected row accepted as task context: ${JSON.stringify(row)}`);
        }
      }
      eq(
        humanTaskText({ type: "user", userType: "external", origin: { kind: "human" }, promptSource: "typed", message: { role: "user", content: "typed task" } }),
        "typed task",
        "a message labelled human-typed is task context",
      );
      eq(
        humanTaskText({ type: "user", userType: "external", message: { role: "user", content: "<command-name>/review</command-name>" } }),
        "<command-name>/review</command-name>",
        "a slash command the human typed is still task context",
      );
      eq(
        harvest([transcript], false),
        [{ query: "validatesession", repo: "/repo", answeredBy: expectedAnswers, searches: 1 }],
        "default harvest output and aggregation remain schema-compatible",
      );

      const repoRoot = join(transcriptRoot, "repo");
      const nestedCwd = join(repoRoot, "src");
      mkdirSync(join(repoRoot, ".git"), { recursive: true });
      mkdirSync(nestedCwd);
      mkdirSync(join(repoRoot, "tests"));
      const nestedTranscript = join(transcriptRoot, "nested.jsonl");
      const nestedRows = [
        { type: "assistant", cwd: nestedCwd, message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "rg nestedNeedle ." } }] } },
        { type: "assistant", cwd: nestedCwd, message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "../tests/answer.ts" } }] } },
      ].map((row) => JSON.stringify(row)).join("\n");
      writeFileSync(nestedTranscript, nestedRows);
      eq(
        harvest([nestedTranscript], false),
        [{
          query: "nestedneedle", repo: realpathSync(repoRoot),
          answeredBy: { "tests/answer.ts": 1 }, searches: 1,
        }],
        "nested CWD searches and judgments are rooted at the real repository",
      );
    } finally {
      rmSync(transcriptRoot, { recursive: true, force: true });
    }
    const privateRoot = mkdtempSync(join(tmpdir(), "hay-harvest-private-"));
    try {
      writePrivateCorpus("corpus/queries.json", "[]", privateRoot);
      eq(await Bun.file(join(privateRoot, "corpus/queries.json")).text(), "[]", "private output body");
      let rejected = false;
      try { writePrivateCorpus("corpus/../evidence/queries.json", "[]", privateRoot); } catch { rejected = true; }
      eq(rejected, true, "private output traversal is rejected");
      rejected = false;
      try { writePrivateCorpus("outside.json", "[]", privateRoot); } catch { rejected = true; }
      eq(rejected, true, "private output outside corpus is rejected");
      if (process.platform !== "win32") {
        eq(statSync(join(privateRoot, "corpus")).mode & 0o777, 0o700, "corpus directory mode");
        eq(statSync(join(privateRoot, "corpus/queries.json")).mode & 0o777, 0o600, "corpus file mode");
        chmodSync(join(privateRoot, "corpus/queries.json"), 0o644);
        writePrivateCorpus("corpus/queries.json", "[1]", privateRoot);
        const victim = join(privateRoot, "outside-victim");
        writeFileSync(victim, "untouched");
        rmSync(join(privateRoot, "corpus/queries.json"));
        linkSync(victim, join(privateRoot, "corpus/queries.json"));
        writePrivateCorpus("corpus/queries.json", "[2]", privateRoot);
        eq(await Bun.file(victim).text(), "untouched", "existing hard link target is not truncated");
        eq(await Bun.file(join(privateRoot, "corpus/queries.json")).text(), "[2]", "hard link is replaced");
        eq(statSync(join(privateRoot, "corpus/queries.json")).mode & 0o777, 0o600, "existing file mode repaired");
        mkdirSync(join(privateRoot, "outside"));
        symlinkSync(join(privateRoot, "outside"), join(privateRoot, "corpus/link"));
        rejected = false;
        try { writePrivateCorpus("corpus/link/escape.json", "[]", privateRoot); } catch { rejected = true; }
        eq(rejected, true, "symlinked private output parent is rejected");
      }
    } finally {
      rmSync(privateRoot, { recursive: true, force: true });
    }
    console.log("selftest ok");
    process.exit(0);
  }

  const root = join(homedir(), ".claude", "projects");
  const files = [...new Bun.Glob("**/*.jsonl").scanSync(root)].map((f) => join(root, f)).slice(0, limit);
  console.error(`scanning ${files.length} transcripts...`);
  const corpus = harvest(files, withHints).sort((a, b) => b.searches - a.searches);

  const output: CorpusEntry[] | HintCorpus = withHints
    ? { hderive: HDERIVE_VERSION, observations: corpus as HintCorpusEntry[] }
    : corpus as CorpusEntry[];
  // Anchored to this checkout, not the shell's directory: run from another repository, a relative
  // `corpus/` would land in a tree whose .gitignore nobody checked.
  writePrivateCorpus(out, JSON.stringify(output, null, 2), HARVEST_ROOT);
  const repos = new Map<string, number>();
  for (const e of corpus) repos.set(e.repo, (repos.get(e.repo) ?? 0) + 1);
  console.error(`${corpus.length} judged queries across ${repos.size} repos -> ${out}`);
  for (const [r, n] of [...repos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.error(`  ${n.toString().padStart(4)}  ${r}`);
  }
}
