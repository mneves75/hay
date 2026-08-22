#!/usr/bin/env bun
/**
 * grep-hygiene — measure how much of an agent's search lands on code vs prose.
 *
 * Two numbers, reported separately (a composite would hide which problem you have):
 *   addressability — do declared names return few enough hits to work as addresses?
 *   prose share    — what fraction of concept-query hits land in .md rather than code?
 *
 * What "prose share" does NOT mean: it does not detect dead documentation. A current,
 * authoritative spec and an abandoned plan-v3 are counted identically. It measures the
 * reading cost of a search, not the value of what you read. `suspectShare` is the
 * heuristic attempt at deadness and it is weak — see README.
 *
 * Usage:
 *   bun grep-hygiene.ts <repo>... [--json] [--sample N]
 *   bun grep-hygiene.ts --selftest
 */

import { existsSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

// ── classification ────────────────────────────────────────────────────────────

export type Kind = "code" | "prose" | "other";

const CODE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
  ".swift", ".kt", ".java", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".php",
  ".sh", ".zsh", ".sql", ".vue", ".svelte",
]);

/**
 * Languages whose declarations this keyword regex can extract reliably. Classification
 * coverage is deliberately wider than extraction coverage: a .java file IS code, but
 * keyword-matching its method declarations without a parser produces garbage, so it is
 * excluded here rather than silently skewing the sample.
 */
const DECL_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
  ".swift", ".kt", ".php", ".vue", ".svelte",
]);

const PROSE_EXT = new Set([".md", ".mdx", ".txt", ".rst", ".adoc"]);

/** Path fragments that mark prose as non-authoritative by convention. */
const SUSPECT_DIR = [
  "archive", "archived", "old", "deprecated", "legacy", "superseded",
  ".scratch", "scratch", "plans", "planning", "research", "notes", "drafts",
  "specs/done", "history", "journal", "memory", "handoff", "reports",
  "tmp", "wip", "_old", "backup",
];
/** Filename tells on itself: plan-v3-FINAL.md, spec_old.md, NOTES-2024.md */
const SUSPECT_NAME =
  /(^|[-_. ])(v\d+|final|old|deprecated|draft|wip|bak|copy|backup|superseded|obsolete|legacy|todo|plan|plano|notes|scratch|research|handoff|summary|resumo|analysis|audit|report|status|progress|migration|phase\d+|step\d+|\d{4}-\d{2}-\d{2})([-_. ]|$)/i;

