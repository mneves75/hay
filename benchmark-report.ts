#!/usr/bin/env bun
/**
 * benchmark-report — render `evidence/benchmark.json` as Markdown and as a standalone page.
 *
 * Rendering is separated from measuring so a report can be regenerated without re-running an
 * hour of searches, and so the numbers in the document cannot drift from the numbers in the file.
 *
 * Usage: bun benchmark-report.ts [--in evidence/benchmark.json] [--md BENCHMARK.md] [--html benchmark.html]
 *        bun benchmark-report.ts --selftest
 */

type Interval = { mean: number; lo: number; hi: number; p: number; n: number; clusters: number };
type Timing = { medianMs: number | null; minMs: number | null; peakRssMb: number | null; timedOut: boolean };
type ToolScore = {
  tool: string; label: string; available: boolean; deterministic: boolean; queries: number;
  mrr: number; top10: number; medianRank: number | null; unreachable: number; timeouts: number;
  vsRipgrep?: Interval;
  vsRipgrepRandP?: number;
};
type CorpusReport = {
  corpus: string; lang: string;
  files: { onDisk: number; rgVisible: number; gitTracked: number };
  provenance: { revision: string; dirty: boolean };
  symbolsUniquelyDeclared: number; queries: number;
  /** Present in evidence written by benchmark.ts ≥0.7.1; absent (optional) in older files. */
  symbols?: string[];
  tools: ToolScore[];
  perf: { query: string; results: Record<string, Timing> }[];
};
type Payload = {
  task: string; groundTruth: string; rankCap: number;
  generatedAt: string;
  machine: { loadavg: string; cpus: number };
  load?: { min: number; median: number; max: number; samples: number };
  versions: Record<string, string>;
  corpora: CorpusReport[];
};

const DOC_SHAPES = ["flagShaped", "hyphenated", "snakeCase", "upperCase", "camelCase", "pascalCase", "plainWord"] as const;
type DocShape = typeof DOC_SHAPES[number];
type DocsTool = "hay" | "rg";
type DocsRunResult = { rank: number | null; scanned: number; timedOut: boolean; truncated: boolean };
type DocsQueryRecord = {
  token: string; answer: string; occurrences: number;
  features: Record<DocShape, boolean>;
  tools: Record<DocsTool, DocsRunResult>;
};
type DocsCorpusReport = {
  corpus: string; lang: string; eligibleQueries: number; queries: DocsQueryRecord[];
  provenance: { revision: string; dirty: boolean };
  tools: Record<DocsTool, { mrr: number; top10: number }>;
  delta: { mrr: Interval; randomizationP: number };
  featureSplits: {
    feature: DocShape; n: number; mrr: Record<DocsTool, number>; deltaMrr: number;
  }[];
  truncations: Record<DocsTool, number>;
};
type DocsPayload = {
  generatedBy: string; task: string; groundTruth: string;
  meta: {
    date: string; seed: number; sample: number; rankCap: number;
    versions: Record<DocsTool, string>;
  };
  corpora: DocsCorpusReport[];
};

// ── formatting ────────────────────────────────────────────────────────────────

export const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
export const num = (x: number | null, d = 3) => (x === null ? "—" : x.toFixed(d));
export const ms = (t: Timing) =>
  t.timedOut ? "timeout" : t.medianMs === null ? "—" : t.medianMs >= 1000 ? `${(t.medianMs / 1000).toFixed(2)} s` : `${t.medianMs.toFixed(0)} ms`;

/** `+0.081 [0.018, 0.148]`, or `baseline` for the tool everything is compared against. */
export function delta(i: Interval | undefined): string {
  if (!i) return "baseline";
  const sign = i.mean >= 0 ? "+" : "";
  return `${sign}${i.mean.toFixed(3)} [${i.lo.toFixed(3)}, ${i.hi.toFixed(3)}]`;
}

/** Render the baseline, a valid interval, or an explicitly non-inferential snapshot. */
export function deltaCell(t: { tool: string; deterministic: boolean; vsRipgrep?: Interval }): string {
  if (t.tool === "rg") return "baseline";
  if (!t.deterministic) return "snapshot only";
  return t.vsRipgrep ? delta(t.vsRipgrep) : "—";
}

/** An interval that excludes zero is a detected difference; one that spans it is not. */
export function significant(i: Interval | undefined): boolean {
  return !!i && ((i.lo > 0 && i.hi > 0) || (i.lo < 0 && i.hi < 0));
}

/**
 * A difference is only *detected* when both tests agree it is.
 *
 * The bootstrap interval alone used to decide the bolding, and on this data that is demonstrably
 * too generous: on the openclaw corpus `hay` scores +0.150 with a 95% interval of [0.005, 0.297] —
 * excluding zero — while the randomization test puts it at p=0.058. That is exactly the
 * disagreement Smucker et al.'s 2009 follow-up predicts, the bootstrap running optimistic at small
 * samples, and n=30 is a small sample. Requiring both is the conservative reading, and this project
 * exists because of a number that was published on the generous one.
 */
export function detected(t: { tool: string; vsRipgrep?: Interval; vsRipgrepRandP?: number }): boolean {
  if (!significant(t.vsRipgrep)) return false;
  return typeof t.vsRipgrepRandP === "number" && t.vsRipgrepRandP < 0.05;
}

/** The interval says yes and the reference test says no — worth naming, not burying. */
export function disputed(t: { tool: string; vsRipgrep?: Interval; vsRipgrepRandP?: number }): boolean {
  return significant(t.vsRipgrep) && typeof t.vsRipgrepRandP === "number" && t.vsRipgrepRandP >= 0.05;
}

/**
 * The randomization p, or `baseline` for ripgrep itself. The validator requires this value on
 * every comparable row; the em dash remains a defensive fallback for direct helper calls.
 *
 * Printed as `<0.001` rather than `0.000` at the floor — a 10,000-replicate simulation resolves to
 * 1/10,001, and rendering that as zero would claim a precision the run does not have.
 */
export function randP(t: { tool: string; vsRipgrepRandP?: number }): string {
  if (t.tool === "rg") return "baseline";
  if (typeof t.vsRipgrepRandP !== "number") return "—";
  return t.vsRipgrepRandP < 0.001 ? "<0.001" : t.vsRipgrepRandP.toFixed(3);
}

/**
 * Highest peak RSS a tool reached across ALL timed queries.
 *
 * Taking it from the first query alone labelled one arbitrary measurement "peak memory"; with
 * three queries per corpus the largest is routinely a later one, so the published figure was a
 * number the run did not observe as a peak.
 */
export function peakRss(c: CorpusReport, tool: string): string {
  const xs = c.perf.map((r) => r.results[tool]?.peakRssMb).filter((x): x is number => typeof x === "number");
  return xs.length ? `${Math.max(...xs).toFixed(0)} MB` : "—";
}

/** Labels expose deterministic modes instead of making sorted baselines look like defaults. */
export function perfLabel(tool: string): string {
  if (tool === "rg") return "rg --sort path";
  if (tool === "ugrep") return "ugrep --sort=name";
  if (tool === "git-grep") return "git grep";
  return tool;
}

/**
 * Below this many queries a corpus reports numbers, not evidence.
 *
 * This repository yielded exactly one usable query. Printing that beside real samples, unmarked,
 * would be the overclaiming this whole project exists to argue against.
 */
export const MIN_QUERIES = 10;

export const thin = (c: { queries: number }) => c.queries < MIN_QUERIES;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// ── payload trust boundary ────────────────────────────────────────────────────
// evidence/benchmark.json sits inside the repo and gets re-rendered into committed HTML by anyone
// who runs the report. Bun's .json() enforces nothing, so a string where a number belongs would
// flow straight into the page — demonstrated end-to-end with an injected <img onload>. Numbers are
// validated once, here, fail-closed; everything downstream renders from validated values.
export function validatePayload(d: Payload): Payload {
  const bad = (path: string, value: unknown, expected: string): never => {
    throw new Error(`evidence file looks tampered: ${path} = ${JSON.stringify(value)} (expected ${expected})`);
  };
  const finite = (value: unknown, path: string): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) bad(path, value, "finite number");
    return value as number;
  };
  const integer = (value: unknown, path: string, min = 0): number => {
    const n = finite(value, path);
    if (!Number.isInteger(n) || n < min) bad(path, value, `integer >= ${min}`);
    return n;
  };
  const probability = (value: unknown, path: string): number => {
    const n = finite(value, path);
    if (n < 0 || n > 1) bad(path, value, "number in [0, 1]");
    return n;
  };
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9;
  integer(d.rankCap, "rankCap", 1);
  integer(d.machine.cpus, "machine.cpus", 1);
  if (typeof d.generatedAt !== "string" ||
      !Number.isFinite(Date.parse(d.generatedAt)) ||
      new Date(d.generatedAt).toISOString() !== d.generatedAt)
    bad("generatedAt", d.generatedAt, "canonical ISO timestamp");
  if (d.load) {
    for (const key of ["min", "median", "max"] as const) {
      if (finite(d.load[key], `load.${key}`) < 0) bad(`load.${key}`, d.load[key], "non-negative number");
    }
    integer(d.load.samples, "load.samples", 1);
    if (d.load.min > d.load.median || d.load.median > d.load.max) bad("load", d.load, "min <= median <= max");
  }
  for (const corpus of d.corpora) {
    if (typeof corpus.corpus !== "string" || typeof corpus.lang !== "string") bad("corpus", corpus.corpus, "string identity");
    integer(corpus.queries, `${corpus.corpus}.queries`);
    for (const key of ["onDisk", "rgVisible", "gitTracked"] as const) integer(corpus.files[key], `${corpus.corpus}.files.${key}`);
    integer(corpus.symbolsUniquelyDeclared, `${corpus.corpus}.symbolsUniquelyDeclared`);
    if (!corpus.provenance || !/^[0-9a-f]{40}$/i.test(corpus.provenance.revision) || typeof corpus.provenance.dirty !== "boolean")
      bad(`${corpus.corpus}.provenance`, corpus.provenance, "40-hex revision and dirty boolean");
    if (corpus.provenance.dirty) bad(`${corpus.corpus}.provenance.dirty`, true, "clean corpus");
    const baseline = corpus.tools.find((tool) => tool.tool === "rg");
    if (!baseline || !baseline.available || !baseline.deterministic) bad(`${corpus.corpus}.tools`, corpus.tools, "available deterministic rg baseline");
    const baselineMrr = baseline!.mrr;
    for (const tool of corpus.tools) {
      if (typeof tool.tool !== "string" || typeof tool.label !== "string" || typeof tool.available !== "boolean" || typeof tool.deterministic !== "boolean")
        bad(`${corpus.corpus}.tool`, tool, "tool identity, availability, and deterministic-order contract");
      integer(tool.queries, `${corpus.corpus}.${tool.tool}.queries`);
      if (tool.queries !== corpus.queries) bad(`${corpus.corpus}.${tool.tool}.queries`, tool.queries, `corpus query count ${corpus.queries}`);
      probability(tool.mrr, `${corpus.corpus}.${tool.tool}.mrr`);
      probability(tool.top10, `${corpus.corpus}.${tool.tool}.top10`);
      probability(tool.unreachable, `${corpus.corpus}.${tool.tool}.unreachable`);
      integer(tool.timeouts, `${corpus.corpus}.${tool.tool}.timeouts`);
      if (tool.timeouts > tool.queries) bad(`${corpus.corpus}.${tool.tool}.timeouts`, tool.timeouts, "at most query count");
      if (tool.top10 + tool.unreachable > 1 + 1e-9)
        bad(`${corpus.corpus}.${tool.tool}`, tool, "top10 + unreachable <= 1");
      if (tool.medianRank !== null) {
        const rank = finite(tool.medianRank, `${corpus.corpus}.${tool.tool}.medianRank`);
        if (rank < 1 || rank > d.rankCap)
          bad(`${corpus.corpus}.${tool.tool}.medianRank`, rank, `number in [1, ${d.rankCap}]`);
      }
      const comparable = tool.available && tool.deterministic && tool.tool !== "rg" && corpus.queries > 0;
      if (comparable && (!tool.vsRipgrep || typeof tool.vsRipgrepRandP !== "number"))
        bad(`${corpus.corpus}.${tool.tool}`, tool, "paired interval and randomization p");
      if (!comparable && (tool.vsRipgrep || tool.vsRipgrepRandP !== undefined))
        bad(`${corpus.corpus}.${tool.tool}`, tool, "no comparison for baseline, unavailable or nondeterministic tool, or empty corpus");
      if (tool.vsRipgrep) {
        const interval = tool.vsRipgrep;
        for (const key of ["mean", "lo", "hi"] as const) {
          const value = finite(interval[key], `${corpus.corpus}.${tool.tool}.vsRipgrep.${key}`);
          if (value < -1 || value > 1) bad(`${corpus.corpus}.${tool.tool}.vsRipgrep.${key}`, value, "number in [-1, 1]");
        }
        probability(interval.p, `${corpus.corpus}.${tool.tool}.vsRipgrep.p`);
        integer(interval.n, `${corpus.corpus}.${tool.tool}.vsRipgrep.n`);
        integer(interval.clusters, `${corpus.corpus}.${tool.tool}.vsRipgrep.clusters`);
        if (interval.clusters !== corpus.queries)
          bad(`${corpus.corpus}.${tool.tool}.vsRipgrep.clusters`, interval.clusters, `corpus query count ${corpus.queries}`);
        if (interval.lo > interval.hi) bad(`${corpus.corpus}.${tool.tool}.vsRipgrep`, interval, "lo <= hi");
        if (!close(interval.mean, tool.mrr - baselineMrr))
          bad(`${corpus.corpus}.${tool.tool}.vsRipgrep.mean`, interval.mean, `MRR difference ${tool.mrr - baselineMrr}`);
        if (interval.n !== corpus.queries) bad(`${corpus.corpus}.${tool.tool}.vsRipgrep.n`, interval.n, `corpus query count ${corpus.queries}`);
      }
      if (tool.vsRipgrepRandP !== undefined) {
        if (!tool.vsRipgrep) bad(`${corpus.corpus}.${tool.tool}.randomizationP`, tool.vsRipgrepRandP, "paired interval present");
        probability(tool.vsRipgrepRandP, `${corpus.corpus}.${tool.tool}.randomizationP`);
      }
    }
    for (const row of corpus.perf) {
      if (typeof row.query !== "string") bad(`${corpus.corpus}.query`, row.query, "string");
      for (const [tool, timing] of Object.entries(row.results)) {
        if (!timing || typeof timing.timedOut !== "boolean") bad(`${corpus.corpus}.${row.query}.${tool}`, timing, "timing record");
        for (const key of ["medianMs", "minMs", "peakRssMb"] as const) {
          if (timing[key] !== null && finite(timing[key], `${corpus.corpus}.${row.query}.${tool}.${key}`) < 0)
            bad(`${corpus.corpus}.${row.query}.${tool}.${key}`, timing[key], "non-negative number or null");
        }
      }
    }
  }
  return d;
}

