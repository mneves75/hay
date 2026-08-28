#!/usr/bin/env bun
/**
 * categorize-misses — the counted error taxonomy behind any change to hay's ranking.
 *
 * AGENTS.md: "Measure which thing to build, do not guess." The gate fails at ~58% top-10 against
 * the required 80%, and until this file existed there was no theory of the gap — 226 regressions
 * against ripgrep had never been looked at. This script reads the per-query paired records that
 * `measure-mrr.ts --compare --dump-pairs` writes and assigns every miss and every regression ONE
 * primary category, in priority order, so the categories sum to the population and the biggest
 * bucket names the next signal to build.
 *
 * Instrument losses (truncation, asymmetric visibility) are separated from ranking failures
 * first — otherwise the error analysis chases the harness, which is this repo's founding defect.
 *
 * Outputs:
 *   evidence/error-taxonomy.json   counts ONLY — publishable (invariant 4)
 *   corpus/miss-labels.json        full labeled records — private, never committed
 *   corpus/inspection-sample.json  seeded sample for the manual pass — private
 *
 * Usage:
 *   bun categorize-misses.ts [--pairs corpus/pairs.json] [--selftest]
 */

import { mulberry32, type Pair } from "./measure-mrr.ts";

/** Same value as measure-mrr.ts RANK_CAP; a pair whose rg scan reached it saw a result flood. */
const RANK_CAP = 1000;

// ── classify_path, ported ─────────────────────────────────────────────────────
//
// A deliberate port of hay/src/score.rs `classify_path`, NOT a reimagining: the selftest below
// runs the exact cases from score.rs's `path_classification` test, so if either side changes the
// other fails loudly instead of the taxonomy silently drifting from the ranker it explains.

export type PathClass = "source" | "neutral" | "test" | "prose" | "data" | "buried";

const BURIED = ["/archive/", "/archived/", "/.scratch/", "/vendor/", "/dist/", "/build/",
  "/node_modules/", "/target/", "/.next/", "/coverage/", "/generated/", "/superseded/"];
const TEST = ["/test/", "/tests/", "/__tests__/", "/spec/", ".test.", ".spec.", "_test.", "/e2e/"];
const DATA_EXT = [".json", ".lock", ".csv", ".tsv", ".snap", ".ndjson", ".jsonl", ".min.js", ".map",
  ".sqlite", ".parquet"];
const PROSE_EXT = [".md", ".mdx", ".txt", ".rst", ".adoc"];
const SOURCE = ["src/", "lib/", "app/", "packages/", "crates/"];

export function classifyPath(path: string): PathClass {
  const p = path.toLowerCase().replaceAll("\\", "/");
  if (BURIED.some((d) => p.includes(d) || p.startsWith(d.slice(1)))) return "buried";
  if (TEST.some((d) => p.includes(d) || p.startsWith(d.slice(1)))) return "test";
  if (DATA_EXT.some((e) => p.endsWith(e)) || p.includes("/fixtures/") || p.includes("/__snapshots__/")) return "data";
  if (PROSE_EXT.some((e) => p.endsWith(e))) return "prose";
  if (SOURCE.some((d) => p.startsWith(d) || p.includes(`/${d}`))) return "source";
  return "neutral";
}

/** Classes hay's path prior pushes DOWN — an answer living there fights the tool's own weights. */
const PENALIZED: PathClass[] = ["test", "prose", "data", "buried"];

// ── categories ────────────────────────────────────────────────────────────────

/**
 * Languages whose definition shapes the ranker has actually been developed and tested against:
 * the keyword scan (TS/JS/Rust/Python-by-keyword and friends) plus the typed-declaration rule
 * (C/C++/Java). Everything else is a place the definition signal has never been checked, which
 * was exactly the C story — inert on the whole Linux kernel for four versions.
 */
const TESTED_EXT = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "rs", "c", "h", "cpp", "cc",
  "hpp", "java", "py"]);

export const CATEGORIES = [
  "truncated",
  "invisible-asymmetric",
  "generic-flood",
  "answer-penalized-class",
  "definition-lang-gap",
  "both-lose",
  "reordering-regression",
  "uncategorized",
] as const;
export type Category = (typeof CATEGORIES)[number];