/** ripgrep emits backslash separators on Windows; every path rule here is written with `/`. */
const norm = (p: string) => p.replace(/\\/g, "/").replace(/^\.\//, "");

export function classify(rawPath: string): { kind: Kind; suspect: boolean } {
  const path = norm(rawPath);
  const ext = extname(path).toLowerCase();
  const kind: Kind = CODE_EXT.has(ext) ? "code" : PROSE_EXT.has(ext) ? "prose" : "other";
  if (kind !== "prose") return { kind, suspect: false };

  const lower = path.toLowerCase();
  const inSuspectDir = SUSPECT_DIR.some((d) => lower.includes(`/${d}/`) || lower.startsWith(`${d}/`));
  const name = basename(path, ext);
  // README/CHANGELOG/AGENTS are load-bearing by convention — never suspect. This is also
  // the guard against scoring a stable, correct spec that nobody has needed to edit.
  const canonical = /^(readme|changelog|license|contributing|agents|claude|index|security|code_of_conduct)$/i.test(name);
  return { kind, suspect: !canonical && (inSuspectDir || SUSPECT_NAME.test(name)) };
}

/** camelCase / snake_case / PascalCase → word count. modem's "3 words is an address" claim. */
export function wordCount(name: string): number {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Nearest-rank percentile. `sorted` must be ascending. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

// ── ripgrep ───────────────────────────────────────────────────────────────────

/**
 * Streams `rg --json` and reports every submatch. Streaming rather than buffering: a
 * common pattern over a large repo emits hundreds of MB of match events, and holding
 * that as one string is an OOM waiting for a big monorepo.
 *
 * `--no-ignore-dot` so a scanned repo cannot silently game its own score by adding
 * `*.md` to a `.ignore`/`.rgignore` file. `.gitignore` IS still honoured (we want
 * node_modules excluded); a repo that gitignores its docs has genuinely removed them
 * from its tracked content.
 *
 * `--hidden` because ripgrep skips dotted directories by default, and `.scratch/` is this
 * tool's own top suspect-prose location — without it, a repo that keeps its paperwork in a
 * hidden directory scored perfectly clean. `.git` is excluded explicitly; it is the one
 * hidden directory that is metadata rather than content.
 */
// `--no-config`: ripgrep reads RIPGREP_CONFIG_PATH from the environment, so an operator with
// `--glob=!*.md` in their rc file would silently measure a repo with no prose at all. A score has
// to be a property of the repository, not of whoever ran it.
// `--no-ignore-global` / `--no-ignore-exclude`: a user's global gitignore and this clone's
// `.git/info/exclude` are operator-local state, so leaving them on lets the same commit score
// differently on two machines. The committed `.gitignore` IS still honoured — it is part of the
// repository, and a repo that gitignores its docs has genuinely removed them from its content.
const RG_TRAVERSAL = [
  "--no-config", "--no-ignore-dot", "--no-ignore-global", "--no-ignore-exclude",
  "--hidden", "-g", "!.git/", "-g", "!.jj/",
];

export type HitCtx = { line: string; start: number };

const nonAscii = /[^\x00-\x7F]/;

/** ripgrep reports byte offsets; JS strings are indexed by UTF-16 code unit. */
export function byteToCharIndex(text: string, byteOffset: number): number {
  return Buffer.from(text, "utf8").subarray(0, byteOffset).toString("utf8").length;
}

/** One `rg --json` record embeds a whole source line; a minified bundle can make that enormous. */
const MAX_RECORD_BYTES = 4_000_000;

export type ScanStats = { oversizedRecords: number; nonUtf8Paths: number };

async function rgStream(
  repo: string,
  args: string[],
  onHit: (path: string, matched: string, ctx: HitCtx) => void,
  dedupeKey: (matched: string) => string = (m) => m,
  stats?: ScanStats,
): Promise<void> {
  const proc = Bun.spawn(["rg", "--json", "--no-messages", ...RG_TRAVERSAL, ...args, "."], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  const errText = new Response(proc.stderr).text(); // drain concurrently or the child can block
  const dec = new TextDecoder();
  let buf = "";
  const flush = (jsonLine: string) => {
    if (!jsonLine.startsWith('{"type":"match"')) return;
    const ev = JSON.parse(jsonLine);
    // ripgrep emits `{bytes}` instead of `{text}` for paths that are not valid UTF-8. Those are
    // legal on Unix; skip them rather than letting `undefined` abort the whole scan.
    const path: string | undefined = ev.data.path?.text;
    // ripgrep emits `{bytes}` for paths that are not valid UTF-8. They are skipped, but counted
    // and surfaced — a silent skip means declaration discovery and file statistics quietly
    // disagree about which files exist.
    if (path === undefined) { if (stats) stats.nonUtf8Paths++; return; }
    const text: string = ev.data.lines?.text ?? "";
    // One rg RESULT is one line, however many times the pattern occurs on it — `rg -c`
    // reports lines, and reading cost is per line. Counting submatches would let one
    // repetitive or minified line inflate the score. Distinct patterns on the same line
    // still each count once, which is what a per-pattern search would return.
    // A case-insensitive scan must key on the normalized form, or `config`/`Config`/`CONFIG`
    // on one line count as three result lines for a query ripgrep answered with one.
    const seen = new Set<string>();
    for (const sm of ev.data.submatches) {
      const key = dedupeKey(sm.match.text);
      if (seen.has(key)) continue;
      seen.add(key);
      // `start` is a BYTE offset; indexing a JS string with it walks past the match once any
      // multibyte character precedes it. ASCII lines take the fast path.
      const start = nonAscii.test(text) ? byteToCharIndex(text, sm.start) : sm.start;
      onHit(path, sm.match.text, { line: text, start });
    }
  };
  let dropping = false;
  for await (const chunk of proc.stdout as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (dropping) { dropping = false; if (stats) stats.oversizedRecords++; continue; }
      flush(line);
    }
    // Bounded failure beats an OOM: abandon a single over-long record, keep scanning, and report.
    if (buf.length > MAX_RECORD_BYTES) { buf = ""; dropping = true; }
  }
  if (!dropping) flush(buf);
  else if (stats) stats.oversizedRecords++;

  // rg: 0 = matches, 1 = no matches (legitimate), >=2 = real failure. Treating a failure
  // as "no matches" would publish a clean-looking score for a scan that never ran.
  const code = await proc.exited;
  if (code >= 2) {
    throw new Error(`ripgrep failed (exit ${code}) in ${repo}: ${(await errText).trim().slice(0, 300)}`);
  }
}

/**
 * Matching-line counts per file for one query, via `rg -c`.
 *
 * Deliberately not the JSON path: `rg --json` embeds the full source line in every match event,
 * so a single tracked minified file yields a >12 MB event (measured: 200k submatches on one line)
 * and eight concurrent queries multiply it. `-c` emits one short line per file and counts matching
 * lines, which is exactly the metric — reading cost, not occurrences.
 */
async function rgCountLines(repo: string, query: string): Promise<Map<string, number>> {
  // `--null` puts a NUL between path and count, so a path containing ':' or a newline still
  // parses. Records are `<path>\0<count>\n`, which is why this is not a line split.
  const proc = Bun.spawn(["rg", "-c", "--null", "-i", "-F", "-e", query, ...RG_TRAVERSAL, "."], {
    cwd: repo, stdout: "pipe", stderr: "pipe",
  });
  const errText = new Response(proc.stderr).text();
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code >= 2) throw new Error(`ripgrep failed (exit ${code}) in ${repo}: ${(await errText).trim().slice(0, 300)}`);

  const counts = new Map<string, number>();
  const parts = out.split("\0");
  let path = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const nl = parts[i]!.indexOf("\n");
    const n = Number(nl === -1 ? parts[i] : parts[i]!.slice(0, nl));
    if (path && Number.isFinite(n)) counts.set(norm(path), n);
    path = nl === -1 ? undefined : parts[i]!.slice(nl + 1);
  }
  return counts;
}