/** The optional docs artifact is a second trust boundary, never an escape hatch around the first. */
export function validateDocsPayload(d: DocsPayload): DocsPayload {
  const bad = (path: string, value: unknown, expected: string): never => {
    throw new Error(`docs evidence looks tampered: ${path} = ${JSON.stringify(value)} (expected ${expected})`);
  };
  const finite = (value: unknown, path: string): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) bad(path, value, "finite number");
    return value as number;
  };
  const integer = (value: unknown, path: string, min = 0): number => {
    const n = finite(value, path);
    if (!Number.isInteger(n) || n < min) bad(path, value, `integer >= ${min}`);
    return n;
  };
  const probability = (value: unknown, path: string): number => {
    const n = finite(value, path);
    if (n < 0 || n > 1) bad(path, value, "number in [0, 1]");
    return n;
  };
  const string = (value: unknown, path: string): string => {
    if (typeof value !== "string") bad(path, value, "string");
    return value as string;
  };
  const boolean = (value: unknown, path: string): boolean => {
    if (typeof value !== "boolean") bad(path, value, "boolean");
    return value as boolean;
  };
  string(d.generatedBy, "generatedBy");
  string(d.task, "task");
  string(d.groundTruth, "groundTruth");
  const date = string(d.meta.date, "meta.date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) ||
      new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date)
    bad("meta.date", date, "ISO calendar date");
  finite(d.meta.seed, "meta.seed");
  integer(d.meta.sample, "meta.sample", 1);
  integer(d.meta.rankCap, "meta.rankCap", 1);
  for (const tool of ["hay", "rg"] as const) string(d.meta.versions[tool], `meta.versions.${tool}`);
  for (const corpus of d.corpora) {
    string(corpus.corpus, "corpus");
    string(corpus.lang, `${corpus.corpus}.lang`);
    integer(corpus.eligibleQueries, `${corpus.corpus}.eligibleQueries`);
    if (corpus.eligibleQueries < corpus.queries.length)
      bad(`${corpus.corpus}.eligibleQueries`, corpus.eligibleQueries, "at least sampled query count");
    if (!corpus.provenance || !/^[0-9a-f]{40}$/i.test(corpus.provenance.revision) || typeof corpus.provenance.dirty !== "boolean")
      bad(`${corpus.corpus}.provenance`, corpus.provenance, "40-hex revision and dirty boolean");
    if (corpus.provenance.dirty) bad(`${corpus.corpus}.provenance.dirty`, true, "clean corpus");
    for (const query of corpus.queries) {
      string(query.token, `${corpus.corpus}.query.token`);
      const answer = string(query.answer, `${corpus.corpus}.${query.token}.answer`);
      if (answer.startsWith("/") || /^[A-Za-z]:[\\/]/.test(answer))
        bad(`${corpus.corpus}.${query.token}.answer`, answer, "relative path");
      integer(query.occurrences, `${corpus.corpus}.${query.token}.occurrences`, 1);
      for (const feature of DOC_SHAPES)
        boolean(query.features[feature], `${corpus.corpus}.${query.token}.features.${feature}`);
      if (DOC_SHAPES.filter((feature) => query.features[feature]).length !== 1)
        bad(`${corpus.corpus}.${query.token}.features`, query.features, "exactly one true feature");
      for (const tool of ["hay", "rg"] as const) {
        const result = query.tools[tool];
        if (result.rank !== null) integer(result.rank, `${corpus.corpus}.${query.token}.${tool}.rank`, 1);
        integer(result.scanned, `${corpus.corpus}.${query.token}.${tool}.scanned`);
        boolean(result.timedOut, `${corpus.corpus}.${query.token}.${tool}.timedOut`);
        boolean(result.truncated, `${corpus.corpus}.${query.token}.${tool}.truncated`);
        if (result.rank !== null && result.rank > result.scanned)
          bad(`${corpus.corpus}.${query.token}.${tool}.rank`, result.rank, "rank <= scanned result lines");
        if (result.scanned > d.meta.rankCap)
          bad(`${corpus.corpus}.${query.token}.${tool}.scanned`, result.scanned, `at most rankCap ${d.meta.rankCap}`);
        if (result.truncated && result.scanned !== d.meta.rankCap)
          bad(`${corpus.corpus}.${query.token}.${tool}.truncated`, result, "scanned exactly rankCap when truncated");
      }
    }
    for (const tool of ["hay", "rg"] as const) {
      probability(corpus.tools[tool].mrr, `${corpus.corpus}.tools.${tool}.mrr`);
      probability(corpus.tools[tool].top10, `${corpus.corpus}.tools.${tool}.top10`);
      integer(corpus.truncations[tool], `${corpus.corpus}.truncations.${tool}`);
    }
    for (const key of ["mean", "lo", "hi", "p", "n"] as const)
      finite(corpus.delta.mrr[key], `${corpus.corpus}.delta.mrr.${key}`);
    probability(corpus.delta.mrr.p, `${corpus.corpus}.delta.mrr.p`);
    integer(corpus.delta.mrr.n, `${corpus.corpus}.delta.mrr.n`);
    integer(corpus.delta.mrr.clusters, `${corpus.corpus}.delta.mrr.clusters`);
    if (corpus.delta.mrr.clusters !== corpus.queries.length)
      bad(`${corpus.corpus}.delta.mrr.clusters`, corpus.delta.mrr.clusters, "sampled query count");
    if (corpus.delta.mrr.lo < -1 || corpus.delta.mrr.hi > 1 || corpus.delta.mrr.mean < -1 || corpus.delta.mrr.mean > 1 || corpus.delta.mrr.lo > corpus.delta.mrr.hi)
      bad(`${corpus.corpus}.delta.mrr`, corpus.delta.mrr, "ordered values in [-1, 1]");
    probability(corpus.delta.randomizationP, `${corpus.corpus}.delta.randomizationP`);
    if (corpus.featureSplits.length !== DOC_SHAPES.length)
      bad(`${corpus.corpus}.featureSplits.length`, corpus.featureSplits.length, String(DOC_SHAPES.length));
    if (new Set(corpus.featureSplits.map((split) => split.feature)).size !== DOC_SHAPES.length)
      bad(`${corpus.corpus}.featureSplits`, corpus.featureSplits, "every docs feature exactly once");
    for (const split of corpus.featureSplits) {
      if (!DOC_SHAPES.includes(split.feature)) bad(`${corpus.corpus}.feature`, split.feature, "known docs feature");
      integer(split.n, `${corpus.corpus}.${split.feature}.n`);
      probability(split.mrr.hay, `${corpus.corpus}.${split.feature}.mrr.hay`);
      probability(split.mrr.rg, `${corpus.corpus}.${split.feature}.mrr.rg`);
      const deltaMrr = finite(split.deltaMrr, `${corpus.corpus}.${split.feature}.deltaMrr`);
      if (deltaMrr < -1 || deltaMrr > 1)
        bad(`${corpus.corpus}.${split.feature}.deltaMrr`, deltaMrr, "number in [-1, 1]");
    }

    // Finite is not the same as true: a summary can be finite and still disagree with its own
    // per-query rows (review finding). Everything deterministic is recomputed from `queries`;
    // only the bootstrap interval bounds and p-values are trusted as stored, because they need
    // the replicate stream. The interval's n and mean ARE deterministic and are checked.
    const rr = (r: DocsRunResult) => r.rank ? 1 / r.rank : 0;
    const meanOf = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9;
    const check = (stored: number, computed: number, path: string) => {
      if (!close(stored, computed)) bad(path, stored, `recomputed ${computed}`);
    };
    for (const tool of ["hay", "rg"] as const) {
      check(corpus.tools[tool].mrr, meanOf(corpus.queries.map((q) => rr(q.tools[tool]))), `${corpus.corpus}.tools.${tool}.mrr`);
      check(
        corpus.tools[tool].top10,
        corpus.queries.filter((q) => q.tools[tool].rank !== null && q.tools[tool].rank! <= 10).length / (corpus.queries.length || 1),
        `${corpus.corpus}.tools.${tool}.top10`,
      );
      check(corpus.truncations[tool], corpus.queries.filter((q) => q.tools[tool].truncated).length, `${corpus.corpus}.truncations.${tool}`);
    }
    check(corpus.delta.mrr.mean, meanOf(corpus.queries.map((q) => rr(q.tools.hay) - rr(q.tools.rg))), `${corpus.corpus}.delta.mrr.mean`);
    check(corpus.delta.mrr.n, corpus.queries.length, `${corpus.corpus}.delta.mrr.n`);
    for (const split of corpus.featureSplits) {
      const rows = corpus.queries.filter((q) => q.features[split.feature]);
      check(split.n, rows.length, `${corpus.corpus}.${split.feature}.n`);
      const hay = meanOf(rows.map((q) => rr(q.tools.hay)));
      const rg = meanOf(rows.map((q) => rr(q.tools.rg)));
      check(split.mrr.hay, hay, `${corpus.corpus}.${split.feature}.mrr.hay`);
      check(split.mrr.rg, rg, `${corpus.corpus}.${split.feature}.mrr.rg`);
      check(split.deltaMrr, hay - rg, `${corpus.corpus}.${split.feature}.deltaMrr`);
    }
  }
  return d;
}

// ── capability matrix ─────────────────────────────────────────────────────────
//
// Facts about what each tool is, not measurements. Kept beside the numbers because half of
// choosing a search tool is capability, and a benchmark that only reports speed implies otherwise.

const CAPABILITIES: { id: string; ranked: string; ignore: string; deterministic: string; json: string; index: string }[] = [
  { id: "hay", ranked: "yes", ignore: "gitignore", deterministic: "yes", json: "rg-shaped", index: "none" },
  { id: "rg", ranked: "no", ignore: "gitignore", deterministic: "yes (--sort path)", json: "yes", index: "none" },
  { id: "ugrep", ranked: "no", ignore: "opt-in", deterministic: "yes (--sort=name)", json: "yes", index: "none" },
  { id: "ag", ranked: "no", ignore: "own rules", deterministic: "no", json: "no", index: "none" },
  { id: "grep", ranked: "no", ignore: "none", deterministic: "no", json: "no", index: "none" },
  { id: "git-grep", ranked: "no", ignore: "tracked only", deterministic: "yes", json: "no", index: "git" },
  { id: "cs", ranked: "yes", ignore: "own rules", deterministic: "no contract", json: "yes", index: "none" },
  { id: "ast-grep", ranked: "no", ignore: "gitignore", deterministic: "no contract", json: "yes", index: "parses per run" },
];

const NOT_BENCHMARKED = [
  ["ack", "excluded after the pinned 0.1.4 probe hit the 60 s cap on 52 of 113 rank queries and 5 of 13 full-search timings; mostly censored ranks cannot support comparison"],
  ["zoekt", "trigram index server; needs a build step and a daemon, so it is a different product category"],
  ["Google codesearch (csearch)", "trigram index; not installed on the test machine"],
  ["Sourcegraph, GitHub code search", "hosted services, not comparable on a local tree"],
  ["LSP workspace symbols", "requires a language server per language and a warm project"],
  ["embedding / semantic search", "needs an index build and a model; the opposite of this tool's premise"],
];

