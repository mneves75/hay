#!/usr/bin/env bun
/**
 * benchmark — every code-search tool on this machine, on public repositories.
 *
 * The project's own evaluation is behavioural: real agent searches paired with the files the agent
 * opened next. It is the honest measurement and it is also unreproducible by anyone else, because
 * the transcripts are private. This is the complement: a corpus anybody can clone, ground truth
 * anybody can regenerate, and every tool that is actually installed.
 *
 * WHAT IT MEASURES, AND THE BIAS THAT COMES WITH IT
 * -------------------------------------------------
 * The task is *definition finding*: given a symbol, how far down the results does its declaration
 * sit? Ground truth comes from `ast-grep`, a real parser, not from any heuristic under test.
 *
 * `hay` is explicitly built to rank declarations first. So it should win this, and the number to
 * read is not "does it win" but "by how much, and does a structural tool that parses the code beat
 * it anyway". `ast-grep` is in the comparison for exactly that reason. Treat a `hay` win here as
 * weaker evidence than the behavioural result, which was not designed around the outcome.
 *
 * Usage:
 *   bun benchmark.ts [--corpora DIR] [--corpus NAME] [--sample N] [--seed N] [--out FILE] [--quick] [--skip-perf]
 *   bun benchmark.ts --docs-track [--corpus NAME] [--sample N] [--seed N]
 *   bun benchmark.ts --selftest
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { bootstrapCI, mean, median, mulberry32, randomizationP, type Interval } from "./measure-mrr.ts";

/** Beyond this many result lines the answer is unreachable by scrolling; RR counts as 0. */
const RANK_CAP = 1000;
/** A single search may not exceed this. Recorded as a timeout rather than silently dropped. */
const TIMEOUT_MS = 60_000;

// ── corpora ───────────────────────────────────────────────────────────────────

export type Corpus = {
  name: string;
  dir: string;
  clone?: string;
  lang: string;
  /** ast-grep patterns whose `$NAME` metavariable is the declared symbol. */
  patterns: string[];
};

export const CORPORA: Corpus[] = [
  {
    name: "linux",
    dir: "linux",
    clone: "https://github.com/torvalds/linux.git",
    lang: "c",
    patterns: ["$RET $NAME($$$ARGS) { $$$BODY }", "static $RET $NAME($$$ARGS) { $$$BODY }"],
  },
  {
    name: "openclaw",
    dir: "openclaw",
    clone: "https://github.com/openclaw/openclaw.git",
    lang: "ts",
    patterns: [
      "export function $NAME($$$ARGS) { $$$BODY }",
      "function $NAME($$$ARGS) { $$$BODY }",
      "export class $NAME { $$$BODY }",
    ],
  },
  {
    name: "ripgrep",
    dir: "ripgrep",
    clone: "https://github.com/BurntSushi/ripgrep.git",
    lang: "rust",
    patterns: ["fn $NAME($$$ARGS) { $$$BODY }", "pub fn $NAME($$$ARGS) { $$$BODY }"],
  },
  {
    // Added by the 2026-08-20 error taxonomy (issue 10): the behavioural corpus's language-gap
    // bucket is Swift (106 of the miss answer-file extensions), a language no public corpus
    // covered — the C story over again. Any Swift-motivated ranking change develops here.
    name: "alamofire",
    dir: "alamofire",
    clone: "https://github.com/Alamofire/Alamofire.git",
    lang: "swift",
    patterns: [
      "func $NAME($$$ARGS) { $$$BODY }",
      "public func $NAME($$$ARGS) -> $RET { $$$BODY }",
      "struct $NAME { $$$BODY }",
      "enum $NAME { $$$BODY }",
    ],
  },
  {
    name: "hay",
    dir: ".",
    lang: "rust",
    patterns: ["fn $NAME($$$ARGS) { $$$BODY }", "pub fn $NAME($$$ARGS) { $$$BODY }"],
  },
];

// ── tools ─────────────────────────────────────────────────────────────────────
//
// Absolute paths on purpose. `grep` on the author's machine is a shell function that resolves to
// ugrep, so benchmarking "grep" by name would have silently measured a different tool.
//
// Flags are normalised to the same job: recursive, fixed-string, case-sensitive, print
// `path:line:text`. They are NOT normalised on filtering, because filtering is a real difference
// between these tools and hiding it would flatter the ones that scan less. What each tool sees is
// recorded per corpus instead.

export type Tool = {
  id: string;
  label: string;
  /** Executable name, resolved through PATH at startup. */
  bin: string;
  /** Absolute paths tried before PATH, where a specific build is meant. */
  prefer?: string[];
  /** Argv after the binary. */
  args: (query: string, lang: string) => string[];
  /** Extract the file path from one output line, or null if the line is not a result. */
  parse: (line: string) => string | null;
  /** What the tool walks by default. */
  scope: string;
  ranked: boolean;
  note?: string;
};

const plain = (line: string): string | null => {
  const i = line.indexOf(":");
  if (i <= 0) return null;
  return normalizePath(line.slice(0, i));
};

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Where a tool actually is on THIS machine.
 *
 * Hard-coding `/opt/homebrew/bin` would have made the benchmark Apple-Silicon-Homebrew-only, and a
 * benchmark whose headline claim is reproducibility cannot report a tool as "not installed"
 * because the reader's package manager uses a different prefix. `prefer` still pins the cases
 * where a specific build is meant — `/usr/bin/grep` is BSD grep, while PATH `grep` may be ugrep or
 * GNU grep wearing the same name.
 */
export function resolveBin(t: { bin: string; prefer?: string[] }): string | null {
  for (const c of t.prefer ?? []) if (existsSync(c)) return c;
  return Bun.which(t.bin);
}

const AST_LANG: Record<string, string> = { c: "c", ts: "ts", rust: "rust", swift: "swift" };