async function rgFiles(repo: string): Promise<string[]> {
  // `-0`: a filename may legally contain a newline, which would split one path into two entries.
  const proc = Bun.spawn(["rg", "--files", "-0", ...RG_TRAVERSAL], { cwd: repo, stdout: "pipe", stderr: "pipe" });
  const errText = new Response(proc.stderr).text();
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code >= 2) {
    throw new Error(`ripgrep could not list files in ${repo}: ${(await errText).trim().slice(0, 300)}`);
  }
  return out.split("\0").filter(Boolean).map(norm);
}

// ── extraction ────────────────────────────────────────────────────────────────

/**
 * Declaration keywords. `const`/`let`/`var` are matched only when exported, because an
 * unexported local is not something anyone greps for as an address; bare `function`,
 * `class` etc. are matched because they are top-level-ish in practice.
 */
const DECL = String.raw`\b(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)|(?:async\s+)?function|class|interface|enum|struct|trait|impl|protocol|module|def|func|fn|fun)\s+([A-Za-z_][A-Za-z0-9_]*)`;

/** Keywords that survive the regex when the "declaration" is a control keyword. */
const NOT_A_NAME = new Set([
  "for", "if", "is", "in", "of", "as", "the", "and", "or", "not", "this", "that",
  "new", "return", "default", "async", "await", "type", "const", "let", "var",
  "class", "function", "interface", "enum", "extends", "implements", "public",
  "private", "static", "final", "void", "self", "super",
  "while", "do", "switch", "case", "break", "continue", "else", "try", "catch",
  "finally", "throw", "yield", "from", "import", "export", "with", "match",
]);

/**
 * Cheap syntax awareness for a regex that has none: reject a "declaration" that sits behind a
 * comment marker or inside a string literal, which is how `// class RetryHandler` and a fixture
 * containing `"function example"` otherwise enter the sample as real declarations.
 *
 * This is a heuristic, not a parser — it catches commented-out code and doc blocks, which are the
 * dominant real-world cases, and will miss multi-line block comments and multi-line strings.
 * Structural extraction via ast-grep is the real answer and is tracked on the map.
 */
export function isCommentedOrQuoted(line: string, start: number): boolean {
  if (/^\s*\*/.test(line)) return true; // JSDoc / block-comment continuation line
  // Single left-to-right scan tracking quote state, so a comment marker only counts when it is
  // unquoted (`const n = " // "; export class Real {}` is a real declaration) and an unspaced
  // marker still counts (`x();/* class Removed */` is not).
  let quote: string | null = null;
  for (let i = 0; i < Math.min(start, line.length); i++) {
    const c = line[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "#") return true;
    if (c === "/" && (line[i + 1] === "/" || line[i + 1] === "*")) return true;
  }
  return quote !== null; // the match itself sits inside a string literal
}