// ── charts ───────────────────────────────────────────────────────────────────
//
// Hand-built SVG rather than a chart library: this file must stay dependency-free (it runs under
// bare bun), the numbers are already here, and a chart library would happily smooth over the one
// thing these plots exist to show — an interval that touches zero. Every chart carries its own
// <title>/<desc>, and the full data table sits directly below each one.

/** Selected product and nearest alternatives; only deterministic rows enter inferential charts. */
export const CHART_TOOLS = ["hay", "ast-grep", "cs"];

export const geomean = (xs: number[]): number =>
  xs.length ? Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length) : NaN;

export type DeltaRow = {
  corpus: string; tool: string; label: string;
  mean: number; lo: number; hi: number; detected: boolean;
};

/** Per-corpus Δ-MRR rows for the summary chart. Thin corpora and unavailable tools drop out:
 *  a chart that plotted n=1 alongside n=30 would visually assert what the tables refuse to. */
export function deltaRows(d: Payload): DeltaRow[] {
  const rows: DeltaRow[] = [];
  for (const c of d.corpora) {
    if (thin(c)) continue;
    for (const id of CHART_TOOLS) {
      const t = c.tools.find((x) => x.tool === id);
      if (!t || !t.available || !t.deterministic || !t.vsRipgrep) continue;
      rows.push({
        corpus: c.corpus, tool: id, label: t.label,
        mean: t.vsRipgrep.mean, lo: t.vsRipgrep.lo, hi: t.vsRipgrep.hi,
        detected: !thin(c) && detected(t),
      });
    }
  }
  return rows;
}

/** Geometric-mean search-time ratio vs deterministic ripgrep --sort path on the common complete
 *  paired cohort. A tool with any timeout or missing timing is omitted from the chart rather than
 *  having its slowest observations silently dropped. Ratios survive machine noise better. */
export function timeRatios(d: Payload): { tool: string; ratio: number; samples: number }[] {
  const acc = new Map<string, number[]>();
  const incomplete = new Set<string>();
  let expectedSamples = 0;
  for (const c of d.corpora) {
    if (thin(c)) continue;
    for (const q of c.perf) {
      const base = q.results["rg"];
      if (!base || base.timedOut || base.medianMs === null || base.medianMs <= 0) continue;
      expectedSamples++;
      for (const [tool, t] of Object.entries(q.results)) {
        if (tool === "rg") continue;
        if (!t || t.timedOut || t.medianMs === null || t.medianMs <= 0) {
          incomplete.add(tool);
          continue;
        }
        (acc.get(tool) ?? acc.set(tool, []).get(tool)!).push(t.medianMs / base.medianMs);
      }
    }
  }
  return [...acc]
    .filter(([tool, xs]) => !incomplete.has(tool) && xs.length === expectedSamples)
    .map(([tool, xs]) => ({ tool, ratio: geomean(xs), samples: xs.length }))
    .sort((a, b) => a.ratio - b.ratio);
}

// ── landing narrative ─────────────────────────────────────────────────────────
// Distilled from BENCHMARK_FEYNMAN.md, which builds every idea here from zero. The page carries
// the story because a report that only experts can read only gets checked by experts.

export const FEYNMAN = `
<section class="feynman" id="from-zero">
<h2>The whole thing from zero</h2>
<p class="lede">No jargon, one idea at a time. (The long version, with the traps and the wrong
turns, lives in <a href="BENCHMARK_FEYNMAN.html">BENCHMARK_FEYNMAN.html</a>.)</p>

<div class="fstep">
<h3>1 · One sentence</h3>
<p>You type a word into a code-search tool. <strong>How far down the list is the thing you were
looking for?</strong> Everything on this page is the consequence of trying to answer that
honestly.</p>
</div>

<div class="fstep">
<h3>2 · The amnesiac librarian</h3>
<p>Imagine a librarian who is fast, tireless, and has complete amnesia every morning. Ask her
“where do we handle refunds?” and she walks the shelves looking for the word <em>refund</em>, then
hands you every matching book — <strong>in shelf order</strong>. Not “most useful first”. Shelf
order.</p>
<p>That librarian is grep, and every tool like it. Not stupid — <em>prior-free</em>: nothing ever
gave it an opinion about which result is likelier to be the one you wanted. A coding agent reads
the first page of results and acts on what it sees, so for agents the position of the answer is
not cosmetic. It is the whole product.</p>
<p><strong>hay</strong> is the same librarian with exactly one added opinion: <em>a book that
defines a thing is probably more useful than a book that merely mentions it.</em> This benchmark
asks whether that one opinion is worth anything.</p>
</div>

<div class="fstep">
<h3>3 · Grading without self-grading</h3>
<p>To score an answer you must already know the right answer, for every question — normally a
funded project with human annotators. The tempting wrong idea is to ask hay what the answer is:
the tool would grade its own homework. Instead the answers come from <strong>a parser</strong>
(ast-grep reads source like a compiler): which symbols are declared exactly once in this
repository, and in which file? Different mechanism from any tool being tested, so no circularity —
and “exactly once” because a symbol declared in three places has no single right answer at all.</p>
</div>

<div class="fstep">
<h3>4 · Turning position into a number</h3>
<p>Averaging raw positions is wrong, because the gap between 1st and 2nd is enormous and the gap
between 50th and 51st is nothing. So flip it — score by <strong>1 divided by the position</strong>:</p>
<table class="rr" tabindex="0" aria-label="Reciprocal-rank score examples">
<thead><tr><th scope="col">position</th><th scope="col">1</th><th scope="col">2</th><th scope="col">4</th><th scope="col">10</th><th scope="col">100</th><th scope="col">never</th></tr></thead>
<tbody><tr><th scope="row">score</th><td>1.00</td><td>0.50</td><td>0.25</td><td>0.10</td><td>0.01</td><td>0.00</td></tr></tbody>
</table>
<p>Average that across queries and you have MRR — mean reciprocal rank. It falls exactly the way
the experience falls.</p>
</div>

<div class="fstep">
<h3>5 · Same questions, then shuffle</h3>
<p>Every tool runs on <strong>identical queries</strong>, so hard questions cancel out — you weigh
yourself on the same scale before and after. For an invocation that guarantees stable order, each
per-query difference is then resampled ten thousand times (the bootstrap), and Fisher's
randomization test asks the same question by flipping signs at random. <strong>A difference is
claimed only when both methods agree.</strong> Tools without a stable-order contract remain visible
as descriptive snapshots; running statistics over a scheduler accident would manufacture precision.</p>
</div>

<div class="fstep">
<h3>6 · Two different ways to win</h3>
<p>Searching ripgrep's own source for <code>quiet</code>: plain ripgrep returns 73 lines,
hay returns 72, ast-grep returns <strong>11</strong> — and it is right to throw them away, because
it parses the code and knows a comment or a string is not a use of the symbol. So:
<strong>ast-grep filters</strong>, shrinking the list and keeping walk order; <strong>hay ranks</strong>,
keeping everything but sorting the declaration first. Same median, different failure mode — when
luck turns, ast-grep drops to 5th while hay is still 1st. That last part is a hypothesis, flagged
as such, not a measured finding.</p>
</div>

<div class="fstep">
<h3>7 · The bug worth more than the benchmark</h3>
<p>hay once scored <em>below</em> ripgrep on the Linux kernel. The mechanism was embarrassingly
simple: hay spots declarations by keywords like <code>fn</code>, <code>function</code>,
<code>def</code> — and C has none of them. Its core feature had never worked on C, proven by
switching it off and watching the kernel score not move. Building the honest test found the bug.
The fix is in every result below.</p>
</div>
</section>`;

const MONO = `font-family:"IBM Plex Mono",ui-monospace,monospace`;
/** Tool identity by SHAPE first, color second: the page must survive grayscale printing and
 *  deuteranopia alike, so hay=circle, ast-grep=diamond, cs=square. */
const MARK: Record<string, (cx: number, cy: number, r: number, fill: string) => string> = {
  "hay": (x, y, r, f) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${f}" stroke="var(--accent)" stroke-width="1.5"/>`,
  "ast-grep": (x, y, r, f) => `<rect x="${x - r * 1.15}" y="${y - r * 1.15}" width="${r * 2.3}" height="${r * 2.3}" transform="rotate(45 ${x} ${y})" fill="${f}" stroke="var(--up)" stroke-width="1.5"/>`,
  "cs": (x, y, r, f) => `<rect x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" fill="${f}" stroke="var(--warn)" stroke-width="1.5"/>`,
};

