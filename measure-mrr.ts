#!/usr/bin/env bun
/**
 * measure-mrr — score a repo by how far an agent reads before reaching the answer.
 *
 * This is Mean Reciprocal Rank, the standard information-retrieval metric, applied backwards.
 * CodeSearchNet and its successors hold the corpus fixed and vary the retriever, to grade search
 * engines. Here the retriever is fixed — ripgrep, because that is what coding agents actually run —
 * and the corpus varies, to grade the repository.
 *
 * Ground truth comes from `harvest-queries.ts`: real searches from real agent sessions, paired
 * with the files the agent opened next. RR = 1/rank of the first result line in an answering file;
 * MRR is the mean over a repo's queries. 1.0 means the answer is always the first thing you see.
 *
 * `--sort path` is mandatory, not cosmetic: ripgrep's default output order is NONDETERMINISTIC
 * under parallel traversal (verified: three identical runs, three different orderings), so an
 * unsorted rank metric would not be reproducible — and an agent genuinely gets a different first
 * page on each run.
 *
 * Usage:
 *   bun measure-mrr.ts [--corpus corpus/queries.json] [--min-queries N] [--json]
 *   bun measure-mrr.ts --min-queries 60 --compare [--json]   # paired A/B with bootstrap intervals
 *   bun measure-mrr.ts --selftest
 */

import { existsSync } from "node:fs";
import { basename } from "node:path";
import { privateCorpusPath, writePrivateCorpus } from "./harvest-queries.ts";

/** Beyond this many results an answer is unreachable by scrolling grep output; RR counts as 0. */
const RANK_CAP = 1000;
/** Cutoff for nDCG and the top-k rate. Ten is one page of grep output. */
const NDCG_K = 10;
/**
 * Lines read per query before the first page of DISTINCT FILES is abandoned as unfillable.
 *
 * This exists because `RANK_CAP` cannot do the job for both metrics. MRR is defined over result
 * LINES and stops at a thousand of them; nDCG is defined over distinct FILES. Sharing one cap
 * meant a query whose first file carried a thousand matching lines ended the scan with exactly one
 * file collected, and an answer sitting at file-rank 2 was scored nDCG 0 — a metric reading zero
 * for a retrieval that put the answer second. Caught in review before any number was published.
 *
 * Ten times the rank cap, and truncation is counted and reported rather than absorbed.
 */
const LINE_BUDGET = 10_000;

export type CorpusEntry = { query: string; repo: string; answeredBy: Record<string, number>; searches: number };

export type RepoScore = {
  repo: string;
  path: string;
  queries: number;
  judgedFrom: number;
  invisible: number;
  mrr: number;
  ndcg10: number;
  ndcgTruncated: number;
  medianRank: number;
  answerInTop10: number;
  unreachable: number;
  worst: { query: string; rank: number | null; results: number }[];
};

/**
 * Rank of the first result line that lands in a file the agent actually opened.
 * Streams and stops early: the answer is usually near the front, and reading every result for
 * every query would dominate the runtime.
 */
/** Which retriever is under test. `rg` is the baseline; `hay` is the ranked one. */
export type Retriever = "rg" | "hay";
const HAY_BIN = new URL("./hay/target/release/hay", import.meta.url).pathname;
let RETRIEVER: Retriever = "rg";
let HAY_FLAGS: string[] = [];

/**
 * Pure by design: the retriever is a parameter, not the module global. `pairRepo` used to flip
 * `RETRIEVER` between two awaited calls, which worked only because nothing ran concurrently —
 * and any second harness importing this file would have had to copy the whole parity block below
 * instead of calling it. Both harnesses (`measure-mrr.ts`, `swe-explore.ts`) now feed both
 * retrievers through this one function, which is what invariant 6 is about.
 */
export function retrieverArgv(retriever: Retriever, query: string): string[] {
  if (retriever === "hay") {
    // -m 0 = unlimited, so rank can exceed hay's default page size during evaluation.
    // `-e query`, not a bare positional: a harvested query beginning with `-` would otherwise be
    // parsed as a flag, and hay would exit 2 with no output while the rg branch — which has always
    // used `-e` — measured it fine. That asymmetry biases the A/B against hay. No such query
    // exists in the current 2,508-query corpus, so no published number is affected, but the two
    // retrievers must be fed identically or the comparison is not one.
    //
    // `--hidden` for the same reason, and this one DID affect a published number. ripgrep was
    // given `--hidden` in this harness because instrument error #6 showed that skipping hidden
    // directories hid `.scratch/`; hay never got the matching flag, so for four versions the two
    // retrievers walked different file sets. Reproduced directly: with a definition in a hidden
    // directory, `rg --hidden` returns it and `hay` returns nothing. Every other filtering flag
    // below already has an exact counterpart inside hay — `--no-ignore-dot` matches `.ignore(false)`,
    // `--no-ignore-global` matches `.git_global(false)`, `--no-ignore-exclude` matches
    // `.git_exclude(false)`, `-g '!.git/'` matches hay's built-in VCS exclusion — so `--hidden`
    // was the single remaining asymmetry, and it is the one this file's own comment forbids.
    return [HAY_BIN, "--hidden", "-i", "-F", "-n", "-m", "0", ...HAY_FLAGS, "-e", query, "."];
  }
  return ["rg", "--no-config", "--no-ignore-dot", "--no-ignore-global", "--no-ignore-exclude",
          "--hidden", "-g", "!.git/", "--sort", "path", "-i", "-F", "-n", "-e", query, "."];
}

/**
 * Binary-relevance nDCG at `NDCG_K`, over DISTINCT FILES in the order the retriever first shows
 * them.
 *
 * Why this exists beside MRR. The judgments here are not single-positive: the median query has two
 * answer files and the mean is 2.27, because an agent typically opens several files after one
 * search. MRR looks only at the first of them and is blind to whether a retriever put the other
 * two on the first page or on the fortieth. That is exactly the criticism levelled at code-search
 * benchmarks whose relevance is one-document-per-query, where nDCG and MRR collapse into the same
 * hit-or-miss signal — here they genuinely do not, so both are reported.
 *
 * Files, not lines, are the unit: relevance was judged per file, and forty matching lines in one
 * answer file are one document an agent opens once. IDCG is taken over min(k, |answers|), so a
 * query whose answer set is larger than the cutoff is not scored against an unreachable ideal.
 *
 * One honest caveat: an answer file that neither retriever can see (gitignored, say) inflates IDCG
 * and deflates nDCG for both. The design is paired, so the DIFFERENCE is unaffected; only the
 * absolute level is pessimistic.
 */