/**
 * Strict, because the old `AST_LANG[lang] ?? "rust"` fallback meant the first Python or Go corpus
 * added would have had its ground truth built by parsing it AS RUST — garbage symbols, silently.
 * Ground truth built with the wrong grammar is exactly the quiet wrong answer this repo catalogues.
 */
export function astLang(lang: string): string {
  const l = AST_LANG[lang];
  if (!l) throw new Error(`unknown corpus lang "${lang}" — add it to AST_LANG before adding the corpus`);
  return l;
}

/**
 * The flags that make ripgrep walk the same file set `hay` does.
 *
 * `hay` fixes these internally and on purpose — `.git_global(false)`, `.git_exclude(false)`,
 * `.ignore(false)` — so that operator-local state cannot change results. ripgrep honours all three
 * by default, so without these flags the head-to-head is not a ranking comparison at all: it is two
 * tools walking different trees. Measured on the ripgrep corpus, which ships a `.ignore` containing
 * `!/.github/`, plus a machine with `core.excludesFile` set: **231 files versus 225.**
 *
 * This is the same defect that sat in `measure-mrr.ts` for four versions (`--hidden`), found here
 * by applying that fix's own rule — every filtering flag needs a named counterpart on both sides —
 * to the other harness. Filtering is deliberately NOT normalised across the *other* tools, because
 * what ugrep or ack skips is a real property of them; but `hay` claims to be a drop-in for ripgrep
 * that returns the same matches reordered, and that claim is only measurable against the same set.
 *
 * `--no-config` belongs here too: an inherited `RIPGREP_CONFIG_PATH` was instrument error 7.
 */
export const RG_PARITY = ["--no-config", "--no-ignore-dot", "--no-ignore-global", "--no-ignore-exclude"];

export const TOOLS: Tool[] = [
  {
    id: "hay",
    label: "hay (this project)",
    bin: "hay",
    prefer: [new URL("./hay/target/release/hay", import.meta.url).pathname],
    args: (q) => ["-F", "-n", "-m", "0", "-e", q, "."],
    parse: plain,
    scope: "gitignore-aware",
    ranked: true,
  },
  {
    id: "rg",
    label: "ripgrep (default order)",
    bin: "rg",
    args: (q) => [...RG_PARITY, "-F", "-n", "-e", q, "."],
    parse: plain,
    scope: "gitignore-aware",
    ranked: false,
    note: "default output order is nondeterministic under parallel traversal",
  },
  {
    id: "rg-sorted",
    label: "ripgrep --sort path",
    bin: "rg",
    args: (q) => [...RG_PARITY, "-F", "-n", "--sort", "path", "-e", q, "."],
    parse: plain,
    scope: "gitignore-aware",
    ranked: false,
  },
  {
    id: "ugrep",
    label: "ugrep",
    bin: "ugrep",
    args: (q) => ["-rnF", "--ignore-files", "-e", q, "."],
    parse: plain,
    scope: "gitignore-aware",
    ranked: false,
  },
  {
    id: "ag",
    label: "the_silver_searcher",
    bin: "ag",
    args: (q) => ["--nocolor", "--literal", "--noheading", "--", q, "."],
    parse: plain,
    scope: "own ignore rules",
    ranked: false,
  },
  {
    id: "ack",
    label: "ack",
    bin: "ack",
    args: (q) => ["--nocolor", "--literal", "--nogroup", "--match", q, "."],
    parse: plain,
    scope: "known source types only",
    ranked: false,
  },
  {
    id: "grep",
    label: "BSD grep",
    bin: "grep",
    prefer: ["/usr/bin/grep"],
    args: (q) => ["-rnF", "--exclude-dir=.git", "-e", q, "."],
    parse: plain,
    scope: "everything but .git",
    ranked: false,
    note: ".git excluded by hand; grep has no ignore support, and without this it searches packfiles",
  },
  {
    id: "git-grep",
    label: "git grep",
    bin: "git",
    args: (q) => ["grep", "-nF", "-e", q],
    parse: plain,
    scope: "tracked files only",
    ranked: false,
    note: "cannot see untracked files at all",
  },
  {
    // The closest prior art: a ranked, index-free code-search CLI (BM25 + structural boosts).
    // Until it was here, "first on all corpora" was a claim made without the one competitor
    // that also ranks. Its unit of output is the FILE (one ranked line per file with a snippet),
    // not the match line — that is its real interface, recorded rather than normalised away.
    // No -F flag exists; benchmark queries are asserted `\w+` at generation, so literal-versus-
    // regex cannot differ. `-c` for case sensitivity matches the other tools' normalisation.
    id: "cs",
    label: "codespelunker (ranked)",
    bin: "cs",
    prefer: [`${process.env["HOME"]}/go/bin/cs`],
    args: (q) => ["-f", "vimgrep", "-c", q],
    parse: plain,
    scope: "own ignore rules",
    ranked: true,
    note: "ranks FILES (one line each), so line-rank comparisons read favourably for it",
  },
  {
    id: "ast-grep",
    label: "ast-grep (structural)",
    bin: "ast-grep",
    args: (q, lang) => ["--lang", astLang(lang), "-p", q, "--json=stream", "."],
    parse: (line) => {
      try {
        const o = JSON.parse(line);
        return typeof o.file === "string" ? normalizePath(o.file) : null;
      } catch {
        return null;
      }
    },
    scope: "parsed source of one language",
    ranked: false,
    note: "matches identifier nodes, so comments and strings never appear — precision, not ranking",
  },
];

// ── ground truth ──────────────────────────────────────────────────────────────

export type Query = { symbol: string; answer: string; occurrences: number };

export const DOC_SHAPES = [
  "flagShaped", "hyphenated", "snakeCase", "upperCase", "camelCase", "pascalCase", "plainWord",
] as const;
export type DocShape = typeof DOC_SHAPES[number];
export type DocFeatures = Record<DocShape, boolean>;
export type DocsQuery = {
  token: string;
  answer: string;
  /** Number of distinct parity-visible files containing the token, not matching lines. */
  occurrences: number;
  features: DocFeatures;
};