export function ext(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/**
 * ONE primary category per query, first match wins. The order is the diagnosis order: instrument
 * limits before ranking behaviour, and the lexical ceiling (`both-lose`) before hay-specific
 * regressions, because a query ripgrep also cannot answer in ten lines is not evidence about
 * hay's reordering.
 */
export function categorize(p: Pair): Category {
  if (p.hayTruncated) return "truncated";
  const rgBlind = (p.resultsRg ?? -1) === 0;
  const hayBlind = (p.resultsHay ?? -1) === 0;
  if (rgBlind !== hayBlind) return "invisible-asymmetric";
  if ((p.resultsRg ?? 0) >= RANK_CAP) return "generic-flood";
  const answers = p.answers ?? [];
  if (answers.length > 0 && answers.every((a) => PENALIZED.includes(classifyPath(a)))) {
    return "answer-penalized-class";
  }
  if (answers.length > 0 && answers.every((a) => !TESTED_EXT.has(ext(a)))) {
    return "definition-lang-gap";
  }
  if (p.top10Rg === 0 && p.top10Hay === 0) return "both-lose";
  if (p.rrHay < p.rrRg) return "reordering-regression";
  return "uncategorized";
}

/** The two populations the gate cares about. A pair can be in both; it is counted once. */
export function population(pairs: Pair[]): Pair[] {
  return pairs.filter((p) => p.top10Hay === 0 || p.rrHay < p.rrRg);
}

export type Taxonomy = {
  pairsTotal: number;
  misses: number;
  regressions: number;
  population: number;
  categories: Record<Category, number>;
  /** Per-extension counts inside definition-lang-gap: which language the counts indict. */
  langGapExtensions: Record<string, number>;
};

export function taxonomy(pairs: Pair[]): Taxonomy {
  const pop = population(pairs);
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  const langGapExtensions: Record<string, number> = {};
  for (const p of pop) {
    const c = categorize(p);
    categories[c]++;
    if (c === "definition-lang-gap") {
      for (const a of p.answers ?? []) {
        const e = ext(a) || "(none)";
        langGapExtensions[e] = (langGapExtensions[e] ?? 0) + 1;
      }
    }
  }
  return {
    pairsTotal: pairs.length,
    misses: pairs.filter((p) => p.top10Hay === 0).length,
    regressions: pairs.filter((p) => p.rrHay < p.rrRg).length,
    population: pop.length,
    categories,
    langGapExtensions,
  };
}

/** Seeded stratified sample for the manual pass: hand labeling stops at `per` from each bucket. */
export function inspectionSample(pairs: Pair[], per = 40, seed = 20260820): { bucket: string; pairs: Pair[] }[] {
  const pop = population(pairs);
  const rand = mulberry32(seed);
  const pick = (xs: Pair[], n: number): Pair[] => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a.slice(0, n);
  };
  return [
    { bucket: "reordering-regression", pairs: pick(pop.filter((p) => categorize(p) === "reordering-regression"), per) },
    { bucket: "both-lose+uncategorized", pairs: pick(pop.filter((p) => ["both-lose", "uncategorized"].includes(categorize(p))), per) },
  ];
}