/** Go writes `type Name struct` and `func (r Recv) Name`; neither fits the general pattern. */
const GO_DECL = String.raw`\b(?:type|func\s+\([^)]*\))\s+([A-Za-z_][A-Za-z0-9_]*)`;

async function declaredNames(repo: string, stats: ScanStats): Promise<string[]> {
  const names = new Set<string>();
  const collect = (_p: string, matched: string, ctx: HitCtx) => {
    if (isCommentedOrQuoted(ctx.line, ctx.start)) return;
    const n = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(matched)?.[1];
    if (!n || n.length < 3 || NOT_A_NAME.has(n.toLowerCase())) return;
    names.add(n);
  };
  await rgStream(repo, [...[...DECL_EXT].flatMap((e) => ["-g", `*${e}`]), DECL], collect, undefined, stats);
  await rgStream(repo, ["-g", "*.go", GO_DECL], collect, undefined, stats);
  return [...names];
}

/**
 * Fixed concept words an agent actually types. This set is IDENTICAL for every repo,
 * which is what makes the headline number comparable across repos. Repo-specific names
 * are measured too, but reported separately — mixing them would compare different
 * measurements and call it a ranking.
 */
const GENERIC = [
  "create", "update", "delete", "handler", "config", "client", "service",
  "auth", "user", "error", "request", "response", "state", "validate",
];

/** Names sampled per repo for addressability. Below this the sample is not worth reporting. */
const LOW_CONFIDENCE_NAMES = 30;

/**
 * Reports are meant to be published, and the `worst` lists quote identifiers lifted out of
 * a possibly-private repo. Names that describe a security surface do not belong in a public
 * artifact. Earlier runs surfaced security-sensitive identifiers from private repositories.
 * Warn, do not silently redact:
 * dropping them would quietly distort the measurement.
 */
const SENSITIVE_NAME = /admin|secret|token|passw|credential|apikey|api_key|private_key|signing|webhook/i;

export function sensitiveNames(r: Report): string[] {
  return [...r.addressability.worst.map((w) => w.name), ...r.sludge.worst.map((w) => w.query)]
    .filter((n) => SENSITIVE_NAME.test(n));
}

// ── scoring ───────────────────────────────────────────────────────────────────

export type QueryStat = { query: string; hits: number; proseShare: number; suspectShare: number };
export type Axis = { queries: number; totalHits: number; proseShare: number; suspectShare: number };

export type Report = {
  repo: string;
  files: { code: number; prose: number; suspectProse: number; other: number };
  addressability: {
    namesFound: number;
    namesSampled: number;
    lowConfidence: boolean;
    medianHits: number;
    p90Hits: number;
    shareOver100Hits: number;
    medianWords: number;
    shareUnder3Words: number;
    worst: { name: string; hits: number; files: number }[];
  };
  scan: ScanStats;
  /** `generic` is the cross-repo comparable number; `repoSpecific` is diagnostic only. */
  sludge: { generic: Axis; repoSpecific: Axis; worst: QueryStat[] };
};

async function mapPool<T, R>(xs: T[], limit: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, xs.length)) }, async () => {
      for (let i = next++; i < xs.length; i = next++) out[i] = await f(xs[i]!);
    }),
  );
  return out;
}

export async function score(repoPath: string, sampleSize = 120, label?: string): Promise<Report> {
  const display = label ?? basename(resolve(repoPath));
  try {
    return await measure(repoPath, sampleSize, display);
  } catch (e) {
    // `=label` promises the private path never appears in output, and diagnostics are output.
    // Only redact when a label was actually given: blanket substitution would rewrite every "."
    // in a message for `score(".")`. Both the raw argument and its resolved form are replaced,
    // since ripgrep stderr echoes the resolved one.
    if (!label) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    const redacted = [resolve(repoPath), repoPath]
      .filter((s) => s.length > 1)
      .reduce((acc, s) => acc.split(s).join(label), msg);
    throw new Error(redacted);
  }
}