/**
 * One bucket per token, in a fixed precedence that keeps the named shapes interpretable.
 *
 * Double-hyphen flags win because `--x` is the pre-registration's named flag shape; the same
 * tokenizer also admits single-leading-hyphen tokens, which form the separate hyphenated bucket.
 * All-caps wins before underscores so `UPPER_CASE` remains uppercase rather than snake case;
 * the case shapes follow the separator shapes, with an unshaped word as fallback. PascalCase is
 * its own bucket: review caught `AuthenticationInterceptor` classified as a plain word, which
 * silently merged the most code-shaped doc queries into the least code-shaped bucket.
 */
export function docFeatures(token: string): DocFeatures {
  let shape: DocShape;
  if (/^--/.test(token)) shape = "flagShaped";
  else if (/[A-Z]/.test(token) && token === token.toUpperCase()) shape = "upperCase";
  else if (token.includes("_")) shape = "snakeCase";
  else if (token.includes("-")) shape = "hyphenated";
  else if (/^[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*$/.test(token)) shape = "camelCase";
  else if (/^[A-Z][A-Za-z0-9]*[a-z]/.test(token)) shape = "pascalCase";
  else shape = "plainWord";
  return Object.fromEntries(DOC_SHAPES.map((s) => [s, s === shape])) as DocFeatures;
}

const HEADING_TOKEN = /--?[A-Za-z][A-Za-z0-9_-]{2,}|[A-Za-z_][A-Za-z0-9_]{2,}/g;

/** Run ripgrep as part of ground-truth derivation, refusing an incomplete exit as evidence. */
async function rgLines(root: string, args: string[], purpose: string): Promise<string[]> {
  const rg = Bun.which("rg");
  if (!rg) throw new Error("ripgrep is required to build docs ground truth; install it");
  const proc = Bun.spawn([rg, ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [text, error, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code > 1) throw new Error(`${purpose} failed (rg exit ${code}): ${error.trim() || "no diagnostic"}`);
  return text.split("\n").filter(Boolean);
}

/**
 * Mechanical public ground truth for documentation retrieval.
 *
 * The heading walk and the distinct-file occurrence search both copy RG_PARITY, the same
 * visibility contract used by the ranked runs. The `*.md` glob narrows only which visible files
 * may supply an answer heading; qualification still searches the whole visible corpus.
 */
export async function docsGroundTruth(root: string, corpus: Corpus): Promise<DocsQuery[]> {
  const markdown = (await rgLines(
    root,
    [...RG_PARITY, "--files", "-g", "*.md", "."],
    `${corpus.name} markdown enumeration`,
  )).map(normalizePath).sort();
  const headingFiles = new Map<string, Set<string>>();
  for (const file of markdown) {
    const text = await Bun.file(join(root, file)).text();
    for (const line of text.split("\n")) {
      // CommonMark allows up to three leading spaces before an ATX heading; ignoring them would
      // treat `# Topic` and `  ## Topic` as heading files of different tokens.
      if (!/^ {0,3}#{1,6}\s/.test(line)) continue;
      for (const token of line.match(HEADING_TOKEN) ?? []) {
        headingFiles.set(token, (headingFiles.get(token) ?? new Set()).add(file));
      }
    }
  }

  const queries: DocsQuery[] = [];
  for (const token of [...headingFiles.keys()].sort()) {
    const answers = headingFiles.get(token)!;
    if (answers.size !== 1) continue;
    const files = new Set((await rgLines(
      root,
      [...RG_PARITY, "-F", "-l", "-e", token, "."],
      `${corpus.name} docs occurrence search for ${JSON.stringify(token)}`,
    )).map(normalizePath));
    if (files.size < 3) continue;
    queries.push({ token, answer: [...answers][0]!, occurrences: files.size, features: docFeatures(token) });
  }
  return queries;
}

/**
 * Symbols declared exactly once in the corpus, according to a parser.
 *
 * A symbol declared in two places has no single right answer, so it is dropped rather than scored
 * against an arbitrary one. Ground truth deliberately comes from `ast-grep` rather than from any
 * heuristic a benchmarked tool uses.
 */
export async function groundTruth(root: string, c: Corpus): Promise<Map<string, string>> {
  const sites = new Map<string, Set<string>>();
  for (const pattern of c.patterns) {
    const astGrep = Bun.which("ast-grep");
    if (!astGrep) throw new Error("ast-grep is required to build ground truth; install it first");
    const proc = Bun.spawn(
      [astGrep, "--lang", astLang(c.lang), "-p", pattern, "--json=stream", "."],
      { cwd: root, stdout: "pipe", stderr: "ignore" },
    );
    const text = await new Response(proc.stdout).text();
    await proc.exited.catch(() => {});
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let o: { file?: string; metaVariables?: { single?: Record<string, { text?: string }> } };
      try { o = JSON.parse(line); } catch { continue; }
      const name = o.metaVariables?.single?.["NAME"]?.text;
      const file = o.file;
      if (!name || !file) continue;
      sites.set(name, (sites.get(name) ?? new Set()).add(normalizePath(file)));
    }
  }
  // Sorted, because the caller samples from these keys with a fixed seed and a Map iterates in
  // insertion order — which here is the order ast-grep's PARALLEL walk happened to emit files.
  // Without this the "deterministic" sample silently drew a different query set on every run, and
  // two runs of the same binary disagreed on MRR by 0.01.
  const unique = new Map<string, string>();
  for (const name of [...sites.keys()].sort()) {
    const files = sites.get(name)!;
    if (files.size === 1) unique.set(name, [...files][0]!);
  }
  return unique;
}

/** How many result lines a plain search returns. Filters out trivial and pathological symbols. */
async function occurrences(root: string, symbol: string): Promise<number> {
  const rg = Bun.which("rg");
  if (!rg) throw new Error("ripgrep is required to count occurrences; install it");
  // Same walk as the tools under test, so query selection cannot depend on the operator's global
  // gitignore — otherwise the "deterministic, seeded" sample is only deterministic per machine.
  const proc = Bun.spawn([rg, ...RG_PARITY, "-F", "-c", "--no-filename", "-e", symbol, "."], {
    cwd: root, stdout: "pipe", stderr: "ignore",
  });
  const text = await new Response(proc.stdout).text();
  await proc.exited.catch(() => {});
  return text.split("\n").filter(Boolean).reduce((a, b) => a + (Number(b) || 0), 0);
}

/** Deterministic sample: same corpus, same seed, same queries. */
export function sample<T>(xs: T[], n: number, seed: number): T[] {
  const rand = mulberry32(seed);
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}

// ── measurement ───────────────────────────────────────────────────────────────

/** Prior-evidence → per-corpus symbol lists for --queries-from. Fails closed on anything that
 *  cannot pin at least one corpus, because silently empty pins would degrade into independent
 *  sampling while looking like a paired comparison. */
export function parsePinned(prior: { corpora?: { corpus: string; symbols?: unknown }[] }): Map<string, string[]> {
  if (!Array.isArray(prior.corpora) || prior.corpora.length === 0)
    throw new Error("--queries-from file has no corpora; run once without --queries-from first");
  return new Map(
    (prior.corpora ?? []).map((c) => {
      if (!Array.isArray(c.symbols) || c.symbols.some((s) => typeof s !== "string"))
        throw new Error(`--queries-from: corpus ${c.corpus} has no usable symbols list (re-run once without pinning first)`);
      return [c.corpus, c.symbols as string[]];
    }),
  );
}

export type RunResult = { rank: number | null; scanned: number; timedOut: boolean; truncated: boolean };

/**
 * Rank of the first result line that lands in the declaring file.
 *
 * Streams and stops early, then kills the child. Without that, measuring a slow tool over the
 * kernel would cost a full scan per query instead of the time to the answer.
 */
export async function rankOf(tool: Tool, root: string, q: Query, lang: string): Promise<RunResult> {
  const bin = resolveBin(tool);
  if (!bin) return { rank: null, scanned: 0, timedOut: false, truncated: false };
  const proc = Bun.spawn([bin, ...tool.args(q.symbol, lang)], {
    cwd: root, stdout: "pipe", stderr: "ignore",
  });
  const dec = new TextDecoder();
  let buf = "", scanned = 0, rank: number | null = null, timedOut = false, truncated = false;
  // Set INSIDE the callback: killing the child closes stdout as an ordinary EOF, so the loop below
  // ends normally and the `catch` never runs. Without this the report counts zero timeouts no
  // matter how many searches hit the cap, and a timeout is indistinguishable from "not found".
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, TIMEOUT_MS);
  try {
    outer: for await (const chunk of proc.stdout as AsyncIterable<Uint8Array>) {
      buf += dec.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const path = tool.parse(line);
        if (path === null) continue;
        scanned++;
        if (path === q.answer) { rank = scanned; break outer; }
        if (scanned >= RANK_CAP) { truncated = true; break outer; }
      }
    }
  } catch { timedOut = true; }
  clearTimeout(timer);
  proc.kill();
  await proc.exited.catch(() => {});
  return { rank, scanned, timedOut, truncated };
}

export type Timing = { medianMs: number | null; minMs: number | null; peakRssMb: number | null; timedOut: boolean };

/** Wall time and peak RSS of a COMPLETE search, output discarded. Median of `reps` after a warmup. */
async function time(tool: Tool, root: string, query: string, lang: string, reps: number): Promise<Timing> {
  const bin = resolveBin(tool);
  if (!bin) return { medianMs: null, minMs: null, peakRssMb: null, timedOut: false };
  const timeBin = Bun.which("time") ?? "/usr/bin/time";
  const run = async (): Promise<{ ms: number; rssMb: number | null; timedOut: boolean }> => {
    const started = performance.now();
    // `/usr/bin/time -l` reports peak RSS on macOS. Elsewhere it is absent and RSS stays null
    // rather than being guessed.
    const proc = Bun.spawn([timeBin, "-l", bin, ...tool.args(query, lang)], {
      cwd: root, stdout: "ignore", stderr: "pipe",
    });
    let killed = false;
    let finished = false;
    // The searched-for tool is a CHILD of the `time` wrapper. Killing only the wrapper leaves the
    // search running, and it still holds the stderr pipe — so the read below would block until the
    // orphan finished, which is the opposite of a timeout. Kill the descendants first, then race
    // the read so a wedged pipe can never hang the whole benchmark.
    //
    // `finished` guards a real if narrow hazard: if the process exits in the moment between the
    // read completing and clearTimeout, its PID can already belong to something else, and
    // `pkill -P` would then kill an unrelated process's children.
    const timer = setTimeout(() => {
      // `exitCode !== null` narrows the same hazard `finished` guards from the other side: once
      // the child has reaped, its PID is free to be reused and `pkill -P` would kill an unrelated
      // process's children. Two cheap checks, because the destructive call is the one to be sure
      // about.
      if (finished || proc.exitCode !== null) return;
      killed = true;
      if (proc.pid) Bun.spawnSync([Bun.which("pkill") ?? "/usr/bin/pkill", "-P", String(proc.pid)]);
      proc.kill("SIGKILL");
    }, TIMEOUT_MS);
    const err = await Promise.race([
      new Response(proc.stderr).text(),
      new Promise<string>((r) => setTimeout(() => r(""), TIMEOUT_MS + 5_000)),
    ]);
    await proc.exited.catch(() => {});
    finished = true;
    clearTimeout(timer);
    const m = err.match(/(\d+)\s+maximum resident set size/);
    return { ms: performance.now() - started, rssMb: m ? Number(m[1]) / 1048576 : null, timedOut: killed };
  };
  await run(); // warm the page cache; a cold first run measures the filesystem, not the tool
  const runs = [];
  for (let i = 0; i < reps; i++) runs.push(await run());
  if (runs.some((r) => r.timedOut)) return { medianMs: null, minMs: null, peakRssMb: null, timedOut: true };
  const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
  const rss = runs.map((r) => r.rssMb).filter((x): x is number => x !== null);
  return {
    medianMs: median(ms),
    minMs: ms[0]!,
    peakRssMb: rss.length ? Math.max(...rss) : null,
    timedOut: false,
  };
}

// ── report shape ──────────────────────────────────────────────────────────────

export type ToolScore = {
  tool: string;
  label: string;
  available: boolean;
  queries: number;
  mrr: number;
  top10: number;
  medianRank: number | null;
  unreachable: number;
  timeouts: number;
  /** Paired difference against the ripgrep default-order baseline. Absent for the baseline. */
  vsRipgrep?: Interval;
  /** Fisher's paired randomization test on the same differences — Smucker et al.'s reference. */
  vsRipgrepRandP?: number;
};

export type CorpusReport = {
  corpus: string;
  lang: string;
  files: { onDisk: number; rgVisible: number; gitTracked: number };
  symbolsUniquelyDeclared: number;
  queries: number;
  /** The exact symbols this run asked, in order. Written so a later run can pin them with
   *  --queries-from and produce a truly paired before/after comparison instead of hoping two
   *  independent samples overlap. */
  symbols: string[];
  tools: ToolScore[];
  perf: { query: string; results: Record<string, Timing> }[];
};

/** `median` from the measurement kit, kept null-returning here so an empty column prints as `-`. */
const medianOf = (xs: number[]) => (xs.length === 0 ? null : median(xs));

async function countFiles(root: string): Promise<{ onDisk: number; rgVisible: number; gitTracked: number }> {
  const count = async (cmd: string[]) => {
    const p = Bun.spawn(cmd, { cwd: root, stdout: "pipe", stderr: "ignore" });
    const t = await new Response(p.stdout).text();
    await p.exited.catch(() => {});
    return t.split("\n").filter(Boolean).length;
  };
  return {
    onDisk: await count([Bun.which("find") ?? "/usr/bin/find", ".", "-type", "f", "-not", "-path", "./.git/*"]),
    // Reported as what the searched-alike tools actually walk, not what a default rg would.
    rgVisible: await count([Bun.which("rg") ?? "rg", ...RG_PARITY, "--files"]),
    gitTracked: await count([Bun.which("git") ?? "git", "ls-files"]),
  };
}

// ── docs track ────────────────────────────────────────────────────────────────

type DocsTool = "hay" | "rg";
export type DocsQueryRecord = DocsQuery & { tools: Record<DocsTool, RunResult> };
export type DocsAggregate = {
  tools: Record<DocsTool, { mrr: number; top10: number }>;
  delta: { mrr: Interval; randomizationP: number };
  featureSplits: {
    feature: DocShape;
    n: number;
    mrr: Record<DocsTool, number>;
    deltaMrr: number;
  }[];
  truncations: Record<DocsTool, number>;
};
export type DocsCorpusReport = DocsAggregate & {
  corpus: string;
  lang: string;
  eligibleQueries: number;
  queries: DocsQueryRecord[];
};
export type DocsTrackPayload = {
  generatedBy: string;
  task: string;
  groundTruth: string;
  meta: {
    date: string;
    seed: number;
    sample: number;
    rankCap: number;
    versions: Record<DocsTool, string>;
  };
  corpora: DocsCorpusReport[];
};

const reciprocalRank = (r: RunResult): number => r.rank ? 1 / r.rank : 0;

/** One summarizer owns the paired unit, feature counts, and this track's line-cap accounting. */
export function summarizeDocs(records: DocsQueryRecord[]): DocsAggregate {
  const rr = (tool: DocsTool, rows = records) => rows.map((q) => reciprocalRank(q.tools[tool]));
  const toolSummary = (tool: DocsTool) => ({
    mrr: mean(rr(tool)),
    top10: records.filter((q) => {
      const rank = q.tools[tool].rank;
      return rank !== null && rank <= 10;
    }).length / (records.length || 1),
  });
  const diffs = records.map((q) => [reciprocalRank(q.tools.hay) - reciprocalRank(q.tools.rg)]);
  return {
    tools: { hay: toolSummary("hay"), rg: toolSummary("rg") },
    delta: { mrr: bootstrapCI(diffs), randomizationP: randomizationP(diffs) },
    featureSplits: DOC_SHAPES.map((feature) => {
      const rows = records.filter((q) => q.features[feature]);
      const hay = mean(rr("hay", rows));
      const rg = mean(rr("rg", rows));
      return { feature, n: rows.length, mrr: { hay, rg }, deltaMrr: hay - rg };
    }),
    truncations: {
      hay: records.filter((q) => q.tools.hay.truncated).length,
      rg: records.filter((q) => q.tools.rg.truncated).length,
    },
  };
}

async function versionsFor(tools: Tool[]): Promise<Record<string, string>> {
  const versions: Record<string, string> = {};
  for (const tool of tools) {
    const bin = resolveBin(tool);
    if (!bin) { versions[tool.id] = "not installed"; continue; }
    const proc = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "ignore" });
    versions[tool.id] = (await new Response(proc.stdout).text()).split("\n")[0]!.trim();
    await proc.exited.catch(() => {});
  }
  return versions;
}