export function ndcgAt(filesInOrder: string[], answers: Set<string>, k: number): number {
  let dcg = 0;
  filesInOrder.slice(0, k).forEach((f, i) => {
    if (answers.has(f)) dcg += 1 / Math.log2(i + 2);
  });
  let idcg = 0;
  for (let i = 0; i < Math.min(k, answers.size); i++) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * Consumes a retriever's output lines and holds both metrics' state.
 *
 * A class rather than a loop body so it can be exercised synchronously against hand-built input.
 * The two metrics have DIFFERENT stopping conditions and conflating them produced a defect that a
 * process-spawning function could not have been unit-tested for; making the state machine pure is
 * what stops that recurring.
 */
export class ResultScan {
  rank: number | null = null;
  scanned = 0;
  /** Distinct file paths in the order the retriever first showed them, capped at `k`. */
  readonly files: string[] = [];
  private seen = new Set<string>();

  constructor(
    private answers: Set<string>,
    private k = NDCG_K,
    private rankCap = RANK_CAP,
    private lineBudget = LINE_BUDGET,
  ) {}

  /** Push one output line. Returns false once neither metric can change, so the caller can stop. */
  push(line: string): boolean {
    if (!line) return true;
    this.scanned++;
    const path = line.slice(0, line.indexOf(":")).replace(/^\.\//, "");
    if (this.files.length < this.k && !this.seen.has(path)) {
      this.seen.add(path);
      this.files.push(path);
    }
    // `scanned <= rankCap` is load-bearing now that the scan runs past the rank cap to finish the
    // nDCG page. Without it an answer at line 1,201 would be recorded as rank 1,201 and score
    // RR 0.0008, where the cap's whole meaning is that it counts as unreachable — silently
    // inflating MRR for exactly the noisiest queries.
    if (this.rank === null && this.scanned <= this.rankCap && this.answers.has(path)) {
      this.rank = this.scanned;
    }
    const rankSettled = this.rank !== null || this.scanned >= this.rankCap;
    const pageSettled = this.files.length >= this.k || this.scanned >= this.lineBudget;
    return !(rankSettled && pageSettled);
  }

  /**
   * False only when the scan gave up on the first page with fewer than `k` files still to find.
   * A stream that simply ended is complete: those are all the files there are.
   */
  get pageComplete(): boolean {
    return this.files.length >= this.k || this.scanned < this.lineBudget;
  }

  get ndcg(): number {
    return ndcgAt(this.files, this.answers, this.k);
  }
}

export async function rankOfAnswer(
  repo: string,
  query: string,
  answers: Set<string>,
  retriever: Retriever = RETRIEVER,
): Promise<{ rank: number | null; scanned: number; ndcg: number; pageComplete: boolean; files: string[]; truncated: boolean }> {
  // hay's stderr carries the candidate-cap warning — "N matches; ranked the 20000
  // strongest-by-prescore candidates" (format pinned by a contract test in hay/tests/cli.rs). On
  // a query that hits the cap, hay ranked only the strongest-prescore candidates and the answer
  // may have been dropped
  // BEFORE scoring, which is a different failure from "ranked it badly". Invariant 7: a measure's
  // truncations are counted, never absorbed. hay prints it before any stdout, so reading the
  // stream after the kill cannot lose it.
  const proc = Bun.spawn(retrieverArgv(retriever, query), {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  const errText = new Response(proc.stderr).text().catch(() => "");
  const dec = new TextDecoder();
  let buf = "";
  let stoppedEarly = false;
  const scan = new ResultScan(answers);
  outer: for await (const chunk of proc.stdout as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!scan.push(line)) { stoppedEarly = true; break outer; }
    }
  }
  if (stoppedEarly) proc.kill();
  const code = await proc.exited;
  const diagnostic = await errText;
  assertCompleteExit(code, stoppedEarly, retriever, diagnostic);
  const truncated = /ranked the \d+ strongest/.test(diagnostic);
  return { rank: scan.rank, scanned: scan.scanned, ndcg: scan.ndcg, pageComplete: scan.pageComplete, files: scan.files, truncated };
}

/** A deliberate early stop is part of rank measurement; a natural incomplete exit is not. */
export function assertCompleteExit(code: number, stoppedEarly: boolean, purpose: string, diagnostic = ""): void {
  if (!stoppedEarly && code >= 2) throw new Error(
    `${purpose} failed (exit ${code}): ${diagnostic.trim().slice(0, 300) || "no diagnostic"}`,
  );
}

/**
 * Option values must never be mistaken for positionals. Scanning with `argv.includes(...)` and
 * `argv.find(...)` has now produced this bug three times in this project — most recently
 * `--retriever hay`, where `hay` was taken as a repository path because a `hay/` directory exists.
 */
export function parseArgv(argv: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const takesValue = new Set(["--corpus", "--min-queries", "--retriever", "--ablate", "--dump-pairs"]);
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) { positional.push(a); continue; }
    if (takesValue.has(a)) {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      flags[a] = v;
    } else flags[a] = true;
  }
  return { positional, flags };
}

/**
 * The conventional median: the average of the two middle values on an even-length sample, not the
 * upper of the two. It matters here rather than being pedantry — the pre-registered ship gate is a
 * MEDIAN over an even number of repositories, so the upper-middle convention quietly reported the
 * more favourable of two candidate values on exactly the number the gate is checked against.
 */
export const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

async function mapPool<T, R>(xs: T[], limit: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(xs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, xs.length)) }, async () => {
    for (let i = next++; i < xs.length; i = next++) out[i] = await f(xs[i]!);
  }));
  return out;
}

/**
 * Keep only answer files that actually contain the query.
 *
 * The raw behavioural signal is too loose: measured on one repo, 57% of files an agent opened
 * after a search did not contain the searched term at all, so they could never appear in that
 * query's results and were silently scored as "unreachable". A file that does not contain the
 * term cannot have been reached by matching it — whatever led the agent there, it was not this
 * search. Queries left with no valid answer have no usable judgment and are dropped, not scored.
 */
