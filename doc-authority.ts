#!/usr/bin/env bun
/**
 * doc-authority — does any signal actually predict which documents are dead?
 *
 * `suspectShare` in grep-hygiene.ts guesses at document deadness from path and filename
 * conventions (`archive/`, `plan-v3-FINAL.md`) and has never been checked against anything.
 * This checks it, using revealed preference as ground truth: across thousands of recorded agent
 * sessions, which prose files did an agent ever actually open?
 *
 * A document that no agent has opened in any session is not proof of death — but across a large
 * transcript corpus it is the strongest behavioural signal available, and it is a signal nobody
 * outside this machine has. Prior art (DOCER, arXiv 2212.01479) detects rotten code-element
 * *references* inside docs; document-level authority is unaddressed.
 *
 * Candidate signals tested, per ticket 03:
 *   suspect   — the existing path/filename heuristic
 *   age       — days since the file's last git commit
 *   inbound   — how many other files in the repo mention this file's path
 *
 * Usage: bun doc-authority.ts <repo>... [--json]
 *        bun doc-authority.ts --selftest
 */

import { homedir, tmpdir } from "node:os";
import { join, isAbsolute, relative, basename, extname } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";

const PROSE_EXT = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]);

const SUSPECT_DIR = [
  "archive", "archived", "old", "deprecated", "legacy", "superseded",
  ".scratch", "scratch", "plans", "planning", "research", "notes", "drafts",
  "specs/done", "history", "journal", "memory", "handoff", "reports",
  "tmp", "wip", "_old", "backup",
];
const SUSPECT_NAME =
  /(^|[-_. ])(v\d+|final|old|deprecated|draft|wip|bak|copy|backup|superseded|obsolete|legacy|todo|plan|plano|notes|scratch|research|handoff|summary|resumo|analysis|audit|report|status|progress|migration|phase\d+|step\d+|\d{4}-\d{2}-\d{2})([-_. ]|$)/i;

export function isSuspect(path: string): boolean {
  const ext = extname(path).toLowerCase();
  if (!PROSE_EXT.has(ext)) return false;
  const lower = path.toLowerCase();
  const inDir = SUSPECT_DIR.some((d) => lower.includes(`/${d}/`) || lower.startsWith(`${d}/`));
  const name = basename(path, ext);
  const canonical = /^(readme|changelog|license|contributing|agents|claude|index|security|code_of_conduct)$/i.test(name);
  return !canonical && (inDir || SUSPECT_NAME.test(name));
}

// ── evaluation ────────────────────────────────────────────────────────────────

/**
 * Precision/recall of a binary signal against "an agent never opened this file".
 * Reported with the base rate, because in a repo where 90% of docs are never opened a signal that
 * fires at random already looks 90% precise. Lift is what matters: precision / base rate.
 */
export function evaluate(items: { flagged: boolean; dead: boolean }[]) {
  const n = items.length;
  const dead = items.filter((i) => i.dead).length;
  const flagged = items.filter((i) => i.flagged).length;
  const tp = items.filter((i) => i.flagged && i.dead).length;
  const base = n ? dead / n : 0;
  const precision = flagged ? tp / flagged : 0;
  return {
    n, dead, flagged,
    baseRate: base,
    precision,
    recall: dead ? tp / dead : 0,
    lift: base ? precision / base : 0,
  };
}

// ── transcripts: which files did agents actually open? ────────────────────────

async function relevantTranscriptFiles(repos: string[], root: string): Promise<string[]> {
  if (repos.length === 0) return [];
  const rg = Bun.which("rg");
  if (!rg) throw new Error("ripgrep is required to prefilter transcript files");
  const patterns = repos.flatMap((repo) => ["-e", JSON.stringify(repo)]);
  const proc = Bun.spawn(
    [rg, "--no-config", "--hidden", "--no-ignore", "-g", "*.jsonl", "-l", "-0", "-F", ...patterns, root],
    { stdout: "pipe", stderr: "pipe" },
  );
  const errText = new Response(proc.stderr).text();
  const text = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code >= 2) {
    throw new Error(`transcript prefilter failed (exit ${code}): ${(await errText).trim().slice(0, 300) || "no diagnostic"}`);
  }
  return text.split("\0").filter(Boolean);
}