function niceTicks(lo: number, hi: number, step: number): number[] {
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

/** Δ MRR vs ripgrep, dot per tool with a 95% interval whisker. The filled dot is a difference
 *  BOTH statistical tests agree on; hollow means the tests disagree or the interval spans zero.
 *  A chart that showed only point estimates would be exactly the overclaiming this repo forbids. */
export function chartDelta(d: Payload): string {
  const rows = deltaRows(d);
  if (!rows.length) return "";
  const W = 760, padL = 150, padR = 84, rowH = 24, groupGap = 18;
  const corpora = [...new Set(rows.map((r) => r.corpus))];
  const H = rows.length * rowH + corpora.length * groupGap + 58;
  const lo = Math.min(-0.02, ...rows.map((r) => r.lo));
  const hi = Math.max(0.05, ...rows.map((r) => r.hi));
  const span = hi - lo, X = (v: number) => padL + ((v - lo) / span) * (W - padL - padR);
  let y = 34, prev = "";
  const g: string[] = [];
  for (const t of niceTicks(lo, hi, 0.1)) {
    g.push(`<line x1="${X(t)}" y1="26" x2="${X(t)}" y2="${H - 24}" class="grid"/>
<text x="${X(t)}" y="${H - 8}" text-anchor="middle" class="tick">${t > 0 ? "+" : ""}${t.toFixed(1)}</text>`);
  }
  g.push(`<line x1="${X(0)}" y1="26" x2="${X(0)}" y2="${H - 24}" class="zero"/>
<text x="${X(0)}" y="18" text-anchor="middle" class="tick strong">ripgrep</text>`);
  for (const c of corpora) {
    g.push(`<text x="0" y="${y + 4}" class="cat">${esc(c)}</text>`);
    for (const r of rows.filter((r) => r.corpus === c)) {
      const mark = MARK[r.tool] ?? MARK["hay"]!;
      // Filled + colored = both tests agree it is a real difference; hollow = do not trust it.
      const solid = ({ "hay": "var(--accent)", "ast-grep": "var(--up)", "cs": "var(--warn)" } as Record<string, string>)[r.tool] ?? "var(--ink-faint)";
      const fill = r.detected ? solid : "var(--panel)";
      g.push(`<line x1="${X(r.lo)}" y1="${y}" x2="${X(r.hi)}" y2="${y}" class="whisker"/>
<line x1="${X(r.lo)}" y1="${y - 4}" x2="${X(r.lo)}" y2="${y + 4}" class="whisker"/>
<line x1="${X(r.hi)}" y1="${y - 4}" x2="${X(r.hi)}" y2="${y + 4}" class="whisker"/>
${mark(X(r.mean), y, 4.5, fill)}
<text x="${W - padR + 10}" y="${y + 3.5}" class="val">${r.mean >= 0 ? "+" : ""}${r.mean.toFixed(2)}</text>`);
      y += rowH;
    }
    y += groupGap;
  }
  const legend = CHART_TOOLS.filter((t) => rows.some((r) => r.tool === t)).map((t) => {
    // Slot by position in CHART_TOOLS, not the filtered index, so a missing middle tool
    // cannot shift the remaining marks out from under their labels.
    const lx = padL + CHART_TOOLS.indexOf(t) * 130;
    return `${MARK[t]!(lx, H + 2, 4.5, "var(--panel)")}<text x="${lx + 12}" y="${H + 6}" class="legend">${esc(t)}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H + 22}" width="100%" role="img" aria-labelledby="deltatitle deltadesc" class="chart">
<title id="deltatitle">How much each stable-order tool beats ripgrep --sort path, per repository</title>
<desc id="deltadesc">Horizontal dot plot. Each mark is a stable-order tool's mean improvement in mean reciprocal rank over deterministic ripgrep --sort path, with a whisker showing the 95% bootstrap interval. The vertical line at zero is ripgrep itself.</desc>
${g.join("\n")}${legend}
<text x="${padL + CHART_TOOLS.length * 130}" y="${H + 6}" class="legend">filled = both statistical tests agree</text></svg>`;
}

/** Share of queries answered in the top ten, per corpus, bars grouped like the dot plot above. */
export function chartTop10(d: Payload): string {
  const rows: { corpus: string; tool: string; v: number }[] = [];
  for (const c of d.corpora) {
    if (thin(c)) continue;
    for (const id of CHART_TOOLS) {
      const t = c.tools.find((x) => x.tool === id);
      if (t?.available) rows.push({ corpus: c.corpus, tool: id, v: t.top10 });
    }
  }
  if (!rows.length) return "";
  const W = 760, padL = 150, padR = 64, rowH = 16, groupGap = 20;
  const corpora = [...new Set(rows.map((r) => r.corpus))];
  const H = rows.length * rowH + corpora.length * groupGap + 56;
  // top10 is stored as a fraction (0–1); dividing it by 100 again rendered every bar ~5px wide.
  const X = (v: number) => padL + v * (W - padL - padR);
  const g: string[] = [];
  for (const t of [0, 0.5, 1]) {
    g.push(`<line x1="${X(t)}" y1="26" x2="${X(t)}" y2="${H - 22}" class="grid"/>`);
    g.push(`<text x="${X(t)}" y="${H - 6}" text-anchor="middle" class="tick">${t * 100}%</text>`);
  }
  let y = 32;
  for (const c of corpora) {
    g.push(`<text x="0" y="${y + 5}" class="cat">${esc(c)}</text>`);
    for (const id of CHART_TOOLS) {
      const r = rows.find((x) => x.corpus === c && x.tool === id);
      if (!r) continue;
      g.push(`<rect x="${X(0)}" y="${y - 5}" width="${Math.max(X(r.v) - X(0), 1)}" height="10" rx="2" fill="${id === "hay" ? "var(--accent)" : "var(--bar)"}" opacity="${id === "hay" ? 1 : 0.75}"/>
<text x="${X(r.v) + 6}" y="${y + 3.5}" class="val">${pct(r.v)}</text>`);
      y += rowH;
    }
    y += groupGap;
  }
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-labelledby="t10title t10desc" class="chart">
<title id="t10title">Share of queries answered within the first ten results</title>
<desc id="t10desc">Grouped horizontal bars per repository: the accent bar is hay; muted bars are ast-grep and codespelunker descriptive snapshots; ripgrep is the implicit baseline axis.</desc>
${g.join("\n")}</svg>`;
}

/** Search-time ratio vs ripgrep, geometric mean over every timed query. Log scale around 1×:
 *  left is faster than ripgrep, right slower. Clamped at the edges, labelled with the true value. */
export function chartTime(d: Payload): string {
  const rows = timeRatios(d).filter((r) => r.samples >= 3);
  if (rows.length < 2) return "";
  const W = 760, padL = 130, padR = 90, rowH = 30;
  const H = rows.length * rowH + 74;
  const LO = Math.log2(0.25), HI = Math.log2(8);
  const X = (ratio: number) => padL + ((Math.log2(ratio) - LO) / (HI - LO)) * (W - padL - padR);
  const x0 = X(1);
  const g: string[] = [];
  for (const m of [0.25, 0.5, 1, 2, 4, 8]) {
    g.push(`<line x1="${X(m)}" y1="26" x2="${X(m)}" y2="${H - 40}" class="${m === 1 ? "zero" : "grid"}"/>
<text x="${X(m)}" y="${H - 24}" text-anchor="middle" class="tick">${m}×</text>`);
  }
  g.push(`<text x="${padL}" y="14" class="tick strong">← faster</text><text x="${W - padR}" y="14" text-anchor="end" class="tick strong">slower →</text>`);
  rows.forEach((r, i) => {
    const y = 38 + i * rowH;
    const xe = Math.max(Math.min(X(r.ratio), X(8)), X(0.25));
    const clamped = r.ratio < 0.25 || r.ratio > 8;
    g.push(`<text x="0" y="${y + 4}" class="cat">${esc(r.tool)}</text>
<rect x="${Math.min(x0, xe)}" y="${y - 7}" width="${Math.abs(xe - x0)}" height="14" rx="3" fill="${r.ratio <= 1 ? "var(--accent)" : "var(--bar)"}" opacity="0.85"/>
${clamped ? `<path d="M ${xe + (xe < x0 ? -7 : 7)} ${y} l ${(xe < x0 ? 7 : -7)} -4 v 8 z" fill="var(--ink-faint)"/>` : ""}
<text x="${W - padR + 10}" y="${y + 4}" class="val">${r.ratio.toFixed(2)}×</text>`);
  });
  const samples = rows[0]!.samples;
  if (!rows.every((row) => row.samples === samples))
    throw new Error("timing chart requires one complete paired cohort");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-labelledby="timetitle timedesc" class="chart">
<title id="timetitle">Full-search time relative to ripgrep --sort path, geometric mean</title>
<desc id="timedesc">Bars from the one-times line: to the left is faster than ripgrep --sort path, to the right slower, on a logarithmic scale. Every displayed tool completed the same paired queries; tools with any timeout or missing result are omitted.</desc>
${g.join("\n")}
<text x="0" y="${H - 4}" class="legend">geometric mean over ${samples} complete paired queries · tools with timeouts omitted · lower is faster</text></svg>`;
}

const statP = (value: number): string => value < 0.001 ? "<0.001" : value.toFixed(3);
const signed = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(3)}`;

/** The same conservative rule as the code tables, made explicit as an agreement marker. */
export function docsAgreement(c: DocsCorpusReport): string {
  const intervalSaysDifference = significant(c.delta.mrr);
  const randomizationSaysDifference = c.delta.randomizationP < 0.05;
  if (detected({ tool: "hay", vsRipgrep: c.delta.mrr, vsRipgrepRandP: c.delta.randomizationP }))
    return "✓ agree — detected";
  if (intervalSaysDifference !== randomizationSaysDifference) return "⚠ disagree";
  return "✓ agree — not detected";
}

function docsHtml(d: DocsPayload): string {
  const summary = d.corpora.map((c) => {
    const marker = thin({ queries: c.queries.length }) ? "— too few queries" : docsAgreement(c);
    const sig = !thin({ queries: c.queries.length }) && marker === "✓ agree — detected";
    return `<tr>
  <th scope="row">${esc(c.corpus)}</th><td class="n">${c.queries.length}</td>
  <td class="n">${num(c.tools.hay.mrr)}</td><td class="n">${num(c.tools.rg.mrr)}</td>
  <td class="d ${c.delta.mrr.mean >= 0 ? "up" : "down"}${sig ? " sig" : ""}">${esc(delta(c.delta.mrr))}</td>
  <td class="n">${esc(statP(c.delta.mrr.p))}</td><td class="n">${esc(statP(c.delta.randomizationP))}</td>
  <td>${esc(marker)}</td><td class="n">${c.truncations.hay} / ${c.truncations.rg}</td>
</tr>`;
  }).join("\n");
  const features = d.corpora.flatMap((c) => c.featureSplits.map((split) => `<tr>
  <th scope="row">${esc(c.corpus)}</th><td><code>${esc(split.feature)}</code></td><td class="n">${split.n}</td>
  <td class="n">${num(split.mrr.hay)}</td><td class="n">${num(split.mrr.rg)}</td><td class="d ${split.deltaMrr >= 0 ? "up" : "down"}">${signed(split.deltaMrr)}</td>
</tr>`)).join("\n");
  return `<section class="corpus" id="docs-track">
<h2>Documentation track</h2>
<p class="meta">Generated ${esc(d.meta.date)} · hay ${esc(d.meta.versions.hay)} · rg ${esc(d.meta.versions.rg)}</p>
<p class="meta">Corpus revisions: ${d.corpora.map((c) => `${esc(c.corpus)} ${esc(c.provenance.revision.slice(0, 12))}`).join(" · ")}</p>
<p>A public development set for documentation retrieval: identifier-like tokens from ATX headings
that occur in exactly one markdown file’s headings and in at least three parity-visible files.
Ranks use the same ${d.meta.rankCap}-result-line cap as the code track; cap truncations are reported
as <code>hay / rg</code>, never absorbed into another metric.</p>
<div class="scroll" tabindex="0"><table>
<thead><tr><th scope="col">corpus</th><th scope="col" class="n">n</th><th scope="col" class="n">MRR hay</th><th scope="col" class="n">MRR rg --sort path</th><th scope="col">Δ MRR (95% CI)</th><th scope="col" class="n">bootstrap p</th><th scope="col" class="n">randomization p</th><th scope="col">both tests</th><th scope="col" class="n">cap truncations</th></tr></thead>
<tbody>${summary}</tbody></table></div>
<h3>Query-shape splits</h3>
<p class="meta">Mutually exclusive precedence: flag-shaped → uppercase → snake case → hyphenated → camel case → pascal case → plain word.</p>
<div class="scroll" tabindex="0"><table>
<thead><tr><th scope="col">corpus</th><th scope="col">feature</th><th scope="col" class="n">n</th><th scope="col" class="n">MRR hay</th><th scope="col" class="n">MRR rg --sort path</th><th scope="col">Δ MRR</th></tr></thead>
<tbody>${features}</tbody></table></div>
</section>`;
}

// ── markdown ──────────────────────────────────────────────────────────────────

export function markdown(d: Payload, docs?: DocsPayload): string {
  const L: string[] = [];
  const p = (s = "") => L.push(s);

  p("# Code search benchmark");
  p();
  p(`Every code-search tool installed on the test machine, over ${d.corpora.filter((corpus) => !thin(corpus)).length} usable repositories${d.corpora.some(thin) ? ` (plus ${d.corpora.filter(thin).length} thin self-check corpus)` : ""}, measured on one`);
  p("task: **given a symbol, how far down the results is its declaration?**");
  p();
  p("> ### Read this before the numbers");
  p("> `hay` is built to rank declarations first, and this benchmark's ground truth *is* the");
  p("> declaration. It is measuring the thing `hay` optimises for, so it should win, and a win here");
  p("> is weaker evidence than it looks. Read inferential margins only for invocations with an");
  p("> explicit stable-order contract; every unordered tool remains visible as a snapshot.");
  p(">");
  p("> The project's other evaluation does not have this problem: it uses real agent searches paired");
  p("> with the files the agent opened next, so the ground truth was not designed around the tool.");
  p("> That one is in `README.md`. It is also unreproducible by anyone else, because the transcripts");
  p("> are private. Neither evaluation is sufficient alone; that is why both exist.");
  p();
  p("**New to any of this?** [BENCHMARK_FEYNMAN.md](BENCHMARK_FEYNMAN.md) builds every idea below from");
  p("scratch — no jargon, one analogy at a time — including the traps that nearly poisoned the numbers");
  p("and the places this benchmark is wrong.");
  p();
  p("## Method");
  p();
  p(`- **Generated** — ${d.generatedAt}.`);
  p(`- **Task** — ${d.task}.`);
  p(`- **Ground truth** — ${d.groundTruth}. A symbol declared in more than one place is discarded:`);
  p("  there is no single right answer, so scoring against an arbitrary one would be noise.");
  p("- **Queries** — symbols with between 5 and 2,000 total occurrences. Fewer than five is not a");
  p("  retrieval problem; more than two thousand is a different and pathological one. Sampling is");
  p("  seeded, so the same corpus yields the same queries on every run.");
  p(`- **Metric** — reciprocal rank of the first result line landing in the declaring file, capped`);
  p(`  at ${d.rankCap} results. Mean reciprocal rank and the share answered within the first ten.`);
  p("- **Difference** — for stable-order invocations only: absolute, against deterministic ripgrep");
  p("  `--sort path`, with a 95% paired bootstrap interval over per-query reciprocal ranks");
  p("  (10,000 replicates, fixed seed). Unordered tools are descriptive snapshots. An interval that");
  p("  spans zero is not a detected difference, whatever the point estimate suggests.");
  p("- **Significance** — Fisher's paired randomization test on the same differences, reported");
  p("  beside the interval. Smucker et al. (CIKM 2007) use the randomization test as the reference");
  p("  against which the bootstrap and the t-test are validated, and their follow-up (SIGIR 2009)");
  p("  finds the bootstrap biased toward smaller p-values at small samples — which is most of the");
  p("  corpora here. Where the two disagree, believe the randomization test. Neither test is run");
  p("  for a tool that cannot guarantee repeatable rank order.");
  p("- **Flag parity** — every tool is asked for the same job: recursive, fixed-string,");
  p("  case-sensitive, `path:line:text`. Filtering is deliberately *not* normalised across tools,");
  p("  because what a tool skips is a real property of it; the file counts each tool sees are");
  p("  reported per corpus. The **one exception is ripgrep**, which is given");
  p("  `--sort path --no-ignore-dot --no-ignore-global --no-ignore-exclude` so its rank order is");
  p("  deterministic and it walks exactly what `hay` walks. ugrep gets its documented `--sort=name`");
  p("  mode for the same reason. `hay` disables those sources internally so operator-local state cannot change");
  p("  results; without the flags the head-to-head measured which files were searched rather than");
  p("  how they were ranked — 231 files against 225 on the ripgrep corpus, which ships a `.ignore`.");
  p("- **Invocation** — every binary is called by absolute path. On the test machine `grep` is a");
  p("  shell function that resolves to ugrep, so calling tools by name would have measured the");
  p("  wrong program.");
  p("- **Peak memory** — an em dash means `/usr/bin/time -l` did not expose RSS for that run;");
  p("  missing values are reported, never imputed.");
  p();
  p("### Versions");
  p();
  p("| tool | version |");
  p("|---|---|");
  for (const [id, v] of Object.entries(d.versions)) p(`| \`${id}\` | ${v} |`);
  p();

  if (docs) {
    p("## Documentation track");
    p();
    p(`Generated ${docs.meta.date} · hay ${docs.meta.versions.hay} · rg ${docs.meta.versions.rg}.`);
    p(`Corpus revisions: ${docs.corpora.map((c) => `${c.corpus} \`${c.provenance.revision.slice(0, 12)}\``).join(" · ")}.`);
    p();
    p("A public development set for documentation retrieval: identifier-like tokens from ATX");
    p("headings that occur in exactly one markdown file's headings and in at least three");
    p(`parity-visible files. Ranks use the same ${docs.meta.rankCap}-result-line cap as the code`);
    p("track; cap truncations are reported as `hay / rg`, never absorbed into another metric.");
    p();
    p("| corpus | n | MRR hay | MRR rg --sort path | Δ MRR (95% CI) | bootstrap p | randomization p | both tests | cap truncations (hay / rg) |");
    p("|---|---:|---:|---:|---|---:|---:|---|---:|");
    for (const c of docs.corpora) {
      const marker = thin({ queries: c.queries.length }) ? "— too few queries" : docsAgreement(c);
      p(`| ${c.corpus} | ${c.queries.length} | ${num(c.tools.hay.mrr)} | ${num(c.tools.rg.mrr)} | ${delta(c.delta.mrr)} | ${statP(c.delta.mrr.p)} | ${statP(c.delta.randomizationP)} | ${marker} | ${c.truncations.hay} / ${c.truncations.rg} |`);
    }
    p();
    p("### Query-shape splits");
    p();
    p("Mutually exclusive precedence: flag-shaped → uppercase → snake case → hyphenated → camel");
    p("case → pascal case → plain word.");
    p();
    p("| corpus | feature | n | MRR hay | MRR rg --sort path | Δ MRR |");
    p("|---|---|---:|---:|---:|---:|");
    for (const c of docs.corpora) {
      for (const split of c.featureSplits)
        p(`| ${c.corpus} | \`${split.feature}\` | ${split.n} | ${num(split.mrr.hay)} | ${num(split.mrr.rg)} | ${signed(split.deltaMrr)} |`);
    }
    p();
  }

  for (const c of d.corpora) {
    p(`## ${c.corpus}`);
    p();
    if (thin(c)) {
      p(`> **Too few queries to conclude anything (${c.queries}).** Reported for completeness; the`);
      p(`> numbers below are not evidence and no difference is marked as detected.`);
      p();
    }
    p(`Corpus revision \`${c.provenance.revision.slice(0, 12)}\` · clean.`);
    p(`${c.lang.toUpperCase()} · ${c.files.onDisk.toLocaleString()} files on disk · ` +
      `${c.files.rgVisible.toLocaleString()} visible after gitignore · ` +
      `${c.files.gitTracked.toLocaleString()} tracked by git · ` +
      `${c.symbolsUniquelyDeclared.toLocaleString()} symbols declared exactly once · ` +
      `**${c.queries} ${c.queries === 1 ? "query" : "queries"}**`);
    p();
    p("| tool | MRR | answer in top 10 | median rank | never found | Δ MRR vs rg --sort path (95% CI) | randomization p |");
    p("|---|---:|---:|---:|---:|---|---:|");
    for (const t of [...c.tools].sort((a, b) => b.mrr - a.mrr)) {
      if (!t.available) { p(`| ${t.label} | not installed | | | | | |`); continue; }
      const flag = !thin(c) && detected(t) ? " **" : " ";
      p(`| ${t.label} | ${num(t.mrr)} | ${pct(t.top10)} | ${t.medianRank ?? "—"} | ${pct(t.unreachable)} |${flag}${deltaCell(t)}${flag.trim() ? "**" : ""} | ${randP(t)} |`);
    }
    p();
    p("Bold = **both** tests agree the difference is real: the interval excludes zero *and* the");
    p("randomization test puts it under 0.05. `snapshot only` means the tool has no stable-order");
    p("contract, so its point estimates are shown but no confidence interval or p-value is computed.");
    const split = c.tools.filter(disputed);
    if (split.length && !thin(c)) {
      p();
      p("> **The two tests disagree here, and the table takes the conservative reading.** " +
        split.map((t) => `${t.label} (interval excludes zero, randomization p=${t.vsRipgrepRandP!.toFixed(3)})`).join("; ") +
        ". Smucker et al.'s follow-up finds the bootstrap biased toward smaller p-values at small");
      p("> samples, which this is, so these are reported as **not detected**.");
    }
    if (c.tools.some((t) => t.timeouts > 0)) {
      p();
      p("Timeouts: " + c.tools.filter((t) => t.timeouts > 0).map((t) => `${t.label} ${t.timeouts}`).join(", ") + ".");
    }
    if (c.perf.length) {
      p();
      p("### Time to complete a full search");
      p();
      const ids = c.perf[0] ? Object.keys(c.perf[0].results) : [];
      p(`| query | ${ids.map(perfLabel).join(" | ")} |`);
      p(`|---|${ids.map(() => "---:").join("|")}|`);
      for (const row of c.perf) p(`| \`${row.query}\` | ${ids.map((i) => ms(row.results[i]!)).join(" | ")} |`);
      if (c.perf.length) {
        p();
        p(`| peak memory | ${ids.map((i) => peakRss(c, i)).join(" | ")} |`);
        p(`|---|${ids.map(() => "---:").join("|")}|`);
      }
    }
    p();
  }

  p("## What each tool is");
  p();
  p("| tool | ranks results | skips files | deterministic order | machine-readable | index |");
  p("|---|---|---|---|---|---|");
  for (const c of CAPABILITIES) p(`| \`${c.id}\` | ${c.ranked} | ${c.ignore} | ${c.deterministic} | ${c.json} | ${c.index} |`);
  p();
  p("### Not benchmarked");
  p();
  for (const [name, why] of NOT_BENCHMARKED) p(`- **${name}** — ${why}`);
  p();
  p("## Limits");
  p();
  p("- **The task favours `hay` by construction.** Stated again because it is the single most");
  p("  important caveat on this page.");
  p("- **Definition-finding is not all of search.** An agent also asks where something is *used*,");
  p("  what calls what, and where a behaviour lives with no symbol to name. None of that is here.");
  p("- **Unordered tools are snapshots, not inference.** Their MRR and top-10 values describe this");
  p("  run only; scheduler or traversal order may change them on the same immutable corpus.");
  p("- **One machine, one filesystem, macOS only.**");
  if (d.load) {
    p(`- **The machine was busy.** Load average ranged ${d.load.min.toFixed(1)}–${d.load.max.toFixed(1)}` +
      ` (median ${d.load.median.toFixed(1)}) across ${d.load.samples} samples during the run, on ` +
      `${d.machine.cpus} cores, including a Time Machine backup and a virus scanner. Ranking is`);
    p("  unaffected — a rank is the same whether it took one second or ten — but treat the timing");
    p("  table as indicative and the ratios between tools as more trustworthy than the absolutes.");
  }
  p("- **Ground truth is a parser's opinion.** `ast-grep` misses declaration forms its patterns do");
  p("  not cover, and those symbols are simply absent rather than wrong.");
  p();
  p("## Reproduce it");
  p();
  p("```bash");
  p('BENCH_CORPORA="${XDG_CACHE_HOME:-$HOME/.cache}/hay/corpora"');
  p('mkdir -p "$BENCH_CORPORA"');
  p('git clone --depth 1 https://github.com/torvalds/linux.git       "$BENCH_CORPORA/linux"');
  p('git clone --depth 1 https://github.com/openclaw/openclaw.git     "$BENCH_CORPORA/openclaw"');
  p('git clone --depth 1 https://github.com/BurntSushi/ripgrep.git   "$BENCH_CORPORA/ripgrep"');
  p('git clone --depth 1 https://github.com/Alamofire/Alamofire.git   "$BENCH_CORPORA/alamofire"');
  p("cargo build --release --manifest-path hay/Cargo.toml");
  p('bun benchmark.ts --corpora "$BENCH_CORPORA" --sample 30');
  p("bun benchmark-report.ts                 # writes BENCHMARK.md and benchmark.html");
  p("```");
  p();
  p("Tools absent from the machine are reported as *not installed* rather than skipped silently.");
  return L.join("\n") + "\n";
}