async function runDocsTrack(
  corpora: Corpus[], corporaDir: string, sampleSize: number, seed: number, out: string,
): Promise<DocsTrackPayload> {
  const tools = TOOLS.filter((tool): tool is Tool & { id: DocsTool } => tool.id === "hay" || tool.id === "rg");
  if (tools.length !== 2) throw new Error("docs track requires exactly the existing hay and rg tool definitions");
  for (const tool of tools) {
    if (!resolveBin(tool)) throw new Error(`docs track requires ${tool.id}; build or install it first`);
  }
  const reports: DocsCorpusReport[] = [];
  for (const corpus of corpora) {
    const root = corpus.dir === "." ? process.cwd() : `${corporaDir}/${corpus.dir}`;
    if (!existsSync(root)) {
      console.error(`skipping ${corpus.name}: ${root} is absent${corpus.clone ? ` (git clone --depth 1 ${corpus.clone})` : ""}`);
      continue;
    }
    console.error(`\n=== ${corpus.name} docs track ===`);
    const eligible = await docsGroundTruth(root, corpus);
    const selected = sample(eligible, sampleSize, seed);
    console.error(`  ${eligible.length} eligible docs queries; sampled ${selected.length}`);
    const queries: DocsQueryRecord[] = [];
    for (const query of selected) {
      const rankQuery: Query = { symbol: query.token, answer: query.answer, occurrences: query.occurrences };
      const results = {} as Record<DocsTool, RunResult>;
      for (const tool of tools) results[tool.id] = await rankOf(tool, root, rankQuery, corpus.lang);
      queries.push({ ...query, tools: results });
    }
    const aggregate = summarizeDocs(queries);
    console.error(
      `  hay MRR ${aggregate.tools.hay.mrr.toFixed(3)}; rg MRR ${aggregate.tools.rg.mrr.toFixed(3)}; ` +
      `delta ${aggregate.delta.mrr.mean >= 0 ? "+" : ""}${aggregate.delta.mrr.mean.toFixed(3)}`,
    );
    reports.push({
      corpus: corpus.name,
      lang: corpus.lang,
      eligibleQueries: eligible.length,
      queries,
      ...aggregate,
    });
  }

  const rawVersions = await versionsFor(tools);
  const payload: DocsTrackPayload = {
    generatedBy: "benchmark.ts --docs-track",
    task: "documentation retrieval: rank of the first result line in the uniquely headed markdown file",
    groundTruth: "identifier-like token in an ATX heading of exactly one markdown file and present in at least three parity-visible files",
    meta: {
      date: new Date().toISOString().slice(0, 10),
      seed,
      sample: sampleSize,
      rankCap: RANK_CAP,
      versions: { hay: rawVersions["hay"]!, rg: rawVersions["rg"]! },
    },
    corpora: reports,
  };
  await Bun.write(out, JSON.stringify(payload, null, 2));
  console.error(`\nwrote ${out}`);
  return payload;
}