async function readsByRepo(
  repos: string[],
  root = join(homedir(), ".claude", "projects"),
): Promise<{ reads: Map<string, Map<string, number>>; sessions: number }> {
  const wanted = new Set(repos);
  const out = new Map<string, Map<string, number>>();
  const sessions = new Set<string>();
  // Ripgrep scans the full transcript store in native code, then JSON parsing confirms exact cwd
  // equality. A literal repo path elsewhere in a transcript can only add harmless parse work.
  for (const file of await relevantTranscriptFiles(repos, root)) {
    let text: string;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line) continue;
      let d: any;
      try { d = JSON.parse(line); } catch { continue; }
      const cwd: string | undefined = d.cwd;
      const content = d.message?.content;
      if (!cwd || !wanted.has(cwd)) continue;
      sessions.add(file);
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (b?.type !== "tool_use") continue;
        const p = b.input?.file_path;
        if ((b.name !== "Read" && b.name !== "Edit" && b.name !== "Write") || typeof p !== "string") continue;
        const r = isAbsolute(p) ? relative(cwd, p) : p;
        if (r.startsWith("..")) continue;
        const m = out.get(cwd) ?? new Map<string, number>();
        m.set(r, (m.get(r) ?? 0) + 1);
        out.set(cwd, m);
      }
    }
  }
  return { reads: out, sessions: sessions.size };
}

// ── repo features ─────────────────────────────────────────────────────────────

async function sh(cmd: string[], cwd: string): Promise<string> {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const errText = new Response(p.stderr).text();
  const text = await new Response(p.stdout).text();
  const code = await p.exited;
  if (code >= 2) throw new Error(`${cmd[0] ?? "subprocess"} failed (exit ${code}): ${(await errText).trim().slice(0, 300) || "no diagnostic"}`);
  return text;
}

/** Days since each tracked file's last commit. One `git log` walk, not one call per file. */
async function ageDays(repo: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const log = await sh(["git", "log", "--name-only", "--pretty=format:%ct", "--no-merges"], repo);
  let stamp = 0;
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    if (/^\d{9,}$/.test(line.trim())) { stamp = Number(line.trim()); continue; }
    if (!out.has(line)) out.set(line, stamp); // first mention walking backwards = most recent commit
  }
  const head = Number((await sh(["git", "log", "-1", "--pretty=format:%ct"], repo)).trim()) || 0;
  const days = new Map<string, number>();
  for (const [f, t] of out) days.set(f, head && t ? Math.round((head - t) / 86400) : 0);
  return days;
}