// ── html ──────────────────────────────────────────────────────────────────────

export function html(d: Payload, docs?: DocsPayload): string {
  const maxMrr = Math.max(...d.corpora.flatMap((c) => c.tools.map((t) => t.mrr)), 0.001);
  const bar = (v: number) =>
    `<span class="bar" aria-hidden="true"><span style="width:${((v / maxMrr) * 100).toFixed(1)}%"></span></span>`;

  const corpusSection = (c: CorpusReport) => {
    const rows = [...c.tools].sort((a, b) => b.mrr - a.mrr).map((t) => {
      if (!t.available) return `<tr class="absent"><th scope="row">${esc(t.label)}</th><td colspan="6">not installed</td></tr>`;
      const sig = !thin(c) && detected(t);
      const dir = t.tool === "rg" ? "base" : !t.deterministic || !t.vsRipgrep ? "snapshot" : t.vsRipgrep.mean > 0 ? "up" : "down";
      return `<tr${t.tool === "hay" ? ' class="subject"' : ""}>
  <th scope="row">${esc(t.label)}</th>
  <td class="n">${num(t.mrr)}${bar(t.mrr)}</td>
  <td class="n">${pct(t.top10)}</td>
  <td class="n">${t.medianRank ?? "—"}</td>
  <td class="n">${pct(t.unreachable)}</td>
  <td class="d ${dir}${sig ? " sig" : ""}">${esc(deltaCell(t))}</td>
  <td class="n">${esc(randP(t))}</td>
</tr>`;
    }).join("\n");

    const ids = c.perf[0] ? Object.keys(c.perf[0].results) : [];
    const perf = c.perf.length
      ? `<h4>Time to complete a full search</h4>
<div class="scroll" tabindex="0"><table class="perf">
<thead><tr><th scope="col">query</th>${ids.map((i) => `<th scope="col">${esc(perfLabel(i))}</th>`).join("")}</tr></thead>
<tbody>${c.perf.map((r) => `<tr><th scope="row"><code>${esc(r.query)}</code></th>${ids.map((i) => `<td class="n">${esc(ms(r.results[i]!))}</td>`).join("")}</tr>`).join("")}
<tr class="rss"><th scope="row">peak memory</th>${ids.map((i) => `<td class="n">${esc(peakRss(c, i))}</td>`).join("")}</tr></tbody></table></div>`
      : "";

    return `<section class="corpus${thin(c) ? " thin" : ""}">
<h3>${esc(c.corpus)}</h3>
${thin(c) ? `<p class="thin-note"><strong>Too few queries to conclude anything (${c.queries}).</strong> Reported for completeness; these numbers are not evidence and no difference is marked as detected.</p>` : ""}
<p class="meta">revision ${esc(c.provenance.revision.slice(0, 12))} · clean · ${esc(c.lang.toUpperCase())} · ${c.files.onDisk.toLocaleString()} files · ${c.files.rgVisible.toLocaleString()} after gitignore · ${c.files.gitTracked.toLocaleString()} tracked · ${c.symbolsUniquelyDeclared.toLocaleString()} symbols declared once · <strong>${c.queries} ${c.queries === 1 ? "query" : "queries"}</strong></p>
<div class="scroll" tabindex="0"><table>
<thead><tr>
  <th scope="col">tool</th><th scope="col" class="n">MRR</th><th scope="col" class="n">top 10</th>
  <th scope="col" class="n">median rank</th><th scope="col" class="n">never found</th>
  <th scope="col">Δ MRR vs rg --sort path (95% CI)</th>
  <th scope="col" class="n">randomization p</th>
</tr></thead>
<tbody>${rows}</tbody></table></div>
<p class="meta"><code>snapshot only</code> means the invocation has no stable-order contract: point estimates are shown, but confidence intervals and p-values are deliberately omitted.</p>
${perf}
</section>`;
  };

  // A complete document, not a fragment. This page is opened from disk as often as it is hosted,
  // and a fragment leaves the browser to invent <html>, <head> and the document language — `lang`
  // being what a screen reader uses to choose a voice.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ranked grep, measured</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Every code-search tool on one machine, measured on one question: given a symbol, how far down the results is its declaration? Charts, method, and the statistics explained from zero.">
<meta property="og:title" content="Ranked grep, measured">
<meta property="og:description" content="A code-search benchmark explained from nothing: the amnesiac librarian, the flipped positions, and why a difference only counts when two statistical tests agree.">
<meta property="og:type" content="article">
<style>
:root{
  --ground:#f8f5ec; --panel:#fffdf6; --ink:#201b10; --ink-soft:#5c5544; --ink-faint:#6b6452;
  --rule:#e7e1cf; --rule-strong:#cfc6a8;
  --accent:#8a6d10; --accent-soft:#f1e7c8; --accent-ink:#6b5408;
  --up:#256b45; --down:#96382a; --warn:#8a6410;
  --bar:#cdb87a;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ground:#16130c; --panel:#1e1a10; --ink:#ece5d2; --ink-soft:#b3aa92; --ink-faint:#958c72;
    --rule:#2e2918; --rule-strong:#46402a;
    --accent:#ddb84f; --accent-soft:#332b14; --accent-ink:#e6c86e;
    --up:#69c493; --down:#e08a78; --warn:#d9ad55;
    --bar:#57491f;
  }
}
:root[data-theme="dark"]{
  --ground:#16130c; --panel:#1e1a10; --ink:#ece5d2; --ink-soft:#b3aa92; --ink-faint:#958c72;
  --rule:#2e2918; --rule-strong:#46402a;
  --accent:#ddb84f; --accent-soft:#332b14; --accent-ink:#e6c86e;
  --up:#69c493; --down:#e08a78; --warn:#d9ad55;
  --bar:#57491f;
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:"IBM Plex Sans",system-ui,-apple-system,"Segoe UI",sans-serif;
  font-size:16px; line-height:1.6;
}
.wrap{max-width:78rem;margin:0 auto;padding:3rem 1.25rem 5rem}
header{border-bottom:2px solid var(--rule-strong);padding-bottom:1.75rem;margin-bottom:2.5rem}
/* Ruled-ledger texture: the project is a measurement instrument; the page keeps its log. */
header{background-image:repeating-linear-gradient(
  color-mix(in srgb,var(--rule) 36%,transparent) 0 1px,transparent 1px 28px);
  background-origin:content-box;background-position:0 calc(100% - 1px)}