// ── main ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const flag = (name: string, fallback?: string) => {
    const i = argv.indexOf(name);
    if (i === -1) return fallback;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
    return v;
  };

  if (argv.includes("--selftest")) {
    const eq = (a: unknown, b: unknown, m: string) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    };
    eq(normalizePath("./src/a.ts"), "src/a.ts", "leading ./ stripped");
    eq(normalizePath("src\\a.ts"), "src/a.ts", "windows separators");
    eq(normalizePath("src/a.ts"), "src/a.ts", "already normal");
    // Every tool's parser must agree on the same `path:line:text` line, or ranks are not comparable.
    for (const t of TOOLS.filter((t) => t.id !== "ast-grep")) {
      eq(t.parse("./src/a.ts:12:code"), "src/a.ts", `${t.id} parses a result line`);
      eq(t.parse(""), null, `${t.id} rejects an empty line`);
    }
    const ag = TOOLS.find((t) => t.id === "ast-grep")!;
    eq(ag.parse(JSON.stringify({ file: "./src/a.ts" })), "src/a.ts", "ast-grep parses json");
    eq(ag.parse("not json"), null, "ast-grep rejects non-json");
    // Invariant 6, as a test: hay is measured against ripgrep as a drop-in, so both must be asked
    // to walk the same tree. hay disables global gitignore, .git/info/exclude and .ignore files
    // internally; ripgrep honours all three unless told not to. 231 files versus 225 on the
    // ripgrep corpus before this was fixed.
    for (const id of ["rg", "rg-sorted"]) {
      const argv = TOOLS.find((t) => t.id === id)!.args("q", "rust");
      for (const flag of ["--no-config", "--no-ignore-dot", "--no-ignore-global", "--no-ignore-exclude"]) {
        if (!argv.includes(flag)) throw new Error(`${id} must pass ${flag} to walk hay's file set`);
      }
    }
    // Ground truth with the wrong grammar is garbage that parses: every corpus lang must be
    // known, and an unknown one must refuse rather than fall back to Rust.
    for (const c of CORPORA) astLang(c.lang);
    let langThrew = false;
    try { astLang("cobol"); } catch { langThrew = true; }
    if (!langThrew) throw new Error("an unknown corpus lang must throw, not silently parse as rust");
    // A deterministic sample is what makes the benchmark rerunnable.
    eq(sample([1, 2, 3, 4, 5], 3, 7), sample([1, 2, 3, 4, 5], 3, 7), "same seed, same sample");
    // --queries-from: a prior evidence file must pin exactly its symbols, and anything that is
    // not a symbols array must fail loudly — silent empty pins would fake a paired comparison.
    eq([...parsePinned({ corpora: [{ corpus: "a", symbols: ["foo", "bar"] }, { corpus: "b", symbols: [] }] }).get("a")!], ["foo", "bar"], "pins round-trip");
    for (const bad of [{}, { corpora: [{}] }, { corpora: [{ corpus: "a", symbols: [1] }] }]) {
      try { parsePinned(bad as never); throw new Error("parsePinned accepted unusable pins"); }
      catch (e) { if (!String(e).includes("--queries-from")) throw e; }
    }
    if (JSON.stringify(sample([1, 2, 3, 4, 5], 3, 7)) === JSON.stringify(sample([1, 2, 3, 4, 5], 3, 8)))
      throw new Error("different seeds should give different samples");
    // Docs ground truth is deliberately parser-free. The fixture pins all three gates together:
    // ATX-only headings, exactly one heading file, and at least three distinct matching files.
    const fixture = mkdtempSync(join(tmpdir(), "hay-docs-track-"));
    try {
      await Bun.write(join(fixture, "answer.md"), [
        "# UniqueToken --long-flag -short-flag snake_case UPPER_CASE camelCase plainword SharedToken NoiseOnly",
        "body",
      ].join("\n"));
      await Bun.write(join(fixture, "shared.md"), "## SharedToken\n");
      // Indented up to three spaces is still an ATX heading per CommonMark; ignoring that would
      // both miss answers and wrongly grant uniqueness (review finding).
      await Bun.write(join(fixture, "indent.md"), "  ## IndentedTok\n");
      const repeated = "UniqueToken --long-flag -short-flag snake_case UPPER_CASE camelCase plainword SharedToken IndentedTok";
      await Bun.write(join(fixture, "use-a.ts"), repeated);
      await Bun.write(join(fixture, "use-b.rs"), repeated);
      const derived = await docsGroundTruth(fixture, { name: "fixture", dir: ".", lang: "rust", patterns: [] });
      const byToken = new Map(derived.map((q) => [q.token, q]));
      for (const token of ["UniqueToken", "--long-flag", "-short-flag", "snake_case", "UPPER_CASE", "camelCase", "plainword"]) {
        eq(byToken.get(token)?.answer, "answer.md", `${token} has its one heading file as answer`);
        eq(byToken.get(token)?.occurrences, 3, `${token} occurs in three distinct files`);
      }
      eq(byToken.has("SharedToken"), false, "a token headed in two markdown files is excluded");
      eq(byToken.has("NoiseOnly"), false, "a token present in fewer than three files is excluded");
      eq(byToken.get("IndentedTok")?.answer, "indent.md", "an indented ATX heading still anchors its file");
      const shape = (token: string) => DOC_SHAPES.find((s) => docFeatures(token)[s]);
      eq(shape("--long-flag"), "flagShaped", "flag precedence");
      eq(shape("UPPER_CASE"), "upperCase", "uppercase precedes snake case");
      eq(shape("snake_case"), "snakeCase", "snake case");
      eq(shape("-short-flag"), "hyphenated", "single-leading-hyphen token");
      eq(shape("camelCase"), "camelCase", "camel case");
      eq(shape("UniqueToken"), "pascalCase", "PascalCase is not a plain word (review finding)");
      eq(shape("plainword"), "plainWord", "plain word");

      // The docs track reuses rankOf's result-line cap. A synthetic search emits the answer only
      // after the cap so this stays fast, deterministic, and independent of ast-grep or a clone.
      const bun = Bun.which("bun");
      if (!bun) throw new Error("selftest requires bun");
      const capTool: Tool = {
        id: "cap-fixture", label: "cap fixture", bin: bun,
        args: () => ["-e", `for (let i = 0; i < ${RANK_CAP}; i++) console.log('noise.ts:' + i + ':x'); console.log('answer.md:1:x')`],
        parse: plain, scope: "fixture", ranked: false,
      };
      const capped = await rankOf(capTool, fixture, { symbol: "plainword", answer: "answer.md", occurrences: 3 }, "rust");
      eq(capped, { rank: null, scanned: RANK_CAP, timedOut: false, truncated: true }, "docs result-line cap is explicit");
      const complete: RunResult = { rank: 1, scanned: 1, timedOut: false, truncated: false };
      const summary = summarizeDocs([{
        token: "plainword", answer: "answer.md", occurrences: 3, features: docFeatures("plainword"),
        tools: { hay: capped, rg: complete },
      }]);
      eq(summary.truncations, { hay: 1, rg: 0 }, "docs truncations are counted per tool");
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
    console.log("selftest ok");
    process.exit(0);
  }

  const cacheHome = process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache");
  const corporaDir = flag("--corpora", join(cacheHome, "hay", "corpora"))!;
  const quick = argv.includes("--quick");
  const sampleSize = Number(flag("--sample", quick ? "15" : "60"));
  const seed = Number(flag("--seed", "20260820"));
  if (!Number.isInteger(sampleSize) || sampleSize < 1) throw new Error("--sample must be a positive integer");
  if (!Number.isInteger(seed)) throw new Error("--seed must be an integer");
  const reps = quick ? 1 : 3;
  const corpusName = flag("--corpus", "")!;
  const selectedCorpora = corpusName ? CORPORA.filter((c) => c.name === corpusName) : CORPORA;
  if (corpusName && selectedCorpora.length === 0)
    throw new Error(`unknown corpus ${JSON.stringify(corpusName)}; choose ${CORPORA.map((c) => c.name).join(", ")}`);
  const docsTrack = argv.includes("--docs-track");
  const out = flag("--out", docsTrack ? "evidence/docs-track.json" : "evidence/benchmark.json")!;

  if (docsTrack) {
    const payload = await runDocsTrack(selectedCorpora, corporaDir, sampleSize, seed, out);
    if (argv.includes("--json")) console.log(JSON.stringify(payload, null, 2));
    process.exit(0);
  }

  // --queries-from evidence/benchmark.json: reuse the exact symbols a previous run asked, so a
  // before/after comparison is paired at the query level instead of hoping two independent
  // samples overlap. Symbols whose declaration is no longer unique in the tree are skipped,
  // loudly — silently shrinking n would quietly widen every interval that follows.
  const priorPath = flag("--queries-from", "");
  const pinned = priorPath ? parsePinned(await Bun.file(priorPath).json()) : new Map<string, string[]>();
  const versions = await versionsFor(TOOLS);

  // Machine load belongs in the artifact: these timings self-load, so a busy machine shifts the
  // whole floor and would otherwise read as a change in the code. `uptime` is the whole source —
  // an earlier line here read /dev/null into a variable named `loadavg` and never used it, which
  // looked like a second, independent measurement and was nothing at all.
  const upt = Bun.spawnSync(["/usr/bin/uptime"]);
  const loadLine = new TextDecoder().decode(upt.stdout).trim();

  const reports: CorpusReport[] = [];
  for (const c of selectedCorpora) {
    const root = c.dir === "." ? process.cwd() : `${corporaDir}/${c.dir}`;
    if (!existsSync(root)) {
      console.error(`skipping ${c.name}: ${root} is absent${c.clone ? ` (git clone --depth 1 ${c.clone})` : ""}`);
      continue;
    }
    console.error(`\n=== ${c.name} (${c.lang}) ===`);
    const files = await countFiles(root);
    const truth = await groundTruth(root, c);
    console.error(`  ${truth.size} symbols declared exactly once`);

    // Non-trivial searches only: a symbol with three hits is not a retrieval problem, and one with
    // thousands is a different (and pathological) one.
    const pins = pinned.get(c.name);
    const queries: Query[] = [];
    if (pins?.length) {
      let dropped = 0;
      for (const symbol of pins) {
        // Every benchmarked tool is fed the symbol as a literal, but cs has no -F flag: this
        // assertion is what makes literal-versus-regex provably unable to differ. If a corpus
        // ever yields a symbol with regex metacharacters, fail here rather than compare unlike
        // things quietly.
        if (!/^\w+$/.test(symbol)) throw new Error(`symbol ${JSON.stringify(symbol)} is not \\w+; the cross-tool literal/regex equivalence no longer holds`);
        const answer = truth.get(symbol);
        if (!answer) { dropped++; continue; }
        queries.push({ symbol, answer, occurrences: await occurrences(root, symbol) });
      }
      console.error(`  pinned sample from ${priorPath}: ${queries.length} queries` + (dropped ? ` (${dropped} skipped: no longer declared exactly once)` : ""));
    } else {
      const candidates = sample([...truth.keys()].filter((s) => s.length >= 5), sampleSize * 4, seed);
      for (const symbol of candidates) {
        if (queries.length >= sampleSize) break;
        const n = await occurrences(root, symbol);
        // Same literal/regex assertion as the pinned branch above.
        if (!/^\w+$/.test(symbol)) throw new Error(`symbol ${JSON.stringify(symbol)} is not \\w+; the cross-tool literal/regex equivalence no longer holds`);
        if (n >= 5 && n <= 2000) queries.push({ symbol, answer: truth.get(symbol)!, occurrences: n });
      }
      console.error(`  ${queries.length} queries with 5..2000 occurrences`);
    }

    const perTool = new Map<string, RunResult[]>();
    for (const t of TOOLS) {
      const results: RunResult[] = [];
      for (const q of queries) results.push(await rankOf(t, root, q, c.lang));
      perTool.set(t.id, results);
      const rr = results.map((r) => (r.rank ? 1 / r.rank : 0));
      console.error(`  ${t.label.padEnd(24)} MRR ${mean(rr).toFixed(3)}  top10 ${(results.filter((r) => r.rank !== null && r.rank <= 10).length / (results.length || 1) * 100).toFixed(0).padStart(3)}%`);
    }

    const base = perTool.get("rg")!;
    const tools: ToolScore[] = TOOLS.map((t) => {
      const rs = perTool.get(t.id)!;
      const rr = rs.map((r) => (r.rank ? 1 / r.rank : 0));
      const baseRr = base.map((r) => (r.rank ? 1 / r.rank : 0));
      const score: ToolScore = {
        tool: t.id,
        label: t.label,
        available: resolveBin(t) !== null,
        queries: rs.length,
        mrr: mean(rr),
        top10: rs.filter((r) => r.rank !== null && r.rank <= 10).length / (rs.length || 1),
        medianRank: medianOf(rs.filter((r) => r.rank !== null).map((r) => r.rank!)),
        unreachable: rs.filter((r) => r.rank === null).length / (rs.length || 1),
        timeouts: rs.filter((r) => r.timedOut).length,
      };
      if (t.id !== "rg" && rs.length > 0) {
        const diffs = rr.map((v, i) => [v - (baseRr[i] ?? 0)]);
        score.vsRipgrep = bootstrapCI(diffs);
        score.vsRipgrepRandP = randomizationP(diffs);
      }
      return score;
    });

    const perf: CorpusReport["perf"] = [];
    if (!argv.includes("--skip-perf")) {
      const perfQueries = queries.slice(0, quick ? 1 : 3).map((q) => q.symbol);
      for (const q of perfQueries) {
        const results: Record<string, Timing> = {};
        for (const t of TOOLS) results[t.id] = await time(t, root, q, c.lang, reps);
        perf.push({ query: q, results });
        console.error(`  timed "${q}": ` + TOOLS.map((t) => `${t.id}=${results[t.id]!.medianMs?.toFixed(0) ?? "-"}ms`).join(" "));
      }
    }

    reports.push({
      corpus: c.name, lang: c.lang, files,
      symbolsUniquelyDeclared: truth.size,
      queries: queries.length, symbols: queries.map((q) => q.symbol), tools, perf,
    });
  }

  const payload = {
    generatedBy: "benchmark.ts",
    task: "definition finding: given a symbol declared exactly once, rank of the declaring file",
    groundTruth: "ast-grep (a parser), independent of every heuristic under test",
    rankCap: RANK_CAP,
    machine: { loadavg: loadLine, cpus: navigator.hardwareConcurrency },
    versions,
    corpora: reports,
  };
  await Bun.write(out, JSON.stringify(payload, null, 2));
  console.error(`\nwrote ${out}`);
  if (argv.includes("--json")) console.log(JSON.stringify(payload, null, 2));
}