async function validAnswers(repo: string, e: CorpusEntry): Promise<Set<string>> {
  const ok = new Set<string>();
  const needle = e.query.toLowerCase();
  for (const rel of Object.keys(e.answeredBy)) {
    const f = Bun.file(`${repo}/${rel}`);
    if (!(await f.exists())) continue;
    const text = await f.text().catch(() => "");
    if (text.toLowerCase().includes(needle)) ok.add(rel);
  }
  return ok;
}

export async function scoreRepo(repo: string, entries: CorpusEntry[], label?: string): Promise<RepoScore> {
  const judged = (await mapPool(entries, 8, async (e) => ({ e, answers: await validAnswers(repo, e) })))
    .filter((x) => x.answers.size > 0);
  const raw = await mapPool(judged, 8, async ({ e, answers }) => {
    const { rank, scanned, ndcg, pageComplete } = await rankOfAnswer(repo, e.query, answers);
    return { query: e.query, rank, results: scanned, ndcg, pageComplete };
  });
  // A query ripgrep answers with zero results cannot be scored on rank. It happens when the
  // answer file is gitignored: `validAnswers` reads files directly, ripgrep does not see them.
  // That is a disagreement between corpus and instrument, not a property of the repository, so
  // these are excluded rather than scored as rank-infinity.
  const invisible = raw.filter((r) => r.results === 0).length;
  const results = raw.filter((r) => r.results > 0);

  const ranks = results.filter((r) => r.rank !== null).map((r) => r.rank!);
  const rr = results.map((r) => (r.rank ? 1 / r.rank : 0));
  return {
    repo: label ?? basename(repo),
    path: repo,
    queries: results.length,
    judgedFrom: entries.length,
    invisible,
    mrr: rr.reduce((a, b) => a + b, 0) / (rr.length || 1),
    ndcg10: mean(results.map((r) => r.ndcg)),
    // Never absorbed into the mean: a first page that could not be filled within the line budget
    // is a limit of the measurement, and it is reported rather than left to look like a low score.
    ndcgTruncated: results.filter((r) => !r.pageComplete).length,
    medianRank: median(ranks),
    answerInTop10: results.filter((r) => r.rank !== null && r.rank <= 10).length / (results.length || 1),
    unreachable: results.filter((r) => r.rank === null).length / (results.length || 1),
    worst: results
      .filter((r) => r.rank === null || r.rank > 20)
      .sort((a, b) => (b.rank ?? Infinity) - (a.rank ?? Infinity))
      .slice(0, 15)
      .map(({ query, rank, results }) => ({ query, rank, results })),
  };
}

// ── paired comparison ─────────────────────────────────────────────────────────
//
// The A/B between retrievers was originally reported as "median MRR 0.265 -> 0.391, +47%,
// improved in 12 of 12". Three separate things are wrong with that sentence, and this project
// exists to not make exactly this kind of claim:
//
//   * it is a relative improvement of an arithmetic mean, which Fuhr (SIGIR Forum 2018) lists
//     among the common mistakes in IR evaluation;
//   * it has no interval and no test, so the effect size is unstated — Fuhr's mistake #7;
//   * it compares twelve repo-level medians when the underlying design is PAIRED at the query
//     level, with thousands of observations. Comparing marginals throws that power away.
//
// Smucker et al. (CIKM 2007) compared the tests IR actually uses and found the randomization,
// bootstrap and t tests behave alike, while the Wilcoxon and sign tests detect poorly and produce
// false detections; they recommend discontinuing those two. So: paired bootstrap over per-query
// reciprocal ranks, absolute difference, 95% percentile interval, fixed seed.

/**
 * `repo` is the FULL repository path, not its basename: two checkouts whose final directory name
 * matches — worktrees, or the same project cloned twice — would otherwise resample as one cluster
 * and undercount the repositories. `label` is for display only.
 */
export type Pair = {
  repo: string; label: string; query: string;
  rrRg: number; rrHay: number;
  top10Rg: number; top10Hay: number;
  ndcgRg: number; ndcgHay: number;
  /** False when either retriever's first page could not be filled inside the line budget. */
  pageComplete: boolean;
  // Diagnostics for `--dump-pairs`, optional so aggregate-only consumers and the selftest's
  // hand-built pairs need not carry them. `resultsX === 0` for exactly one retriever means the
  // answer was invisible to it — an instrument disagreement, not a ranking failure, and the
  // error taxonomy must separate the two.
  rankRg?: number | null; rankHay?: number | null;
  filesRg?: string[]; filesHay?: string[];
  resultsRg?: number; resultsHay?: number;
  answers?: string[];
  /** hay hit its candidate cap on this query: the answer may have been dropped before scoring. */
  hayTruncated?: boolean;
};

/**
 * Seeded PRNG. `Math.random` cannot be seeded, and an unreproducible interval is not evidence.
 *
 * NOT cryptographically secure and must never be used for a token, id, nonce or key — it is a
 * 32-bit state generator chosen purely so a bootstrap replicates exactly. For anything security
 * sensitive use `crypto.randomUUID()` or `crypto.getRandomValues()`.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export type Interval = {
  mean: number; lo: number; hi: number; p: number;
  /** Number of individual observations contributing to the estimand. */
  n: number;
  /** Number of independently resampled units (queries or repository clusters). */
  clusters: number;
};

/**
 * Percentile bootstrap over paired differences.
 *
 * `groups` is the resampling unit: one array per unit, holding that unit's per-query differences.
 * Pass one group per query for a query-level interval, or one group per repository for a cluster
 * bootstrap that respects the fact that queries inside a repo share a corpus and are not
 * independent. Both are worth reporting — they answer different questions, and if they disagree
 * the honest summary is the conservative one.
 */