// ── main ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = Bun.argv.slice(2);

  if (argv.includes("--selftest")) {
    const eq = (a: unknown, b: unknown, m: string) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    };

    // The port must agree with hay/src/score.rs `path_classification` — these are ITS cases.
    eq(classifyPath("src/auth/session.ts"), "source", "source dir");
    eq(classifyPath("packages/core/src/x.ts"), "source", "nested source");
    eq(classifyPath("README.md"), "prose", "prose");
    eq(classifyPath("docs/archive/old.md"), "buried", "buried beats prose");
    eq(classifyPath("src/__tests__/a.test.ts"), "test", "test");
    eq(classifyPath("vendor/lib/x.go"), "buried", "vendor");
    eq(classifyPath("main.go"), "neutral", "neutral");
    eq(classifyPath("vendor/pkg/__tests__/x.ts"), "buried", "buried beats test");
    eq(classifyPath("docs\\archive\\old.md"), "buried", "windows separators");
    eq(classifyPath("evidence/run.json"), "data", "data ext");
    eq(classifyPath("bun.lock"), "data", "lockfile");
    eq(classifyPath("src/__snapshots__/a.snap"), "data", "snapshots");
    eq(classifyPath("src/index.ts"), "source", "source file");

    eq(ext("src/a.test.ts"), "ts", "extension");
    eq(ext("Makefile"), "", "no extension");
    eq(ext(".gitignore"), "", "dotfile is not an extension");

    // Priority order, one category per pair, on hand-built pairs.
    const base: Pair = {
      repo: "/x/a", label: "a", query: "q",
      rrRg: 0, rrHay: 0, top10Rg: 0, top10Hay: 0, ndcgRg: 0, ndcgHay: 0,
      rPrecRg: 0, rPrecHay: 0, pageComplete: true,
      rankRg: null, rankHay: null, resultsRg: 50, resultsHay: 50,
      answers: ["src/a.ts"], hayTruncated: false,
    };
    eq(categorize({ ...base, hayTruncated: true }), "truncated", "truncation first");
    eq(categorize({ ...base, resultsHay: 0 }), "invisible-asymmetric", "one-sided blindness");
    eq(categorize({ ...base, resultsRg: 1000, resultsHay: 1000 }), "generic-flood", "flood");
    eq(categorize({ ...base, answers: ["docs/notes.md", "x.test.ts"] }), "answer-penalized-class", "penalized answers");
    eq(categorize({ ...base, answers: ["cmd/main.go"] }), "definition-lang-gap", "untested language");
    eq(categorize(base), "both-lose", "rg missed too: the lexical ceiling");
    eq(categorize({ ...base, rrRg: 0.5, top10Rg: 1 }), "reordering-regression", "hay alone regressed");
    eq(categorize({ ...base, top10Hay: 1, rrHay: 1, rrRg: 0.5, top10Rg: 1 }), "uncategorized", "in population only via regression rules");
    // A penalized answer beside a source answer is NOT answer-penalized: hay had a fair target.
    eq(categorize({ ...base, answers: ["docs/notes.md", "src/a.ts"] }), "both-lose", "mixed answers are not penalized-class");

    // Population: misses ∪ regressions, counted once.
    const inPop = population([
      { ...base },                                              // miss
      { ...base, top10Hay: 1, rrHay: 0.2, rrRg: 0.5 },          // regression only
      { ...base, top10Hay: 1, rrHay: 1, rrRg: 0.5 },            // neither
    ]);
    eq(inPop.length, 2, "population is misses union regressions");

    // Counts must sum to the population.
    const t = taxonomy([{ ...base }, { ...base, hayTruncated: true }, { ...base, top10Hay: 1, rrHay: 1, rrRg: 0 }]);
    eq(Object.values(t.categories).reduce((a, b) => a + b, 0), t.population, "categories sum to population");
    eq(t.categories["both-lose"], 1, "one ceiling case");
    eq(t.categories.truncated, 1, "one truncated case");

    // The manual sample is seeded: same input, same sample.
    const many = Array.from({ length: 100 }, (_, i) => ({ ...base, query: `q${i}`, rrRg: 0.5, top10Rg: 1 }));
    const s1 = inspectionSample(many).map((b) => b.pairs.map((p) => p.query));
    const s2 = inspectionSample(many).map((b) => b.pairs.map((p) => p.query));
    eq(s1, s2, "inspection sample is deterministic");
    eq(s1[0]!.length, 40, "forty from the regression bucket");

    console.log("selftest ok");
    process.exit(0);
  }

  const pairsPath = (() => {
    const i = argv.indexOf("--pairs");
    return i !== -1 ? argv[i + 1]! : "corpus/pairs.json";
  })();
  const pairs: Pair[] = await Bun.file(pairsPath).json().catch(() => {
    console.error(`cannot read ${pairsPath}. Run: bun measure-mrr.ts --min-queries 60 --compare --dump-pairs corpus/pairs.json`);
    process.exit(1);
  });
  if (!pairs.length || pairs[0]!.rankRg === undefined) {
    console.error(`${pairsPath} has no diagnostic fields; re-dump with the current harness.`);
    process.exit(1);
  }

  const t = taxonomy(pairs);
  await Bun.write("evidence/error-taxonomy.json", JSON.stringify(t, null, 2));

  const labeled = population(pairs).map((p) => ({ ...p, category: categorize(p) }));
  await Bun.write("corpus/miss-labels.json", JSON.stringify(labeled, null, 2));
  await Bun.write("corpus/inspection-sample.json", JSON.stringify(inspectionSample(pairs), null, 2));

  console.error(`population ${t.population} (${t.misses} misses, ${t.regressions} regressions) of ${t.pairsTotal} pairs`);
  for (const c of CATEGORIES) {
    const n = t.categories[c];
    if (n) console.error(`  ${c.padEnd(24)} ${String(n).padStart(5)}  (${((n / t.population) * 100).toFixed(1)}%)`);
  }
  const exts = Object.entries(t.langGapExtensions).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (exts.length) console.error(`  lang-gap extensions: ${exts.map(([e, n]) => `${e}:${n}`).join("  ")}`);
  console.error(`\nwrote evidence/error-taxonomy.json (counts only, publishable)`);
  console.error(`wrote corpus/miss-labels.json and corpus/inspection-sample.json (private, never commit)`);
}