.eyebrow{
  font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.72rem;letter-spacing:.14em;
  text-transform:uppercase;color:var(--accent);margin:0 0 .6rem
}
h1{
  font-family:"IBM Plex Serif",Georgia,serif;font-weight:600;font-size:clamp(1.9rem,4.5vw,2.9rem);
  line-height:1.15;margin:0 0 .75rem;text-wrap:balance;letter-spacing:-.01em
}
h2{
  font-family:"IBM Plex Serif",Georgia,serif;font-weight:600;font-size:1.6rem;margin:3rem 0 1rem;
  text-wrap:balance;padding-bottom:.4rem;border-bottom:1px solid var(--rule)
}
h3{font-family:"IBM Plex Serif",Georgia,serif;font-weight:600;font-size:1.22rem;margin:0 0 .3rem}
h4{font-size:.82rem;font-family:"IBM Plex Mono",monospace;text-transform:uppercase;letter-spacing:.1em;
   color:var(--ink-faint);margin:1.75rem 0 .6rem;font-weight:500}
p{margin:0 0 1rem;max-width:68ch}
.lede{font-size:1.06rem;color:var(--ink-soft);max-width:66ch}
a{color:var(--accent-ink);text-decoration-thickness:1px;text-underline-offset:2px}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:2px}
code{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.87em}
.caution{
  background:var(--accent-soft);border-left:3px solid var(--accent);
  padding:1.1rem 1.3rem;margin:2rem 0;border-radius:0 3px 3px 0
}
.caution h2{margin:0 0 .5rem;font-size:1.05rem;border:0;padding:0}
.caution p{color:var(--ink);max-width:70ch}
.caution p:last-child{margin-bottom:0}
.corpus{background:var(--panel);border:1px solid var(--rule);border-radius:4px;padding:1.5rem;margin:0 0 1.5rem}
.corpus.thin{border-style:dashed;border-color:var(--rule-strong)}
.thin-note{
  background:var(--ground);border-left:3px solid var(--warn);padding:.65rem .9rem;
  font-size:.84rem;color:var(--ink-soft);margin:0 0 1rem;max-width:none;border-radius:0 3px 3px 0
}
.meta{font-family:"IBM Plex Mono",monospace;font-size:.76rem;color:var(--ink-faint);margin-bottom:1.1rem;max-width:none}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;font-size:.87rem;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:.55rem .7rem;border-bottom:1px solid var(--rule);white-space:nowrap}
thead th{
  font-family:"IBM Plex Mono",monospace;font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;
  color:var(--ink-faint);font-weight:500;border-bottom:1px solid var(--rule-strong)
}
tbody th{font-weight:500}
td.n,th.n{text-align:right}
tr.subject{background:var(--accent-soft)}
tr.subject th{color:var(--accent-ink);font-weight:600}
tr.subject td.d{color:var(--accent-ink)}
tr.absent td{color:var(--ink-faint);font-style:italic}
.bar{display:block;height:3px;background:var(--rule);margin-top:.3rem;border-radius:2px;overflow:hidden}
.bar>span{display:block;height:100%;background:var(--bar)}
td.d{font-family:"IBM Plex Mono",monospace;font-size:.78rem;color:var(--ink-faint)}
td.d.up.sig{color:var(--up);font-weight:500}
td.d.down.sig{color:var(--down);font-weight:500}
td.d.base{color:var(--ink-faint)}
tr.rss th,tr.rss td{color:var(--ink-faint);font-size:.8rem;border-bottom:0}
ul{max-width:68ch;padding-left:1.15rem}
li{margin-bottom:.45rem}
pre{
  background:var(--panel);border:1px solid var(--rule);border-radius:4px;padding:1rem;
  overflow-x:auto;font-family:"IBM Plex Mono",monospace;font-size:.8rem;line-height:1.55
}
footer{margin-top:3.5rem;padding-top:1.25rem;border-top:1px solid var(--rule);color:var(--ink-faint);font-size:.8rem}

/* ── landing: stats, charts, feynman ─────────────────────────────────────── */
nav.toc{
  position:sticky;top:0;z-index:9;background:color-mix(in srgb,var(--ground) 88%,transparent);
  backdrop-filter:blur(6px);border-bottom:1px solid var(--rule);margin:2rem -1.25rem 2rem;
  padding:.55rem 1.25rem;display:flex;gap:1.25rem;flex-wrap:wrap
}
nav.toc a{font-family:"IBM Plex Mono",monospace;font-size:.74rem;letter-spacing:.06em;text-transform:uppercase;
  text-decoration:none;color:var(--ink-faint)}