export function bootstrapCI(groups: number[][], opts: { replicates?: number; seed?: number } = {}): Interval {
  const replicates = opts.replicates ?? 10_000;
  const rand = mulberry32(opts.seed ?? 20260819);
  const flat = groups.flat();
  const observed = mean(flat);
  if (groups.length === 0) return { mean: 0, lo: 0, hi: 0, p: 1, n: 0, clusters: 0 };

  const means: number[] = [];
  for (let b = 0; b < replicates; b++) {
    let sum = 0, count = 0;
    for (let i = 0; i < groups.length; i++) {
      const g = groups[Math.floor(rand() * groups.length)]!;
      for (const d of g) { sum += d; count++; }
    }
    means.push(count ? sum / count : 0);
  }
  means.sort((a, b) => a - b);
  const at = (q: number) => means[Math.min(means.length - 1, Math.max(0, Math.floor(q * means.length)))]!;
  // Two-sided bootstrap p: how often a replicate lands on the other side of zero, doubled.
  //
  // (crossings + 1) / (replicates + 1), not crossings / replicates. A finite simulation cannot
  // establish that a probability is exactly zero; with no crossings the naive formula prints
  // "p = 0.0000", which claims a precision 10,000 replicates do not have — Fuhr's second common
  // mistake, overstating the precision of a result. The add-one correction is the standard fix
  // and bounds the answer at the simulation's own resolution.
  const crossings = means.filter((m) => (observed >= 0 ? m <= 0 : m >= 0)).length;
  const p = Math.min(1, (2 * (crossings + 1)) / (replicates + 1));
  return { mean: observed, lo: at(0.025), hi: at(0.975), p, n: flat.length, clusters: groups.length };
}

/**
 * Fisher's paired randomization (permutation) test — the reference standard, now actually run.
 *
 * The comment above cites Smucker et al. (CIKM 2007) to justify a bootstrap. What that paper
 * actually does is treat the RANDOMIZATION test as the reference and validate the bootstrap and
 * the t-test against it; citing it while shipping only the approximation it was used to check is
 * having the argument both ways. Their follow-up (SIGIR 2009) sharpens the point: at smaller
 * sample sizes the bootstrap is systematically biased toward smaller p-values than the t-test, so
 * the one number most likely to be flattering is the one this project was reporting alone.
 *
 * Under the null hypothesis that the two retrievers are the same system, which of them produced
 * the larger score on a given query is arbitrary, so the SIGN of each paired difference is
 * exchangeable. Flip signs at random, recompute the mean, and count how often the shuffled data
 * reaches the observed effect.
 *
 * `groups` has the same meaning as in `bootstrapCI`, and the sign is flipped per GROUP: one group
 * per query gives the query-level test, one per repository gives the clustered test that respects
 * queries inside a repo not being independent.
 *
 * `(atLeast + 1) / (replicates + 1)` for the same reason the bootstrap uses it — a finite
 * simulation cannot report an exact zero.
 */
export function randomizationP(groups: number[][], opts: { replicates?: number; seed?: number } = {}): number {
  const replicates = opts.replicates ?? 10_000;
  const rand = mulberry32(opts.seed ?? 20260820);
  const flat = groups.flat();
  if (flat.length === 0) return 1;
  const observed = Math.abs(mean(flat));
  let atLeast = 0;
  for (let b = 0; b < replicates; b++) {
    let sum = 0;
    for (const g of groups) {
      const sign = rand() < 0.5 ? -1 : 1;
      for (const d of g) sum += sign * d;
    }
    // `>=`, not `>`: the observed assignment is one of the permutations and must be counted.
    if (Math.abs(sum / flat.length) >= observed - 1e-12) atLeast++;
  }
  return Math.min(1, (atLeast + 1) / (replicates + 1));
}

/**
 * A repo score with the absolute filesystem path removed, for anything that leaves memory.
 *
 * `RepoScore.path` is the full checkout path — `/Users/<name>/dev/<client>/<project>` — and the
 * `--json` payload is written straight into files that live next to a committed `evidence/`
 * directory. Repository identity is what this project's fourth invariant forbids publishing, and
 * serialising the whole object made publishing it the default rather than a mistake you had to
 * make. `repo` (a basename or an explicit `=label`) stays, because a report has to name its rows.
 *
 * The queries themselves stay too — they are the entire point of the within-repo diagnostic — so
 * the caller is warned on stderr instead of having the feature removed.
 */
export function publishable(s: RepoScore): Omit<RepoScore, "path"> {
  const { path: _path, ...rest } = s;
  return rest;
}

/**
 * The pre-registered ship gate, computed AS WRITTEN.
 *
 * DESIGN-hay.md fixed the gate as "median MRR across the 12 repos >= 0.50, answer in top 10
 * >= 80%" — and until this function existed, no code computed that statistic. Every number ever
 * judged against the gate was the paired MEAN over all queries, a different quantity. A project
 * about not publishing unvalidated numbers was grading its own pre-registration against a
 * statistic it never calculated. The paired means remain the headline effect estimates; this is
 * the gate check, reported beside them. The thresholds live in DESIGN-hay.md and do not move.
 */
export type GateStats = {
  repos: number;
  medianRepoMrrRg: number; medianRepoMrrHay: number;
  medianRepoTop10Rg: number; medianRepoTop10Hay: number;
  /** Repos where hay's mean RR is below rg's — the DESIGN do-not-ship rule, count only. */
  reposWorse: number;
  pass: boolean;
};

export function gateStats(pairs: Pair[]): GateStats {
  const byRepo = new Map<string, Pair[]>();
  for (const p of pairs) byRepo.set(p.repo, [...(byRepo.get(p.repo) ?? []), p]);
  const perRepo = [...byRepo.values()];
  const per = (f: (p: Pair) => number) => perRepo.map((ps) => mean(ps.map(f)));
  const mrrRg = per((p) => p.rrRg);
  const mrrHay = per((p) => p.rrHay);
  const medianRepoMrrHay = median(mrrHay);
  const medianRepoTop10Hay = median(per((p) => p.top10Hay));
  return {
    repos: perRepo.length,
    medianRepoMrrRg: median(mrrRg),
    medianRepoMrrHay,
    medianRepoTop10Rg: median(per((p) => p.top10Rg)),
    medianRepoTop10Hay,
    reposWorse: mrrHay.filter((h, i) => h < mrrRg[i]!).length,
    pass: medianRepoMrrHay >= 0.5 && medianRepoTop10Hay >= 0.8,
  };
}

/** Use the same canonical boundary and symlink-aware writer as transcript harvesting. */
export function isUnderCorpus(p: string, cwd = process.cwd()): boolean {
  try {
    privateCorpusPath(p, cwd);
    return true;
  } catch {
    return false;
  }
}