async function measure(repoPath: string, sampleSize: number, display: string): Promise<Report> {
  const meta = new Map((await rgFiles(repoPath)).map((f) => [f, classify(f)]));

  const files = { code: 0, prose: 0, suspectProse: 0, other: 0 };
  for (const m of meta.values()) {
    if (m.kind === "code") files.code++;
    else if (m.kind === "prose") { files.prose++; if (m.suspect) files.suspectProse++; }
    else files.other++;
  }
  const kindOf = (p: string) => meta.get(norm(p)) ?? classify(p);

  // ── addressability ──
  const scan: ScanStats = { oversizedRecords: 0, nonUtf8Paths: 0 };
  const found = await declaredNames(repoPath, scan);
  if (found.length === 0) {
    throw new Error(
      `no declarations found in ${display}. Extraction supports ${[...DECL_EXT].join(" ")}; ` +
        `other languages are classified as code but not parsed.`,
    );
  }
  const sample = stableSample(found, sampleSize);

  const perName = new Map(sample.map((n) => [n, { hits: 0, files: new Set<string>() }]));
  // `-w -F` with distinct identifiers: word boundaries prevent one name being absorbed
  // by another that shares a prefix, so a single pass is safe here.
  // Chunked: every pattern is two argv entries, so a large `--sample` on one invocation can
  // blow the OS argument limit (E2BIG).
  for (let i = 0; i < sample.length; i += 200) {
    const chunk = sample.slice(i, i + 200).flatMap((n) => ["-e", n]);
    await rgStream(repoPath, ["-w", "-F", ...chunk], (p, matched) => {
      const e = perName.get(matched);
      if (!e) return;
      e.hits++;
      e.files.add(p);
    }, undefined, scan);
  }
  const hitCounts = [...perName.values()].map((v) => v.hits).sort((a, b) => a - b);
  const words = sample.map(wordCount).sort((a, b) => a - b);

  // ── prose share ──
  // One rg pass PER QUERY. Combining them into one alternation silently corrupts
  // attribution: ripgrep matches leftmost-first and does not re-scan inside a match, so
  // with `-e create -e createClient` every `createClient` is counted as `create` and the
  // longer query reports zero. Verified against ripgrep directly.
  const busiest = [...perName.entries()].sort((a, b) => b[1].hits - a[1].hits).slice(0, 10).map(([n]) => n);
  const generic = dedupeCaseInsensitive(GENERIC);
  const specific = dedupeCaseInsensitive(busiest).filter((q) => !generic.includes(q.toLowerCase()));

  const measureQuery = async (q: string): Promise<QueryStat & { prose: number; suspect: number }> => {
    let hits = 0, prose = 0, suspect = 0;
    for (const [p, n] of await rgCountLines(repoPath, q)) {
      const k = kindOf(p);
      hits += n;
      if (k.kind === "prose") { prose += n; if (k.suspect) suspect += n; }
    }
    return { query: q, hits, prose, suspect, proseShare: div(prose, hits), suspectShare: div(suspect, hits) };
  };

  const genericStats = await mapPool(generic, 8, measureQuery);
  const specificStats = await mapPool(specific, 8, measureQuery);
  const axis = (ss: typeof genericStats): Axis => {
    const t = ss.reduce((a, s) => ({ h: a.h + s.hits, p: a.p + s.prose, s: a.s + s.suspect }), { h: 0, p: 0, s: 0 });
    return { queries: ss.length, totalHits: t.h, proseShare: div(t.p, t.h), suspectShare: div(t.s, t.h) };
  };

  return {
    // Basename by default, never the absolute path: a full path publishes the operator's
    // username and disk layout into every report. `path=label` overrides it so results
    // from private repos can be published without naming them.
    repo: display,
    scan,
    files,
    addressability: {
      namesFound: found.length,
      namesSampled: sample.length,
      // The warning tracks what was actually measured: `--sample 1` on a huge repo must not
      // report medians from one identifier as confident.
      lowConfidence: Math.min(sample.length, found.length) < LOW_CONFIDENCE_NAMES,
      medianHits: percentile(hitCounts, 50),
      p90Hits: percentile(hitCounts, 90),
      shareOver100Hits: div(hitCounts.filter((h) => h > 100).length, hitCounts.length),
      medianWords: percentile(words, 50),
      shareUnder3Words: div(words.filter((w) => w < 3).length, words.length),
      worst: [...perName.entries()]
        .sort((a, b) => b[1].hits - a[1].hits).slice(0, 5)
        .map(([name, v]) => ({ name, hits: v.hits, files: v.files.size })),
    },
    sludge: {
      generic: axis(genericStats),
      repoSpecific: axis(specificStats),
      // Ranked by proseShare, the primary number. Ranking by suspectShare surfaced
      // low-prose queries above ones where nearly every hit was paperwork.
      worst: [...genericStats, ...specificStats]
        .filter((s) => s.hits > 20)
        .sort((a, b) => b.proseShare - a.proseShare)
        .slice(0, 5)
        .map(({ query, hits, proseShare, suspectShare }) => ({ query, hits, proseShare, suspectShare })),
    },
  };
}