nav.toc a:hover{color:var(--accent-ink)}
section[id],div[id],figure[id]{scroll-margin-top:3.5rem}
h1,p,li,h2,h3{text-wrap:pretty}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(10.5rem,1fr));gap:.75rem;margin:1.75rem 0}
.stat{background:var(--panel);border:1px solid var(--rule);border-top:2px solid var(--accent);border-radius:0 0 4px 4px;padding:.85rem 1rem}
.stat b{display:block;font-family:"IBM Plex Serif",Georgia,serif;font-size:1.7rem;line-height:1.15;color:var(--accent-ink);font-variant-numeric:tabular-nums}
.stat span{font-size:.76rem;color:var(--ink-soft)}
.chartcard{background:var(--panel);border:1px solid var(--rule);border-radius:4px;padding:1.4rem;margin:0 0 1.5rem}
.chartcard figcaption{font-size:.82rem;color:var(--ink-soft);margin-top:.7rem;max-width:none}
.chartcard figcaption strong{color:var(--ink)}
svg.chart{display:block;height:auto}
svg.chart text{font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:12px;fill:var(--ink-soft)}
svg.chart .cat{${MONO};font-size:11px;fill:var(--ink);font-weight:500}
svg.chart .tick{${MONO};font-size:10px;fill:var(--ink-faint)}
svg.chart .tick.strong{fill:var(--ink);font-weight:600}
svg.chart .val{${MONO};font-size:11px;fill:var(--ink)}
svg.chart .legend{font-size:11px;fill:var(--ink-faint)}
svg.chart .grid{stroke:var(--rule);stroke-width:1}
svg.chart .zero{stroke:var(--rule-strong);stroke-width:1.5}
svg.chart .whisker{stroke:var(--ink-faint);stroke-width:1.2}
.feynman{counter-reset:fstep;background:var(--panel);border:1px solid var(--rule);border-radius:4px;padding:1.5rem;margin:0 0 1.5rem}
.feynman h3{font-size:1.02rem;margin:0 0 .45rem}
.fstep{min-width:0;padding:1rem 0;border-top:1px dashed var(--rule)}
.fstep:first-of-type{border-top:0;padding-top:.4rem}
.fstep p:last-child{margin-bottom:0}
table.rr{display:block;width:max-content;max-width:100%;overflow-x:auto;border-collapse:collapse;margin:.8rem auto;font-variant-numeric:tabular-nums;font-size:.86rem}
table.rr th,table.rr td{border:1px solid var(--rule);padding:.35rem .8rem;text-align:center;white-space:normal}
table.rr thead td{font-family:"IBM Plex Mono",monospace;color:var(--accent-ink);font-weight:600}
table.rr tbody td{font-family:"IBM Plex Mono",monospace}
table.rr th{font-family:"IBM Plex Mono",monospace;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-faint);font-weight:500}
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference){
    .corpus,.chartcard,.feynman{animation:rise linear both;animation-timeline:view();animation-range:entry 0% entry 42%}
    @keyframes rise{from{translate:0 18px}}
  }
}
@media print{
  nav.toc{display:none}
  body{background:#fff}
  .corpus,.chartcard,.feynman,.stat{break-inside:avoid;border-color:#ccc}
}
@media (max-width:700px){
  /* A scaled-down 12px SVG label is unreadable; keep charts full size and let them swipe. */
  .chartcard{overflow-x:auto}
  .chartcard svg.chart{min-width:620px}
}
@media (max-width:640px){ .wrap{padding:2rem 1rem 3rem} nav.toc{margin-inline:-1rem;padding-inline:1rem} .corpus{padding:1rem} }
</style>
</head>
<body>
<main class="wrap">
<header>
  <p class="eyebrow">hay · benchmark</p>
  <h1>Ranked grep, measured against everything else</h1>
  <p class="lede">Every code-search tool installed on the test machine, over ${d.corpora.filter((corpus) => !thin(corpus)).length} usable repositories${d.corpora.some(thin) ? ` (plus ${d.corpora.filter(thin).length} thin self-check corpus)` : ""},
  on one task: given a symbol, how far down the results is its declaration?</p>
  <div class="stats">
    <div class="stat"><b>${d.corpora.filter((c) => !thin(c)).length}</b><span>repositories, each parsed for ground truth</span></div>
    <div class="stat"><b>${d.corpora.filter((c) => !thin(c)).reduce((s, c) => s + c.queries, 0)}</b><span>sampled queries, identical for every tool</span></div>
    <div class="stat"><b>${new Set(d.corpora.flatMap((c) => c.tools.filter((t) => t.available).map((t) => t.tool))).size}</b><span>search tools, one referee</span></div>
    <div class="stat"><b>${(() => { const m = Math.max(...deltaRows(d).filter((r) => r.tool === "hay").map((r) => r.mean), -Infinity); return m > -Infinity && m > 0 ? `+${m.toFixed(2)}` : "—"; })()}</b><span>hay’s best MRR margin over ripgrep (95% CI whiskers below)</span></div>
  </div>
</header>

<nav class="toc" aria-label="sections">
  <a href="#results">results</a><a href="#from-zero">from zero</a><a href="#method">method</a><a href="#data">per-corpus data</a><a href="#limits">limits</a><a href="#reproduce">reproduce</a>${docs ? '<a href="#docs-track">docs track</a>' : ""}
</nav>

<div class="caution">
  <h2>Read this before the numbers</h2>
  <p><code>hay</code> is built to rank declarations first, and this benchmark's ground truth <em>is</em>
  the declaration. It measures the thing <code>hay</code> optimises for, so it should win — and a win
  here is weaker evidence than it looks. Read inferential margins only for invocations with an
  explicit stable-order contract; every unordered tool remains visible as a descriptive snapshot.</p>
  <p>The project's other evaluation does not have this problem: real agent searches paired with the
  files the agent opened next, so the ground truth was not designed around the tool. It is also
  unreproducible by anyone else, because those transcripts are private. Neither evaluation is
  sufficient alone, which is why both exist.</p>
</div>

<figure class="chartcard" tabindex="0" id="results">
<h2 style="margin-top:.25rem">The result in one picture</h2>
<p>Each mark is a tool’s mean improvement over deterministic ripgrep <code>--sort path</code> on that repository, with a 95%
bootstrap-interval whisker. A <strong>filled</strong> mark means both statistical tests agree the
difference is real; a hollow mark means they disagree or the interval touches zero — exactly the
cases the tables refuse to call detected. The vertical line is ripgrep itself.</p>
${chartDelta(d)}
<figcaption><strong>Read it as:</strong> further right = answers higher up the list than ripgrep.
hay (circles) is favoured by construction here — the ground truth <em>is</em> a declaration ranking,
which is what hay optimises. Only stable-order invocations enter this inferential chart; unordered
tools remain visible as descriptive snapshots in the tables and first-page chart.</figcaption>
</figure>
<figure class="chartcard" tabindex="0">
<h2 style="margin-top:.25rem">The first page of results</h2>
<p>Agents read roughly ten results. Share of queries answered within them; bars for unordered tools are descriptive snapshots:</p>
${chartTop10(d)}
</figure>
<figure class="chartcard" tabindex="0">
<h2 style="margin-top:.25rem">What speed costs</h2>
<p>Full-repository search time relative to ripgrep <code>--sort path</code> — geometric mean over complete paired queries, log
scale. Ranking costs work; the question is how much answer quality buys:</p>
${chartTime(d)}
</figure>

${FEYNMAN}

<h2 id="method">Method</h2>
<ul>
  <li><strong>Ground truth</strong> — ${esc(d.groundTruth)}. A symbol declared in more than one place is discarded: with no single right answer, scoring against an arbitrary one is noise.</li>
  <li><strong>Queries</strong> — symbols with 5–2,000 occurrences, sampled with a fixed seed so the same corpus yields the same queries every run.</li>
  <li><strong>Metric</strong> — reciprocal rank of the first result line in the declaring file, capped at ${d.rankCap}.</li>
  <li><strong>Difference</strong> — only for stable-order invocations: absolute, against deterministic ripgrep <code>--sort path</code>, 95% paired bootstrap interval over per-query reciprocal ranks, 10,000 replicates, fixed seed. Unordered tools remain descriptive snapshots. An interval spanning zero is not a detected difference.</li>
  <li><strong>Flag parity</strong> — every tool asked for the same job. Filtering is deliberately not normalised across tools: what a tool skips is a real property of it, so the file counts it sees are reported instead. Ripgrep gets <code>--sort path --no-ignore-dot --no-ignore-global --no-ignore-exclude</code> so its order is deterministic and it walks exactly what <code>hay</code> walks; ugrep gets its documented <code>--sort=name</code>. Without these controls, the head-to-head changes with traversal scheduling instead of ranking quality.</li>
  <li><strong>Invocation</strong> — absolute paths only. On this machine <code>grep</code> is a shell function resolving to ugrep, so calling tools by name would have measured the wrong program.</li>
</ul>

${docs ? `${docsHtml(docs)}\n\n` : ""}${d.corpora.map(corpusSection).join("\n")}

<h2 id="data">What each tool is</h2>
<div class="scroll" tabindex="0"><table>
<thead><tr><th scope="col">tool</th><th scope="col">ranks results</th><th scope="col">skips files</th><th scope="col">deterministic</th><th scope="col">machine-readable</th><th scope="col">index</th></tr></thead>
<tbody>${CAPABILITIES.map((c) => `<tr><th scope="row"><code>${esc(c.id)}</code></th><td>${esc(c.ranked)}</td><td>${esc(c.ignore)}</td><td>${esc(c.deterministic)}</td><td>${esc(c.json)}</td><td>${esc(c.index)}</td></tr>`).join("")}</tbody>
</table></div>

<h3>Not benchmarked</h3>
<ul>${NOT_BENCHMARKED.map(([n, w]) => `<li><strong>${esc(n!)}</strong> — ${esc(w!)}</li>`).join("")}</ul>

<h2 id="limits">Limits</h2>
<ul>
  <li><strong>The task favours <code>hay</code> by construction.</strong> Stated twice because it is the most important caveat here.</li>
  <li><strong>Definition-finding is not all of search.</strong> An agent also asks where something is used, what calls what, and where a behaviour lives with no symbol to name it. None of that is measured.</li>
  ${d.load ? `<li><strong>The machine was busy.</strong> Load average ranged ${d.load.min.toFixed(1)}–${d.load.max.toFixed(1)} (median ${d.load.median.toFixed(1)}) over ${d.load.samples} samples on ${d.machine.cpus} cores. Ranking is unaffected, but read the timings as indicative and trust ratios more than absolutes.</li>` : ""}
  <li><strong>Ground truth is a parser's opinion.</strong> Declaration forms the patterns miss are absent rather than wrong.</li>
  <li><strong>Unordered tools are snapshots, not inference.</strong> Their MRR and top-10 values describe this run only; scheduler or traversal order may change them on the same immutable corpus.</li>
  <li><strong>One machine, one filesystem, macOS.</strong></li>
</ul>

<h2 id="reproduce">Reproduce it</h2>
<pre tabindex="0"><code># clones whatever benchmark.ts wants, runs --sample 30, renders this page, deletes its clones:
./benchmark-corpora.sh

# or, by hand:
BENCH_CORPORA="\${XDG_CACHE_HOME:-$HOME/.cache}/hay/corpora"
mkdir -p "$BENCH_CORPORA"
git clone --depth 1 https://github.com/torvalds/linux.git       "$BENCH_CORPORA/linux"
git clone --depth 1 https://github.com/openclaw/openclaw.git     "$BENCH_CORPORA/openclaw"
git clone --depth 1 https://github.com/BurntSushi/ripgrep.git   "$BENCH_CORPORA/ripgrep"
git clone --depth 1 https://github.com/Alamofire/Alamofire.git   "$BENCH_CORPORA/alamofire"
cargo build --release --manifest-path hay/Cargo.toml
bun benchmark.ts --corpora "$BENCH_CORPORA" --sample 30
bun benchmark-report.ts             # writes BENCHMARK.md and this page</code></pre>

<footer>
  Generated from <code>evidence/benchmark.json</code> by <code>benchmark-report.ts</code>.
  Generated: ${esc(d.generatedAt)} ·
  Versions: ${Object.entries(d.versions).map(([k, v]) => `${esc(k)} ${esc(v.split(" ").slice(0, 2).join(" "))}`).join(" · ")}
</footer>
</main>
</body>
</html>
`;
}

// ── main ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const flag = (n: string, f: string) => {
    const i = argv.indexOf(n);
    if (i === -1) return f;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${n} needs a value`);
    return v;
  };

  if (argv.includes("--selftest")) {
    const eq = (a: unknown, b: unknown, m: string) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    };
    eq(pct(0.583), "58%", "percent");
    eq(num(0.3966), "0.397", "three decimals");
    eq(num(null), "—", "missing value");
    eq(delta(undefined), "baseline", "the baseline has no difference from itself");
    eq(deltaCell({ tool: "rg", deterministic: true }), "baseline", "baseline cell");
    eq(deltaCell({ tool: "ag", deterministic: false }), "snapshot only", "unordered tools do not get inference");
    eq(deltaCell({ tool: "hay", deterministic: true }), "—", "missing deterministic comparison is not mislabeled baseline");
    // 0.1475 renders as 0.147, not 0.148: it is not exactly representable in binary and toFixed
    // rounds the stored value, which is below the decimal midpoint. Pinned so a future change to
    // the formatter cannot quietly shift a published interval bound.
    eq(delta({ mean: 0.0808, lo: 0.0183, hi: 0.1475, p: 0.01, n: 40, clusters: 40 }), "+0.081 [0.018, 0.147]", "signed delta");
    eq(delta({ mean: -0.0035, lo: -0.0103, hi: 0.0, p: 0.1, n: 50, clusters: 50 }), "-0.004 [-0.010, 0.000]", "negative delta");
    // An interval touching zero is NOT a detected difference; getting this backwards would
    // publish noise as a result, which is the mistake this whole project is about.
    eq(significant({ mean: 0.08, lo: 0.02, hi: 0.15, p: 0, n: 1, clusters: 1 }), true, "excludes zero");
    eq(significant({ mean: -0.003, lo: -0.01, hi: 0.0, p: 0.1, n: 1, clusters: 1 }), false, "touches zero");
    eq(significant({ mean: 0.01, lo: -0.01, hi: 0.03, p: 0.4, n: 1, clusters: 1 }), false, "spans zero");
    // A p of exactly 0 is impossible from a finite simulation, so the floor must render as a
    // bound and not as certainty.
    eq(randP({ tool: "hay", vsRipgrepRandP: 0.00009999 }), "<0.001", "simulation floor is a bound");
    eq(randP({ tool: "hay", vsRipgrepRandP: 0.0423 }), "0.042", "ordinary p");
    eq(randP({ tool: "rg", vsRipgrepRandP: 0.5 }), "baseline", "the baseline is not tested against itself");
    // Both tests must agree before a difference is called detected. The real case from this
    // corpus: openclaw's hay row, where the interval excludes zero and the reference test does not
    // agree. Bolding it on the interval alone is the generous reading this project exists to avoid.
    const openclawHay = { tool: "hay", vsRipgrep: { mean: 0.150, lo: 0.005, hi: 0.297, p: 0.04, n: 30, clusters: 30 }, vsRipgrepRandP: 0.0576 };
    eq(detected(openclawHay), false, "an interval alone does not detect a difference");
    eq(disputed(openclawHay), true, "and the disagreement is surfaced, not buried");
    const agreed = { tool: "hay", vsRipgrep: { mean: 0.302, lo: 0.156, hi: 0.449, p: 0.0002, n: 28, clusters: 28 }, vsRipgrepRandP: 0.0007 };
    eq(detected(agreed), true, "both tests agreeing is a detected difference");
    eq(disputed(agreed), false, "agreement is not a dispute");
    eq(detected({ tool: "hay", vsRipgrep: { mean: 0.01, lo: -0.01, hi: 0.03, p: 0.4, n: 20, clusters: 20 }, vsRipgrepRandP: 0.001 }), false, "a spanning interval is never detected");
    eq(significant(undefined), false, "no interval");
    eq(ms({ medianMs: 1801, minMs: 1, peakRssMb: 1, timedOut: false }), "1.80 s", "seconds");
    eq(ms({ medianMs: 42, minMs: 1, peakRssMb: 1, timedOut: false }), "42 ms", "milliseconds");
    eq(ms({ medianMs: null, minMs: null, peakRssMb: null, timedOut: true }), "timeout", "timeout");
    eq(esc('<a href="x">&'), "&lt;a href=&quot;x&quot;&gt;&amp;", "html escaping");
    // Peak memory is the max across queries, not the first query's value.
    const mk = (rss: (number | null)[]): CorpusReport => ({
      corpus: "c", lang: "rust", files: { onDisk: 1, rgVisible: 1, gitTracked: 1 },
      provenance: { revision: "a".repeat(40), dirty: false },
      symbolsUniquelyDeclared: 1, queries: 1, tools: [],
      perf: rss.map((v, i) => ({ query: `q${i}`, results: { t: { medianMs: 1, minMs: 1, peakRssMb: v, timedOut: false } } })),
    });
    eq(peakRss(mk([12, 99, 40]), "t"), "99 MB", "peak is the largest, not the first");
    eq(peakRss(mk([null, null]), "t"), "—", "no measurements");
    eq(peakRss(mk([]), "t"), "—", "no queries");
    // ── charts ──
    eq(geomean([2, 8]), 4, "geometric mean of 2 and 8 is 4");
    eq(Number.isNaN(geomean([])), true, "empty geomean is not a number, never a fake 1.0×");
    const mkCorpus = (name: string, queries: number, tools: Partial<Record<string, { mrr?: number; top10?: number; ms?: number | null; available?: boolean; deterministic?: boolean; vs?: [number, number, number] }>>): CorpusReport => ({
      corpus: name, lang: "rust", files: { onDisk: 1, rgVisible: 1, gitTracked: 1 },
      symbolsUniquelyDeclared: 1, queries,
      provenance: { revision: "b".repeat(40), dirty: false },
      tools: Object.entries(tools).map(([tool, v]) => ({
        tool, label: tool, available: v?.available ?? true, deterministic: v?.deterministic ?? true, queries: 1,
        mrr: v?.mrr ?? 0.5, top10: v?.top10 ?? 0.8, medianRank: null, unreachable: 0, timeouts: 0,
        vsRipgrep: v?.deterministic !== false && v?.vs ? { mean: v.vs[0], lo: v.vs[1], hi: v.vs[2], p: 0, n: queries, clusters: queries } : undefined,
        ...(v?.deterministic !== false && tool === "hay" && v?.vs ? { vsRipgrepRandP: 0.001 } : {}),
      })),
      perf: [0, 1, 2].map((i) => ({ query: `q${i}`, results: {
        rg: { medianMs: v_ms("rg"), minMs: 1, peakRssMb: null, timedOut: false },
        hay: { medianMs: v_ms("hay"), minMs: 1, peakRssMb: null, timedOut: false },
        ugrep: { medianMs: v_ms("ugrep")!, minMs: 1, peakRssMb: null, timedOut: false },
        ack: { medianMs: null, minMs: null, peakRssMb: null, timedOut: true },
        grep: { medianMs: null, minMs: null, peakRssMb: null, timedOut: false },
      } })),
    });
    function v_ms(tool: string): number | null {
      return tool === "rg" ? 10 : tool === "hay" ? 5 : tool === "ugrep" ? 20 : null;
    }
    const payload: Payload = {
      task: "t", groundTruth: "g", rankCap: 50, machine: { loadavg: "1", cpus: 1 }, versions: {},
      generatedAt: "2026-08-26T00:00:00.000Z",
      corpora: [
        mkCorpus("real", 30, { hay: { vs: [0.3, 0.2, 0.4] }, "ast-grep": { deterministic: false }, cs: { deterministic: false } }),
        mkCorpus("thin", 3, { hay: { vs: [0.9, 0.8, 1.0] } }),
        mkCorpus("absent", 28, { hay: { available: false, vs: [0.9, 0.8, 1.0] } }),
      ],
    };
    const docsFeatures: Record<DocShape, boolean> = {
      flagShaped: false, hyphenated: false, snakeCase: false,
      upperCase: false, camelCase: false, pascalCase: false, plainWord: true,
    };
    const mkDocsCorpus = (name: string, n: number, interval: Interval, randomizationP: number): DocsCorpusReport => ({
      corpus: name, lang: "rust", eligibleQueries: n,
      provenance: { revision: "c".repeat(40), dirty: false },
      queries: Array.from({ length: n }, (_, i) => ({
        token: `plainword${i}`, answer: "docs/answer.md", occurrences: 3, features: docsFeatures,
        tools: {
          hay: { rank: 2, scanned: 2, timedOut: false, truncated: false },
          rg: { rank: 4, scanned: 4, timedOut: false, truncated: false },
        },
      })),
      tools: { hay: { mrr: 0.5, top10: 1 }, rg: { mrr: 0.25, top10: 1 } },
      delta: { mrr: interval, randomizationP },
      featureSplits: DOC_SHAPES.map((feature) => ({
        feature, n: feature === "plainWord" ? n : 0,
        mrr: { hay: feature === "plainWord" ? 0.5 : 0, rg: feature === "plainWord" ? 0.25 : 0 },
        deltaMrr: feature === "plainWord" ? 0.25 : 0,
      })),
      truncations: { hay: 0, rg: 0 },
    });
    const docsPayload: DocsPayload = {
      generatedBy: "benchmark.ts --docs-track", task: "docs", groundTruth: "headings",
      meta: { date: "2026-08-23", seed: 7, sample: 12, rankCap: 1000, versions: { hay: "hay 1", rg: "rg 1" } },
      corpora: [
        mkDocsCorpus("agree", 12, { mean: 0.25, lo: 0.1, hi: 0.4, p: 0.002, n: 12, clusters: 12 }, 0.003),
        mkDocsCorpus("disagree", 11, { mean: 0.25, lo: 0.01, hi: 0.4, p: 0.02, n: 11, clusters: 11 }, 0.08),
      ],
    };
    validateDocsPayload(docsPayload);
    eq(docsAgreement(docsPayload.corpora[0]!), "✓ agree — detected", "docs tests agree marker");
    eq(docsAgreement(docsPayload.corpora[1]!), "⚠ disagree", "docs tests disagree marker");
    const docsMd = markdown(payload, docsPayload);
    const docsPage = html(payload, docsPayload);
    for (const rendered of [docsMd, docsPage]) {
      if (!rendered.includes("Documentation track")) throw new Error("docs section did not render");
      if (!rendered.includes("✓ agree — detected") || !rendered.includes("⚠ disagree"))
        throw new Error("docs agreement markers did not render");
      if (!rendered.includes("plainWord")) throw new Error("docs feature splits did not render");
    }
    // Optional means truly absent: passing no docs payload and passing undefined must produce the
    // same bytes, and neither renderer may leave an empty heading behind.
    eq(markdown(payload), markdown(payload, undefined), "markdown is byte-identical when docs are absent");
    eq(html(payload), html(payload, undefined), "html is byte-identical when docs are absent");
    if (markdown(payload).includes("Documentation track") || html(payload).includes("Documentation track"))
      throw new Error("absent docs payload left a rendered section");
    const nonfiniteDocs = structuredClone(docsPayload);
    nonfiniteDocs.corpora[0]!.tools.hay.mrr = Number.NaN;
    try { validateDocsPayload(nonfiniteDocs); throw new Error("docs validator let NaN through"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    const duplicateFeature = structuredClone(docsPayload);
    duplicateFeature.corpora[0]!.featureSplits[0]!.feature = duplicateFeature.corpora[0]!.featureSplits[1]!.feature;
    try { validateDocsPayload(duplicateFeature); throw new Error("docs validator let a duplicate feature replace another"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    const dirtyDocs = structuredClone(docsPayload);
    dirtyDocs.corpora[0]!.provenance = { revision: "a".repeat(40), dirty: true };
    try { validateDocsPayload(dirtyDocs); throw new Error("docs validator accepted a dirty corpus"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    const missingDocsProvenance = structuredClone(docsPayload);
    Reflect.deleteProperty(missingDocsProvenance.corpora[0]!, "provenance");
    try { validateDocsPayload(missingDocsProvenance); throw new Error("docs validator accepted missing provenance"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    const missingDocsClusters = structuredClone(docsPayload);
    Reflect.deleteProperty(missingDocsClusters.corpora[0]!.delta.mrr, "clusters");
    try { validateDocsPayload(missingDocsClusters); throw new Error("docs validator accepted missing clusters"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    const invalidDocsDate = structuredClone(docsPayload);
    invalidDocsDate.meta.date = "2026-02-30";
    try { validateDocsPayload(invalidDocsDate); throw new Error("docs validator accepted an invalid date"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    // Finite-but-false: a summary that disagrees with its own per-query rows must also refuse.
    const inconsistentDocs = structuredClone(docsPayload);
    inconsistentDocs.corpora[0]!.tools.hay.mrr = 0.9;
    try { validateDocsPayload(inconsistentDocs); throw new Error("docs validator let an inconsistent aggregate through"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    const inconsistentSplit = structuredClone(docsPayload);
    inconsistentSplit.corpora[0]!.featureSplits[0]!.n = 5;
    try { validateDocsPayload(inconsistentSplit); throw new Error("docs validator let an inconsistent split through"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    const committedEvidence = validatePayload(await Bun.file("evidence/benchmark.json").json() as Payload);
    const dirtyEvidence = structuredClone(committedEvidence);
    dirtyEvidence.corpora[0]!.provenance = { revision: "a".repeat(40), dirty: true };
    try { validatePayload(dirtyEvidence); throw new Error("validator accepted a dirty corpus"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    const missingGeneratedAt = structuredClone(committedEvidence);
    Reflect.deleteProperty(missingGeneratedAt, "generatedAt");
    try { validatePayload(missingGeneratedAt); throw new Error("validator accepted a missing timestamp"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    const missingDeterminism = structuredClone(committedEvidence);
    Reflect.deleteProperty(missingDeterminism.corpora[0]!.tools[0]!, "deterministic");
    try { validatePayload(missingDeterminism); throw new Error("validator accepted missing rank-order metadata"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    const snapshotWithInference = structuredClone(committedEvidence);
    const snapshot = snapshotWithInference.corpora.flatMap((corpus) => corpus.tools).find((tool) => tool.available && !tool.deterministic)!;
    const reference = snapshotWithInference.corpora[0]!.tools.find((tool) => tool.tool === "hay")!;
    snapshot.vsRipgrep = structuredClone(reference.vsRipgrep!);
    snapshot.vsRipgrepRandP = reference.vsRipgrepRandP;
    try { validatePayload(snapshotWithInference); throw new Error("validator accepted inference for an unordered snapshot"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    const missingProvenance = structuredClone(committedEvidence);
    Reflect.deleteProperty(missingProvenance.corpora[0]!, "provenance");
    try { validatePayload(missingProvenance); throw new Error("validator accepted missing provenance"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    const missingRandomization = structuredClone(committedEvidence);
    const missingRandomizationHay = missingRandomization.corpora[0]!.tools.find((tool) => tool.tool === "hay")!;
    Reflect.deleteProperty(missingRandomizationHay, "vsRipgrepRandP");
    try { validatePayload(missingRandomization); throw new Error("validator accepted a missing randomization test"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    const missingClusters = structuredClone(committedEvidence);
    const missingClustersHay = missingClusters.corpora[0]!.tools.find((tool) => tool.tool === "hay")!;
    Reflect.deleteProperty(missingClustersHay.vsRipgrep!, "clusters");
    try { validatePayload(missingClusters); throw new Error("validator accepted missing clusters"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    const unavailableComparison = structuredClone(committedEvidence);
    const unavailableHay = unavailableComparison.corpora[0]!.tools.find((tool) => tool.tool === "hay")!;
    unavailableHay.available = false;
    try { validatePayload(unavailableComparison); throw new Error("validator accepted a comparison for an unavailable tool"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    // Thin corpus and unavailable tools must vanish from summary charts, or the picture would
    // assert more than the tables do.
    eq(perfLabel("rg"), "rg --sort path", "timing label names the deterministic baseline");
    eq(perfLabel("ugrep"), "ugrep --sort=name", "timing label names the deterministic ugrep mode");
    eq(deltaRows(payload).map((r) => `${r.corpus}:${r.tool}`), ["real:hay"], "delta rows drop thin, absent, and unordered snapshots");
    eq(timeRatios(payload).map((r) => r.tool), ["hay", "ugrep"], "only tools with measurable timings appear");
    eq(timeRatios(payload)[0]!.ratio, 0.5, "hay at half of ripgrep's time");
    eq(timeRatios(payload).every((row) => row.samples === 6), true, "timing rows share one complete paired cohort");
    if (!chartTime(payload).includes("tools with timeouts omitted"))
      throw new Error("timing chart does not disclose timeout exclusion");
    // Charts must render as self-describing SVG for every real-shaped payload.
    for (const [name, svg] of [["delta", chartDelta(payload)], ["top10", chartTop10(payload)], ["time", chartTime(payload)]] as const) {
      if (!svg.includes("role=\"img\"")) throw new Error(`${name} chart lacks role=img`);
      if (!svg.includes("<title")) throw new Error(`${name} chart lacks a title`);
      if (/[\u003c]script/i.test(svg)) throw new Error(`${name} chart contains script`);
    }
    eq(chartTop10({ ...payload, corpora: [] }), "", "empty payload renders no chart");
    // top10 is stored as a fraction; a 0.8 bar must span 80% of the 546px plot (=436.8px).
    // The old bug divided by 100 again, which rendered every bar ~5px wide.
    {
      const svg = chartTop10(payload);
      const widths = [...svg.matchAll(/width="([\d.]+)"/g)].map((m) => Number(m[1]));
      const maxBar = Math.max(...widths);
      if (!(maxBar > 420 && maxBar < 450)) throw new Error(`top10 bars render at ${maxBar}px — fraction/percent mixup is back`);
      const axisX = [...svg.matchAll(/x1="([\d.]+)"/g)].map((m) => Number(m[1]));
      if (Math.max(...axisX) > 760 || !svg.includes(">50%</text>")) throw new Error("top10 axis is not on the 0–1 scale");
    }
    // The trust boundary: non-numeric payloads must fail closed before any rendering.
    const tampered = JSON.parse(JSON.stringify(payload));
    tampered.corpora[0].queries = '<img src=x onerror=alert(1)>';
    try { validatePayload(tampered); throw new Error("validator let a string through as queries"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    try { validatePayload({ ...payload, rankCap: "50" } as unknown as Payload); throw new Error("validator let rankCap through"); }
    catch (e) { if (!String(e).includes("tampered")) throw e; }
    // A corpus that yielded one query must never present a difference as detected.
    eq(thin({ queries: 1 }), true, "one query is not evidence");
    eq(thin({ queries: 9 }), true, "below the floor");
    eq(thin({ queries: 10 }), false, "at the floor");
    eq(thin({ queries: 28 }), false, "a real corpus");
    console.log("selftest ok");
    process.exit(0);
  }

  const inPath = flag("--in", "evidence/benchmark.json");
  const d = validatePayload(await Bun.file(inPath).json()) as Payload;
  const docsPath = flag("--docs-in", "evidence/docs-track.json");
  const docs = await Bun.file(docsPath).exists()
    ? validateDocsPayload(await Bun.file(docsPath).json() as DocsPayload)
    : undefined;

  // Load samples are collected alongside the run; without them the timing caveat cannot be stated
  // truthfully, so it is simply omitted rather than guessed.
  const loadFile = flag("--load", "");
  if (loadFile && (await Bun.file(loadFile).exists())) {
    const xs = (await Bun.file(loadFile).text()).split("\n").map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if (xs.length) d.load = { min: xs[0]!, median: xs[Math.floor(xs.length / 2)]!, max: xs[xs.length - 1]!, samples: xs.length };
  }

  await Bun.write(flag("--md", "BENCHMARK.md"), markdown(d, docs));
  await Bun.write(flag("--html", "benchmark.html"), html(d, docs));
  console.error(`wrote ${flag("--md", "BENCHMARK.md")} and ${flag("--html", "benchmark.html")}`);
}