/** Group paired differences by repository, for the cluster bootstrap. */
export function byCluster(pairs: Pair[], diff: (p: Pair) => number): number[][] {
  const m = new Map<string, number[]>();
  for (const p of pairs) m.set(p.repo, [...(m.get(p.repo) ?? []), diff(p)]);
  return [...m.values()];
}

/** Score one repo under both retrievers, on the identical judged query set. */
export async function pairRepo(repo: string, entries: CorpusEntry[], label?: string): Promise<Pair[]> {
  const judged = (await mapPool(entries, 8, async (e) => ({ e, answers: await validAnswers(repo, e) })))
    .filter((x) => x.answers.size > 0);
  const name = label ?? basename(repo);
  const out: Pair[] = [];
  for (const { e, answers } of judged) {
    const a = await rankOfAnswer(repo, e.query, answers, "rg");
    const b = await rankOfAnswer(repo, e.query, answers, "hay");
    // Same exclusion as scoreRepo: a query neither retriever can see is a corpus/instrument
    // disagreement, not a property of either retriever.
    if (a.scanned === 0 && b.scanned === 0) continue;
    const rr = (rank: number | null) => (rank ? 1 / rank : 0);
    const top10 = (rank: number | null) => (rank !== null && rank <= 10 ? 1 : 0);
    out.push({
      repo, label: name, query: e.query,
      rrRg: rr(a.rank), rrHay: rr(b.rank),
      top10Rg: top10(a.rank), top10Hay: top10(b.rank),
      ndcgRg: a.ndcg, ndcgHay: b.ndcg,
      pageComplete: a.pageComplete && b.pageComplete,
      rankRg: a.rank, rankHay: b.rank,
      filesRg: a.files, filesHay: b.files,
      resultsRg: a.scanned, resultsHay: b.scanned,
      answers: [...answers],
      hayTruncated: b.truncated,
    });
  }
  return out;
}