const div = (a: number, b: number) => (b === 0 ? 0 : a / b);

/** `config` and `Config` are one query; two rg patterns for them would double-count. */
export function dedupeCaseInsensitive(xs: string[]): string[] {
  const seen = new Set<string>();
  return xs.filter((x) => !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
}

/**
 * Deterministic *and* representative sample — same repo scores the same twice, but the
 * sample spreads across the name space. Sorting alphabetically and slicing is
 * deterministic and badly biased: it only ever measures names starting with `a`.
 */
export function stableSample<T>(xs: T[], n: number): T[] {
  return [...xs]
    .map((x) => [fnv1a(String(x)), x] as const)
    .sort((a, b) => a[0] - b[0] || String(a[1]).localeCompare(String(b[1])))
    .slice(0, n)
    .map(([, x]) => x);
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Publication mode. Repo names are anonymised by `=label`, but the `worst` lists still quote exact
 * identifiers lifted from the measured repo — distinctive symbols fingerprint a private project on
 * their own. This pseudonymises everything that is not one of this tool's own fixed GENERIC query
 * words, which are not repo-derived and carry no information about the source.
 */
export function redactNames(r: Report): Report {
  const generic = new Set(GENERIC);
  const alias = new Map<string, string>();
  const sub = (s: string) => {
    if (generic.has(s.toLowerCase())) return s;
    if (!alias.has(s)) alias.set(s, `name-${String(alias.size + 1).padStart(2, "0")}`);
    return alias.get(s)!;
  };
  return {
    ...r,
    addressability: { ...r.addressability, worst: r.addressability.worst.map((w) => ({ ...w, name: sub(w.name) })) },
    sludge: { ...r.sludge, worst: r.sludge.worst.map((w) => ({ ...w, query: sub(w.query) })) },
  };
}

// ── output ────────────────────────────────────────────────────────────────────

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function print(r: Report) {
  const a = r.addressability, s = r.sludge;
  console.log(`\n\x1b[1m${r.repo}\x1b[0m`);
  console.log(`  files           ${r.files.code} code · ${r.files.prose} prose (${r.files.suspectProse} suspect) · ${r.files.other} other`);
  console.log(`  \x1b[1maddressability\x1b[0m  median ${a.medianHits} hits/name · p90 ${a.p90Hits} · ${pct(a.shareOver100Hits)} of names >100 hits`);
  console.log(`                  median ${a.medianWords} words · ${pct(a.shareUnder3Words)} under 3 words (n=${a.namesSampled} of ${a.namesFound})`);
  if (a.lowConfidence) console.log(`                  \x1b[33m! ${a.namesSampled} names measured (${a.namesFound} found) — below ${LOW_CONFIDENCE_NAMES}, treat as unreliable\x1b[0m`);
  for (const w of a.worst) console.log(`                  ↳ ${w.name}: ${w.hits} hits / ${w.files} files`);
  console.log(`  \x1b[1mprose share\x1b[0m     ${pct(s.generic.proseShare)} of ${s.generic.totalHits} hits on ${s.generic.queries} shared queries  \x1b[2m← comparable\x1b[0m`);
  console.log(`                  ${pct(s.repoSpecific.proseShare)} of ${s.repoSpecific.totalHits} hits on ${s.repoSpecific.queries} repo-specific names  \x1b[2m← diagnostic\x1b[0m`);
  console.log(`                  ${pct(s.generic.suspectShare)} in suspect prose (heuristic; see README)`);
  for (const w of s.worst) console.log(`                  ↳ ${w.query}: ${w.hits} hits, ${pct(w.proseShare)} prose, ${pct(w.suspectShare)} suspect`);
}

// ── selftest ──────────────────────────────────────────────────────────────────

function selftest() {
  const eq = (a: unknown, b: unknown, m: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  };
  eq(classify("src/index.ts"), { kind: "code", suspect: false }, "code");
  eq(classify("./src/index.ts"), { kind: "code", suspect: false }, "rg's ./ prefix");
  eq(classify(String.raw`docsrchive\old.md`), { kind: "prose", suspect: true }, "windows separators");
  eq(classify("README.md"), { kind: "prose", suspect: false }, "readme is never suspect");
  eq(classify("docs/api-reference.md"), { kind: "prose", suspect: false }, "live doc");
  eq(classify("docs/archive/api.md"), { kind: "prose", suspect: true }, "archive dir");
  eq(classify("./archive/api.md"), { kind: "prose", suspect: true }, "top-level suspect dir with ./");
  eq(classify("plan-v3-FINAL.md"), { kind: "prose", suspect: true }, "filename tells on itself");
  eq(classify(".scratch/foo/notes.md"), { kind: "prose", suspect: true }, "scratch");
  eq(classify("docs/2024-01-15-research.md"), { kind: "prose", suspect: true }, "dated");
  eq(classify("pnpm-lock.yaml").kind, "other", "lockfile");

  eq(wordCount("create"), 1, "one word");
  eq(wordCount("createClient"), 2, "camel");
  eq(wordCount("createStripeClient"), 3, "camel 3");
  eq(wordCount("create_stripe_client"), 3, "snake");
  eq(wordCount("HTTPClient"), 2, "acronym boundary");

  // Nearest-rank: p50 of 4 items is the 2nd, not the 3rd.
  eq(percentile([1, 2, 3, 4], 50), 2, "p50");
  eq(percentile([1, 2, 3, 4], 90), 4, "p90");
  eq(percentile([5], 50), 5, "single");
  eq(percentile([], 50), 0, "empty");

  // A biased sampler passes "deterministic" and still measures the wrong thing.
  const alphabet = "abcdefghijklmnopqrstuvwxyz".split("").map((c) => `${c}Name`);
  eq(stableSample(alphabet, 5), stableSample(alphabet, 5), "sample is deterministic");
  const picked = stableSample(alphabet, 6).map((s) => s[0]!);
  if (new Set(picked).size < 6) throw new Error("sample not distinct");
  if (picked.every((c) => c < "f")) throw new Error(`sample is alphabetically biased: ${picked}`);
  eq(stableSample([1, 2, 3], 10).length, 3, "sample smaller than n");

  eq(dedupeCaseInsensitive(["config", "Config", "auth"]), ["config", "auth"], "case dedupe");

  // A regex over raw text cannot tell code from talk about code.
  const at = (line: string, needle: string) => isCommentedOrQuoted(line, line.indexOf(needle));
  eq(at("export class RetryHandler {", "RetryHandler"), false, "real declaration");
  eq(at("// class RetryHandler was removed", "RetryHandler"), true, "commented out");
  eq(at(" * class RetryHandler — see docs", "RetryHandler"), true, "jsdoc line");
  eq(at("# def retry_handler():", "retry_handler"), true, "python comment");
  eq(at('const s = "function example";', "example"), true, "inside a string");
  eq(at('const URL = "https://x"; export class Thing {', "Thing"), false, "// inside a URL is not a comment");
  eq(at("x();/* class Removed */", "Removed"), true, "marker need not follow whitespace");
  eq(at('const note = " // "; export class Real {}', "Real"), false, "quoted marker is not a comment");
  eq(at("const s = 'it\\'s function example';", "example"), true, "escaped quote keeps string open");

  eq(parseArgs(["/definitely/not/here=pub"]).repos, [{ path: "/definitely/not/here", label: "pub" }], "label split");
  eq(parseArgs(["/definitely/not/here="]).repos, [{ path: "/definitely/not/here=" }], "empty label is a path");

  eq(byteToCharIndex("abc", 2), 2, "ascii offset is identity");
  eq(byteToCharIndex("café x", 6), 5, "multibyte byte offset → char index");
  eq(isCommentedOrQuoted("// café class Removed", "// café class Removed".indexOf("Removed")), true, "non-ascii comment");

  const fake = (names: string[]): Report =>
    ({ addressability: { worst: names.map((name) => ({ name, hits: 0, files: 0 })) }, sludge: { worst: [] } }) as unknown as Report;
  eq(sensitiveNames(fake(["adminToken", "ThreadId", "SERVICE_SECRET"])), ["adminToken", "SERVICE_SECRET"], "flags security-surface names");
  eq(sensitiveNames(fake(["ThreadId"])), [], "no false alarm");

  const pub = redactNames({ addressability: { worst: [{ name: "AtmosphereScreen", hits: 1, files: 1 }] },
    sludge: { worst: [{ query: "config", hits: 1, proseShare: 0, suspectShare: 0 }, { query: "compose", hits: 1, proseShare: 0, suspectShare: 0 }] } } as unknown as Report);
  eq(pub.addressability.worst[0]!.name, "name-01", "private identifier pseudonymised");
  eq(pub.sludge.worst[0]!.query, "config", "own generic query word kept");
  eq(pub.sludge.worst[1]!.query, "name-02", "repo-derived query pseudonymised");

  // Options must not be mistaken for repositories.
  eq(parseArgs(["../a", "--sample", "50", "--json"]), { repos: [{ path: "../a" }], sample: 50, json: true, redact: false }, "opt value");
  eq(parseArgs(["../a"]).sample, 120, "default sample");
  eq(parseArgs(["../a", "--redact-names"]).redact, true, "redact flag");
  eq(parseArgs(["../a=pub"]).repos, [{ path: "../a", label: "pub" }], "path=label");
  eq(parseArgs(["=x"]).repos, [{ path: "=x" }], "leading = is not a label");
  let threw = false;
  try { parseArgs(["../a", "--sample", "abc"]); } catch { threw = true; }
  if (!threw) throw new Error("bad --sample value must be rejected");

  console.log("selftest ok");
}

// ── main ──────────────────────────────────────────────────────────────────────

export type Target = { path: string; label?: string };

/** A repo argument is `path` or `path=label`; the label replaces the name in all output. */
export function parseArgs(argv: string[]): { repos: Target[]; sample: number; json: boolean; redact: boolean } {
  const repos: Target[] = [];
  let sample = 120, json = false, redact = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") json = true;
    else if (a === "--redact-names") redact = true;
    else if (a === "--sample") {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v < 1) throw new Error(`--sample needs a positive integer, got ${argv[i]}`);
      sample = v;
    } else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else {
      // `path=label`, unless the whole argument is itself a real directory — a path may
      // legitimately contain `=`, and the directory on disk wins over the label reading.
      const eq = a.lastIndexOf("=");
      const splittable = eq > 0 && eq < a.length - 1 && !existsSync(a);
      repos.push(splittable ? { path: a.slice(0, eq), label: a.slice(eq + 1) } : { path: a });
    }
  }
  return { repos, sample, json, redact };
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  if (argv.includes("--selftest")) { selftest(); process.exit(0); }
  try {
    const { repos, sample, json, redact } = parseArgs(argv);
    if (repos.length === 0) {
      console.error("usage: bun grep-hygiene.ts <repo|repo=label>... [--json] [--sample N] [--redact-names]");
      process.exit(1);
    }
    const out: Report[] = [];
    for (const t of repos) {
      // One unscannable repo must not discard the results for every other repo in the batch.
      try {
        out.push(await score(t.path, sample, t.label));
      } catch (e) {
        console.error(`grep-hygiene: skipping ${t.label ?? t.path}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (out.length === 0) process.exit(1);
    const shown = redact ? out.map(redactNames) : out;
    if (json) console.log(JSON.stringify(shown, null, 2));
    else shown.forEach(print);
    for (const r of shown) {
      if (r.scan.oversizedRecords || r.scan.nonUtf8Paths) {
        console.error(`\x1b[33mwarning: ${r.repo} scan skipped ${r.scan.oversizedRecords} over-long record(s) and ${r.scan.nonUtf8Paths} non-UTF-8 path(s)\x1b[0m`);
      }
      const risky = sensitiveNames(r);
      if (risky.length) {
        console.error(`\x1b[33mwarning: ${r.repo} report quotes security-surface names — review before publishing: ${risky.join(", ")}\x1b[0m`);
      }
    }
  } catch (e) {
    console.error(`grep-hygiene: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