/** How many other files mention this file's basename — a crude inbound-link count. */
async function inboundLinks(repo: string, files: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>(files.map((file) => [file, 0]));
  const names = [...new Set(files.map((file) => basename(file)))];
  for (let offset = 0; offset < names.length; offset += 8) {
    await Promise.all(names.slice(offset, offset + 8).map(async (name) => {
      const text = await sh(
        ["rg", "--no-config", "--hidden", "-g", "!.git/", "-l", "-0", "-F", "-e", name, "."],
        repo,
      );
      const matched = text.split("\0").filter(Boolean)
        .map((path) => path.replace(/^\.\//, "").replaceAll("\\", "/"));
      for (const file of files) {
        if (basename(file) === name) counts.set(file, matched.filter((path) => path !== file).length);
      }
    }));
  }
  return counts;
}

// ── main ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = Bun.argv.slice(2);

  if (argv.includes("--selftest")) {
    const eq = (a: unknown, b: unknown, m: string) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    };
    eq(isSuspect("docs/archive/x.md"), true, "archive dir");
    eq(isSuspect("README.md"), false, "readme");
    eq(isSuspect("src/index.ts"), false, "not prose");
    // A signal that fires on everything has perfect recall and zero lift; lift is the honest number.
    const all = [{ flagged: true, dead: true }, { flagged: true, dead: false }];
    eq(evaluate(all).lift, 1, "flagging everything has lift 1");
    const perfect = [{ flagged: true, dead: true }, { flagged: false, dead: false }];
    eq(evaluate(perfect).precision, 1, "perfect precision");
    eq(evaluate(perfect).lift, 2, "perfect signal at 50% base rate has lift 2");
    eq(evaluate([]).lift, 0, "empty");
    const fixture = mkdtempSync(join(tmpdir(), "doc-authority-"));
    try {
      await Bun.write(join(fixture, "target.md"), "# Target\n");
      await Bun.write(join(fixture, "self.md"), "self.md\n");
      await Bun.write(join(fixture, "ref.md"), "See target.md\n");
      const inbound = await inboundLinks(fixture, ["target.md", "self.md", "ref.md"]);
      eq(inbound.get("target.md"), 1, "only the actual target path is excluded from inbound links");
      eq(inbound.get("self.md"), 0, "a self-reference is not an inbound link");
      const transcripts = join(fixture, "transcripts");
      mkdirSync(transcripts);
      const targetRepo = join(fixture, "wanted");
      const record = (cwd: string, filePath: string) => JSON.stringify({
        cwd,
        message: { content: [{ type: "tool_use", name: "Read", input: { file_path: filePath } }] },
      });
      await Bun.write(join(transcripts, "wanted.jsonl"), record(targetRepo, join(targetRepo, "README.md")) + "\n");
      await Bun.write(join(transcripts, "other.jsonl"), record(join(fixture, "other"), join(fixture, "other/README.md")) + "\n");
      const history = await readsByRepo([targetRepo], transcripts);
      eq(history.reads.get(targetRepo)?.get("README.md"), 1, "prefilter preserves exact relevant reads");
      eq(history.reads.size, 1, "prefilter excludes unrelated repositories");
      eq(history.sessions, 1, "session count uses exact repository matches");
      const empty = await readsByRepo([], transcripts);
      eq(empty.reads.size, 0, "an empty eligible cohort performs no transcript search");
      eq(empty.sessions, 0, "an empty eligible cohort has no sessions");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
    console.log("selftest ok");
    process.exit(0);
  }

  const repos = argv.filter((a) => !a.startsWith("--"));
  if (repos.length === 0) { console.error("usage: bun doc-authority.ts <repo>... [--json]"); process.exit(1); }

  const eligible = new Map<string, string[]>();
  for (const repo of repos) {
    const files = (await sh(["rg", "--files", "--no-config", "--hidden", "-g", "!.git/"], repo))
      .split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""))
      .filter((f) => PROSE_EXT.has(extname(f).toLowerCase()));
    if (files.length < 20) { console.error(`skip ${basename(repo)}: only ${files.length} prose files`); continue; }
    eligible.set(repo, files);
  }

  console.error(`mining transcripts for ${eligible.size} eligible repositories...`);
  const history = await readsByRepo([...eligible.keys()]);
  const reads = history.reads;
  console.error(`matched ${history.sessions} transcript sessions to the eligible cohort`);

  const report: any[] = [];
  for (const [repo, files] of eligible) {
    const opened = reads.get(repo) ?? new Map();

    const [age, inbound] = await Promise.all([ageDays(repo), inboundLinks(repo, files)]);
    const rows = files.map((f) => ({
      file: f,
      dead: !opened.has(f),
      suspect: isSuspect(f),
      age: age.get(f) ?? 0,
      inbound: inbound.get(f) ?? 0,
    }));

    const medianAge = [...rows.map((r) => r.age)].sort((a, b) => a - b)[Math.floor(rows.length / 2)] ?? 0;
    const signals = {
      "suspect path/name": evaluate(rows.map((r) => ({ flagged: r.suspect, dead: r.dead }))),
      [`older than ${medianAge}d`]: evaluate(rows.map((r) => ({ flagged: r.age > medianAge, dead: r.dead }))),
      "no inbound links": evaluate(rows.map((r) => ({ flagged: r.inbound === 0, dead: r.dead }))),
      "suspect AND unlinked": evaluate(rows.map((r) => ({ flagged: r.suspect && r.inbound === 0, dead: r.dead }))),
    };

    const name = basename(repo);
    console.error(`\n${name}: ${rows.length} prose files, ${rows.filter((r) => r.dead).length} never opened by any agent ` +
      `(base rate ${(evaluate(rows.map((r) => ({ flagged: true, dead: r.dead }))).baseRate * 100).toFixed(0)}%)`);
    for (const [k, v] of Object.entries(signals)) {
      console.error(`  ${k.padEnd(22)} precision ${(v.precision * 100).toFixed(0).padStart(3)}%  ` +
        `recall ${(v.recall * 100).toFixed(0).padStart(3)}%  lift ${v.lift.toFixed(2)}  (fires on ${v.flagged})`);
    }
    report.push({ repo: name, files: rows.length, signals });
  }
  if (argv.includes("--json")) console.log(JSON.stringify({ sessions: history.sessions, repositories: report }, null, 2));
}