// ── main ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = Bun.argv.slice(2);

  const { positional, flags } = parseArgv(argv);

  if (flags["--selftest"]) {
    const eq = (a: unknown, b: unknown, m: string) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    };
    eq(median([3, 1, 2]), 2, "median odd");
    eq(median([]), 0, "median empty");
    // The even case is the one the ship gate is evaluated on, and the upper-middle convention
    // reported 4 here where the median is 3.
    eq(median([1, 2, 4, 8]), 3, "median even averages the two middle values");
    eq(median([2, 1]), 1.5, "median of a pair");
    // RR is the whole metric; a wrong reciprocal silently rescales every repo.
    const rr = (rank: number | null) => (rank ? 1 / rank : 0);
    eq(rr(1), 1, "first result is a perfect score");
    eq(rr(4), 0.25, "fourth result");
    eq(rr(null), 0, "unreachable scores zero");
    // The bug that has now appeared three times: an option's value read as a positional.
    eq(parseArgv(["--retriever", "hay", "/repo"]), { positional: ["/repo"], flags: { "--retriever": "hay" } }, "option value is not positional");
    eq(parseArgv(["--json"]).flags, { "--json": true }, "boolean flag");
    let threw = false;
    try { parseArgv(["--retriever"]); } catch { threw = true; }
    if (!threw) throw new Error("missing option value must throw");

    // A natural incomplete child exit invalidates evidence; our own early stop remains valid.
    let exitThrew = false;
    try { assertCompleteExit(2, false, "fixture", "partial failure"); } catch { exitThrew = true; }
    if (!exitThrew) throw new Error("natural exit 2 must fail closed");
    assertCompleteExit(2, true, "fixture", "deliberately stopped");
    assertCompleteExit(1, false, "fixture", "no matches");

    // The bootstrap is an instrument, and every instrument in this project has been wrong at
    // least once. Check it against cases whose answer is known before trusting an interval.
    const seeded = mulberry32(1);
    const seededAgain = mulberry32(1);
    eq(seeded(), seededAgain(), "same seed must give the same stream");
    eq(mean([1, 2, 3]), 2, "mean");
    // A constant positive effect: the interval must sit on it and exclude zero.
    const constant = bootstrapCI(Array.from({ length: 200 }, () => [0.1]), { replicates: 500 });
    if (!(constant.lo > 0.09 && constant.hi < 0.11)) throw new Error(`constant effect CI wrong: ${JSON.stringify(constant)}`);
    if (constant.p > 0.01) throw new Error(`constant effect should be significant, p=${constant.p}`);
    eq(constant.n, 200, "bootstrap reports observations");
    eq(constant.clusters, 200, "query bootstrap reports resampling units");
    // No effect: symmetric around zero, so the interval must straddle it and p must be large.
    const none = bootstrapCI(Array.from({ length: 400 }, (_, i) => [i % 2 ? 0.5 : -0.5]), { replicates: 500 });
    if (!(none.lo < 0 && none.hi > 0)) throw new Error(`null effect CI must straddle zero: ${JSON.stringify(none)}`);
    if (none.p < 0.5) throw new Error(`null effect should not be significant, p=${none.p}`);
    // Clustering must be preserved: two repos, one per group.
    const mk = (repo: string, label: string, query: string, rrHay: number, rrRg = 0) =>
      ({ repo, label, query, rrRg, rrHay, top10Rg: 0, top10Hay: 1, ndcgRg: 0, ndcgHay: rrHay, pageComplete: true });
    const clusters = byCluster(
      [mk("/x/a", "a", "q", 1), mk("/x/a", "a", "r", 1), mk("/x/b", "b", "s", 1)],
      (p) => p.rrHay - p.rrRg,
    );
    eq(clusters.length, 2, "one cluster per repo");
    eq(clusters.map((c) => c.length).sort(), [1, 2], "queries stay inside their repo");
    const clusteredInterval = bootstrapCI(clusters, { replicates: 20 });
    eq(clusteredInterval.n, 3, "cluster interval reports all observations");
    eq(clusteredInterval.clusters, 2, "cluster interval reports repositories separately");
    // Two different repositories that share a basename must not collapse into one cluster.
    const collide = byCluster([mk("/x/core", "core", "q", 1), mk("/y/core", "core", "r", 1)], (p) => p.rrHay - p.rrRg);
    eq(collide.length, 2, "same basename, different paths, must stay separate clusters");
    // A finite simulation cannot report an exact zero probability.
    if (constant.p <= 0) throw new Error("bootstrap p must be bounded by the replicate count, not 0");

    // nDCG@10, against values computed by hand. A metric nobody has checked arithmetically is how
    // this project got its previous nine instrument bugs.
    const close = (a: number, b: number, tol: number, m: string) => {
      if (!(Math.abs(a - b) <= tol)) throw new Error(`${m}: ${a} != ${b} (tol ${tol})`);
    };
    const ans2 = new Set(["a", "b"]);
    close(ndcgAt(["a", "b", "c"], ans2, 10), 1, 1e-12, "both answers first is a perfect nDCG");
    close(ndcgAt(["c", "d", "e"], ans2, 10), 0, 1e-12, "no answer on the page scores zero");
    // One answer at rank 1, the other at rank 3: DCG = 1/log2(2) + 1/log2(4) = 1.5;
    // IDCG = 1/log2(2) + 1/log2(3) = 1.6309. Ratio 0.9197.
    close(ndcgAt(["a", "z", "b"], ans2, 10), 1.5 / (1 + 1 / Math.log2(3)), 1e-12, "graded by position");
    // Ranking an answer LOWER must score strictly worse — the property the metric exists for.
    if (!(ndcgAt(["a", "z", "b"], ans2, 10) > ndcgAt(["z", "a", "b"], ans2, 10)))
      throw new Error("nDCG must reward the earlier placement");
    // IDCG is capped at k, so a query with more answers than slots is not scored against an
    // ideal it could never reach.
    const many = new Set(["a", "b", "c", "d"]);
    close(ndcgAt(["a", "b"], many, 2), 1, 1e-12, "IDCG is capped at the cutoff");
    close(ndcgAt(["a", "b", "c"], new Set<string>(), 10), 0, 1e-12, "no judgments, no score");

    // The scan's two stopping conditions. Review caught these sharing one cap: a query whose first
    // file carries a thousand matching lines ended the scan holding ONE file, so an answer at
    // file-rank 2 scored nDCG 0. The metrics are counted in different units and must stop
    // independently.
    {
      const answers = new Set(["answer.ts"]);
      // 1,200 lines of one irrelevant file, then the answer. Under a shared cap the loop stopped
      // at line 1,000 with one file collected and reported nDCG 0.
      const scan = new ResultScan(answers, 3, 1000, 10_000);
      for (let i = 1; i <= 1200; i++) scan.push(`noise.ts:${i}:x`);
      eq(scan.rank, null, "nothing has answered yet");
      scan.push("answer.ts:1:x");
      // Two things at once, and they pull in opposite directions: the answer arrived past the rank
      // cap so RR must stay zero, while nDCG must still credit it at file-rank 2. Continuing the
      // scan for the page is what makes the first assertion possible to get wrong.
      eq(scan.rank, null, "an answer past the rank cap is unreachable, not rank 1201");
      close(scan.ndcg, 1 / Math.log2(3), 1e-12, "the answer still scores at file-rank 2");
      if (!scan.pageComplete) throw new Error("the page is fillable inside the line budget");
    }
    {
      // Both settled: rank found and the page full, so the caller is told to stop.
      const scan = new ResultScan(new Set(["a"]), 2, 1000, 10_000);
      if (!scan.push("a:1:x")) throw new Error("one file is not a full page");
      if (scan.push("b:1:x")) throw new Error("rank found and page full must stop the scan");
      eq(scan.rank, 1, "rank is the LINE, not the file");
      eq(scan.files, ["a", "b"], "distinct files in first-appearance order");
    }
    {
      // Genuinely unfillable inside the budget: truncation must be visible, not silent.
      const scan = new ResultScan(new Set(["a"]), 10, 5, 20);
      for (let i = 1; i <= 25; i++) scan.push(`only.ts:${i}:x`);
      if (scan.pageComplete) throw new Error("an unfillable page must report itself truncated");
      eq(scan.files, ["only.ts"], "only the one file was ever visible");
    }
    {
      // A stream that simply ends is complete, however few files it held.
      const scan = new ResultScan(new Set(["a"]), 10, 1000, 10_000);
      scan.push("a:1:x");
      scan.push("b:1:x");
      if (!scan.pageComplete) throw new Error("a short result list is complete, not truncated");
    }

    // The gate statistic, against hand arithmetic. It is a median of PER-REPO means — computing
    // anything else here is exactly the inconsistency this function exists to end.
    {
      const g = gateStats([
        mk("/x/a", "a", "q1", 1.0),          // repo a: mean RR (1.0 + 0.0)/2 = 0.5
        mk("/x/a", "a", "q2", 0.0),
        mk("/x/b", "b", "q1", 1.0),          // repo b: 1.0
        mk("/x/c", "c", "q1", 0.0, 0.5),     // repo c: hay 0.0, rg 0.5 — worse than rg
      ]);
      eq(g.repos, 3, "one gate row per repo");
      eq(g.medianRepoMrrHay, 0.5, "median of per-repo means [0.5, 1, 0]");
      eq(g.medianRepoMrrRg, 0, "rg median of [0, 0, 0.5]");
      eq(g.medianRepoTop10Hay, 1, "top-10 median");
      eq(g.reposWorse, 1, "exactly one repo has hay below rg");
      eq(g.pass, true, ">= is the gate's own comparison: 0.50 and 1.00 pass");
      // An even repo count must average the two middle values — the convention `median` exists for.
      const even = gateStats([mk("/x/a", "a", "q", 0.2), mk("/x/b", "b", "q", 0.4), mk("/x/c", "c", "q", 0.8), mk("/x/d", "d", "q", 1.0)]);
      close(even.medianRepoMrrHay, 0.6, 1e-12, "even repo count averages the middle pair");
      eq(gateStats([]).repos, 0, "no pairs, no repos, no crash");
      eq(gateStats([]).pass, false, "an empty evaluation cannot pass the gate");
    }

    // The dump flag takes a value; reading it as a boolean would swallow the path as a positional.
    eq(parseArgv(["--dump-pairs", "corpus/pairs.json", "--compare"]).flags["--dump-pairs"], "corpus/pairs.json", "--dump-pairs takes a path");
    // The privacy boundary must hold against traversal, not just against honest paths.
    eq(isUnderCorpus("corpus/pairs.json"), true, "an honest corpus path is allowed");
    eq(isUnderCorpus("corpus/../evidence/pairs.json"), false, "traversal out of corpus/ is not");
    eq(isUnderCorpus("evidence/pairs.json"), false, "a path outside corpus/ is not");
    eq(isUnderCorpus("corpusx/pairs.json"), false, "a sibling directory sharing the prefix is not");

    // The randomization test, against a case with an exact answer. Three paired differences all
    // of the same magnitude have 2^3 = 8 equally likely sign assignments, and exactly two of them
    // (all +, all -) reach |mean| = 1, so the exact two-sided p is 2/8 = 0.25.
    close(randomizationP([[1], [1], [1]], { replicates: 20_000 }), 0.25, 0.02, "exact permutation p");
    // A large constant effect must be detected; symmetric noise must not be.
    if (randomizationP(Array.from({ length: 200 }, () => [0.1])) > 0.01)
      throw new Error("randomization test missed a constant effect");
    const noise = randomizationP(Array.from({ length: 400 }, (_, i) => [i % 2 ? 0.5 : -0.5]));
    if (noise < 0.5) throw new Error(`randomization test found an effect in pure noise: p=${noise}`);
    if (randomizationP([]) !== 1) throw new Error("no observations cannot be significant");
    // The absolute checkout path must not survive serialisation — it names a private repository,
    // and the payload is written next to a committed evidence directory.
    {
      const scored: RepoScore = {
        repo: "label", path: "/Users/someone/dev/client/project", queries: 1, judgedFrom: 1,
        invisible: 0, mrr: 1, ndcg10: 1, ndcgTruncated: 0, medianRank: 1, answerInTop10: 1,
        unreachable: 0, worst: [],
      };
      if ("path" in publishable(scored)) throw new Error("the absolute repo path must not be published");
      eq(publishable(scored).repo, "label", "the label survives, the path does not");
      if (JSON.stringify(publishable(scored)).includes("/Users/"))
        throw new Error("a filesystem path reached the published payload");
    }
    if (randomizationP([[1], [1], [1]], { replicates: 100 }) <= 0)
      throw new Error("randomization p must be bounded by the replicate count, not 0");
    // Clustering must cost power rather than invent it: the same effect flipped one repo at a
    // time cannot come out more significant than flipped one query at a time.
    const clusteredDiffs = [[0.1, 0.1, 0.1], [0.1, 0.1, 0.1]];
    if (randomizationP(clusteredDiffs) < randomizationP(clusteredDiffs.flat().map((d) => [d])))
      throw new Error("cluster-level randomization must not be more significant than query-level");

    console.log("selftest ok");
    process.exit(0);
  }

  // Single-repo diagnostic. This is the frame that survives ticket 08: repo-level scores compare
  // badly across repos, but WITHIN one repo the rank of the answer varies enormously (3 to 116 in
  // one spot check), and an expensive query names a concrete thing to rename or document.
  const single = positional.find((a) => existsSync(a));

  const r = flags["--retriever"];
  if (typeof r === "string") {
    if (r !== "rg" && r !== "hay") { console.error("--retriever must be rg or hay"); process.exit(1); }
    RETRIEVER = r;
  }
  // Ablation passthrough: --ablate no-definition,no-path  ->  hay --no-definition --no-path
  if (typeof flags["--ablate"] === "string") {
    HAY_FLAGS = flags["--ablate"].split(",").filter(Boolean).map((f) => `--${f}`);
  }

  // Said once, before any of it is produced. The per-repo payload carries real search terms from
  // private repositories; the paired `--compare` payload is aggregates only and is safe to commit.
  if (flags["--json"] && !flags["--compare"]) {
    console.error("hygiene: --json contains real queries harvested from your own repositories. Do not commit it; publish only the aggregates from --compare.");
  }

  const corpusPath = typeof flags["--corpus"] === "string" ? flags["--corpus"] : "corpus/queries.json";
  const minQueries = typeof flags["--min-queries"] === "string" ? Number(flags["--min-queries"]) : 40;
  const corpus: CorpusEntry[] = await Bun.file(corpusPath).json();

  const byRepo = new Map<string, CorpusEntry[]>();
  for (const e of corpus) {
    if (!existsSync(e.repo)) continue; // repo moved or deleted since the transcript
    byRepo.set(e.repo, [...(byRepo.get(e.repo) ?? []), e]);
  }
  if (single) {
    const entries = byRepo.get(single) ?? [];
    if (entries.length === 0) {
      console.error(`no judged queries for ${single}. Run harvest-queries.ts first, or check the path.`);
      process.exit(1);
    }
    const s = await scoreRepo(single, entries);
    console.log(`\n\x1b[1m${s.repo}\x1b[0m  MRR ${s.mrr.toFixed(3)}  ·  ${s.queries} judged queries  ·  answer in top 10 for ${(s.answerInTop10 * 100).toFixed(0)}%`);
    console.log(`\nMost expensive searches in this repo — result lines an agent reads before the answer:\n`);
    for (const w of s.worst) {
      console.log(`  ${(w.rank === null ? `>${w.results}` : String(w.rank)).padStart(6)}   ${w.query}`);
    }
    console.log(`\nEach line is a concrete fix: rename the concept, or make the definition the first hit.`);
    process.exit(0);
  }

  const targets = [...byRepo.entries()].filter(([, es]) => es.length >= minQueries).sort((a, b) => b[1].length - a[1].length);
  console.error(`${targets.length} repos with >= ${minQueries} judged queries`);

  // The pair dump is the error-analysis input: per-query ranks, answer files and first-page
  // paths. All of it is private-corpus material, so it defaults to living beside the corpus.
  const dumpPath = typeof flags["--dump-pairs"] === "string" ? flags["--dump-pairs"] : null;
  if (dumpPath && !flags["--compare"]) {
    console.error("--dump-pairs only makes sense with --compare; the paired records are what it dumps.");
    process.exit(1);
  }
  if (dumpPath && !isUnderCorpus(dumpPath)) {
    console.error(
      "--dump-pairs writes real queries and file paths from private repositories and must stay under corpus/ (gitignored).",
    );
    process.exit(1);
  }

  if (flags["--compare"]) {
    const pairs: Pair[] = [];
    for (const [repo, entries] of targets) {
      const p = await pairRepo(repo, entries);
      pairs.push(...p);
      console.error(`${basename(repo).padEnd(28)} paired n=${p.length}`);
    }
    if (pairs.length === 0) {
      // mean([]) is 0 and the empty bootstrap returns [0, 0]; printing that would be a report of
      // plausible-looking zeros, and with --json it would be persisted as evidence of no effect.
      console.error("no paired observations: no repo met --min-queries, or no query had a valid answer under either retriever");
      process.exit(1);
    }
    const dRR = (p: Pair) => p.rrHay - p.rrRg;
    const dTop = (p: Pair) => p.top10Hay - p.top10Rg;
    const dNdcg = (p: Pair) => p.ndcgHay - p.ndcgRg;
    // Every effect gets the same treatment: a bootstrap interval both by query and clustered by
    // repository, plus the randomization test at both levels. Reporting one number per effect is
    // how a favourable analysis choice hides.
    const effect = (diff: (p: Pair) => number) => ({
      byQuery: bootstrapCI(pairs.map((p) => [diff(p)])),
      byRepo: bootstrapCI(byCluster(pairs, diff)),
      randomizationByQuery: randomizationP(pairs.map((p) => [diff(p)])),
      randomizationByRepo: randomizationP(byCluster(pairs, diff)),
    });
    const report = {
      queries: pairs.length,
      repos: new Set(pairs.map((p) => p.repo)).size,
      mrrRg: mean(pairs.map((p) => p.rrRg)),
      mrrHay: mean(pairs.map((p) => p.rrHay)),
      top10Rg: mean(pairs.map((p) => p.top10Rg)),
      top10Hay: mean(pairs.map((p) => p.top10Hay)),
      ndcg10Rg: mean(pairs.map((p) => p.ndcgRg)),
      ndcg10Hay: mean(pairs.map((p) => p.ndcgHay)),
      // Absolute differences, not relative: a ratio of means is not a defensible effect size.
      deltaMrr: effect(dRR),
      deltaTop10: effect(dTop),
      deltaNdcg10: effect(dNdcg),
      // Descriptive only. Smucker et al. show the sign test detects poorly; it is not the test.
      better: pairs.filter((p) => dRR(p) > 0).length,
      worse: pairs.filter((p) => dRR(p) < 0).length,
      tied: pairs.filter((p) => dRR(p) === 0).length,
      // Queries where at least one retriever's first page hit the line budget before it held ten
      // distinct files. Their nDCG is a floor rather than a measurement, so the count is published
      // with the effect it qualifies.
      ndcgTruncated: pairs.filter((p) => !p.pageComplete).length,
      // Queries where hay hit its candidate cap: the answer may have been dropped before scoring,
      // so these are a limit of hay's bounded retention, counted rather than absorbed.
      hayTruncatedQueries: pairs.filter((p) => p.hayTruncated).length,
      // The pre-registered gate, as written in DESIGN-hay.md — a median across repos, not the
      // paired mean above. Both are reported; they answer different questions.
      gate: gateStats(pairs),
    };
    const show = (name: string, e: ReturnType<typeof effect>) => {
      const i = (label: string, v: Interval, rp: number) =>
        console.error(`  ${label.padEnd(22)} ${v.mean >= 0 ? "+" : ""}${v.mean.toFixed(4)}  95% CI [${v.lo.toFixed(4)}, ${v.hi.toFixed(4)}]  boot p=${v.p.toFixed(4)}  rand p=${rp.toFixed(4)}  observations=${v.n}  clusters=${v.clusters}`);
      i(`${name} (by query)`, e.byQuery, e.randomizationByQuery);
      i(`${name} (by repo)`, e.byRepo, e.randomizationByRepo);
    };
    console.error(`\npaired over ${report.queries} queries in ${report.repos} repositories`);
    console.error(`  MRR      rg ${report.mrrRg.toFixed(4)}  ->  hay ${report.mrrHay.toFixed(4)}`);
    console.error(`  top-10   rg ${report.top10Rg.toFixed(4)}  ->  hay ${report.top10Hay.toFixed(4)}`);
    console.error(`  nDCG@10  rg ${report.ndcg10Rg.toFixed(4)}  ->  hay ${report.ndcg10Hay.toFixed(4)}`);
    show("dMRR", report.deltaMrr);
    show("dTop10", report.deltaTop10);
    show("dNDCG10", report.deltaNdcg10);
    console.error(`  better ${report.better} / worse ${report.worse} / tied ${report.tied}`);
    console.error(`  nDCG first page truncated on ${report.ndcgTruncated} of ${report.queries} queries`);
    console.error(`  hay candidate cap hit on ${report.hayTruncatedQueries} of ${report.queries} queries`);
    const g = report.gate;
    console.error(
      `\n  GATE (DESIGN-hay.md, median across ${g.repos} repos): ` +
      `MRR ${g.medianRepoMrrHay.toFixed(4)} (need >= 0.50)  top-10 ${g.medianRepoTop10Hay.toFixed(4)} (need >= 0.80)  ->  ${g.pass ? "PASS" : "FAIL"}`,
    );
    console.error(
      `  rg for reference: median MRR ${g.medianRepoMrrRg.toFixed(4)}  top-10 ${g.medianRepoTop10Rg.toFixed(4)}  ·  repos where hay is worse than rg: ${g.reposWorse}`,
    );
    if (dumpPath) {
      console.error(`\nhygiene: ${dumpPath} contains real queries and paths from private repositories. Never commit or publish it.`);
      writePrivateCorpus(dumpPath, JSON.stringify(pairs, null, 2));
      console.error(`wrote ${pairs.length} pairs to ${dumpPath}`);
    }
    if (flags["--json"]) console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }

  const scores: RepoScore[] = [];
  for (const [repo, entries] of targets) {
    const s = await scoreRepo(repo, entries);
    scores.push(s);
    console.error(
      `${s.repo.padEnd(28)} MRR ${s.mrr.toFixed(3)}  nDCG@10 ${s.ndcg10.toFixed(3)}  median rank ${String(s.medianRank).padStart(4)}` +
      `  top10 ${(s.answerInTop10 * 100).toFixed(0).padStart(3)}%  unreachable ${(s.unreachable * 100).toFixed(0).padStart(3)}%  n=${s.queries}/${s.judgedFrom}`,
    );
  }
  if (flags["--json"]) console.log(JSON.stringify(scores.map(publishable), null, 2));
}
