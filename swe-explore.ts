#!/usr/bin/env bun
/**
 * swe-explore — hay versus ripgrep on a public, agent-shaped localization benchmark.
 *
 * HEADLINE CLAIM: given identical mechanically-derived queries, does hay's reordering surface
 * gold files earlier than ripgrep's path order? `--compare-hints` asks a separate, query-paired
 * question: does caller-supplied issue context improve current hay? Neither mode measures full
 * issue localization; both derivation rules are deliberately mechanical, fixed, and versioned.
 *
 * Why this exists: every number this project publishes rests on twelve repositories from one
 * developer's transcripts. SWE-Explore-Bench (arXiv 2606.07297) is public, multi-language, and
 * agent-shaped — its ground truth is the code regions independent successful agent trajectories
 * actually consulted. Anyone can rerun this file and get the same instances, the same queries,
 * and the same statistics.
 *
 * Data:
 *  - instances: HF dataset SWE-Explore-Bench/SWE-Explore-Bench (848 instances; the `verified`
 *    and `multilingual` splits are used — their issue text and base commits are public in
 *    princeton-nlp/SWE-bench_Verified and swe-bench/SWE-bench_Multilingual).
 *  - repos: GitHub archive tarballs at the instance's base_commit, cached under
 *    $XDG_CACHE_HOME/hay/corpora/swe-explore/. Archives over the size budget are skipped and
 *    COUNTED (invariant 7: a measure's truncations are published, never absorbed).
 *
 * Both retrievers run through measure-mrr.ts's own `retrieverArgv`/`rankOfAnswer`, so the
 * invariant-6 flag parity is inherited from the harness that already proves it, not copied.
 *
 * Usage:
 *   bun swe-explore.ts [--sample 100] [--budget-mb 500]   # full run, writes evidence/
 *   bun swe-explore.ts --compare-hints                    # paired hay vs hinted-hay query run
 *   bun swe-explore.ts --selftest
 */

import {
  chmodSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, renameSync, rmSync,
  symlinkSync, writeFileSync, type Stats,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join, posix, resolve } from "node:path";
import { create as createTar, Unpack, type ReadEntry } from "tar";

import {
  ResultScan, bootstrapCI, mean, mulberry32, namesTheSameFile, randomizationP, rankOfAnswer,
  requireHintSignalBinary, setHayFlags, type Interval,
} from "./measure-mrr.ts";
import { HDERIVE_VERSION, deriveHints } from "./hint-derive.ts";

const cacheHome = process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache");
const CACHE = join(cacheHome, "hay", "corpora", "swe-explore");
const BENCH_URL = "https://huggingface.co/datasets/SWE-Explore-Bench/SWE-Explore-Bench/resolve/main/bench.final.public.jsonl";
const SEED = 20260820;
const CANONICAL_HINT_BUDGET_MB = 500;
const MAX_ARCHIVE_BUDGET_MB = 4096;
const HTTP_USER_AGENT = "OpenAI File Downloader, XaiImageApiFetch/1.0";
const MIB = 1024 * 1024;
// These ceilings are deliberately well above the current public inputs (13 MiB / <1,000 rows)
// while turning upstream growth or a stuck endpoint into an explicit failed run, never truncation.
const MAX_BENCHMARK_BYTES = 64 * MIB;
const MAX_BENCHMARK_ROWS = 10_000;
const MAX_ISSUE_PAGE_BYTES = 8 * MIB;
const MAX_ISSUE_CACHE_BYTES = 64 * MIB;
const ISSUE_PAGE_SIZE = 100;
const MAX_ISSUE_PAGES = 100;
const MAX_ISSUE_ROWS = 10_000;
const JSON_FETCH_TIMEOUT_MS = 60_000;
const ARCHIVE_FETCH_TIMEOUT_MS = 10 * 60_000;
const MAX_ARCHIVE_MEMBERS = 200_000;
const MAX_ARCHIVE_DEPTH = 64;
const MAX_DECOMPRESSION_RATIO = 200;

function installedTarVersion(): string {
  const metadata = JSON.parse(
    readFileSync(new URL(import.meta.resolve("tar/package.json")), "utf8"),
  ) as { name?: unknown; version?: unknown };
  if (metadata.name !== "tar" ||
      typeof metadata.version !== "string" ||
      !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(metadata.version)) {
    throw new Error("cannot identify the installed tar parser version");
  }
  return metadata.version;
}

const TAR_PARSER_VERSION = installedTarVersion();
/**
 * Cache schema for the exact extraction boundary. Parser or policy changes must miss old trees:
 * trusting a checkout created under weaker limits would bypass the current checks entirely.
 */
const ARCHIVE_EXTRACTION_POLICY = JSON.stringify({
  schema: "swe-explore-extraction-v2",
  parser: `tar@${TAR_PARSER_VERSION}`,
  maxMembers: MAX_ARCHIVE_MEMBERS,
  maxDepth: MAX_ARCHIVE_DEPTH,
  maxDecompressionRatio: MAX_DECOMPRESSION_RATIO,
  paths: "relative-posix-no-dot-components-v1",
  entries: "file-oldfile-directory;drop-symbolic-link;reject-other-v1",
});
/** The derivation rule's identity. Bump it if the rule changes; results are not comparable across versions. */
export const QDERIVE_VERSION = "qderive-v1";
/** The one path a published run writes. An ablation must never land here. */
export const PUBLISHED_EVIDENCE = "evidence/swe-explore.json";
/** Hint treatment evidence is intentionally separate from the headline rg-versus-hay artifact. */
export const HINTS_EVIDENCE = "evidence/swe-explore-hints.json";

type Instance = {
  instance_id: string;
  dataset: string;
  ground_truth: { read_core_files: string[] };
};

type Issue = { instance_id: string; repo: string; base_commit: string; problem_statement: string };

type ArchiveCoordinates = { cacheKey: string; repo: string; commit: string };

function archiveCacheKey(
  instanceId: string,
  repo: string,
  commit: string,
  budgetMb: number,
  extractionPolicy: string,
): string {
  return createHash("sha256")
    .update(instanceId)
    .update("\0")
    .update(repo)
    .update("\0")
    .update(commit)
    .update("\0")
    .update(String(budgetMb))
    .update("\0")
    .update(extractionPolicy)
    .digest("hex");
}

/** Reject remote dataset fields before they can influence a cache path or archive URL. */
export function safeArchiveCoordinates(
  instanceId: string,
  repo: string,
  baseCommit: string,
  budgetMb: number,
): ArchiveCoordinates | null {
  const cacheKeyOk = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(instanceId);
  const parts = repo.split("/");
  const ownerOk =
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(parts[0] ?? "");
  const repoName = parts[1] ?? "";
  const repoOk =
    /^[A-Za-z0-9._-]{1,100}$/.test(repoName) &&
    repoName !== "." && repoName !== "..";
  const commitOk = /^[0-9a-f]{40}$/i.test(baseCommit);
  const budgetOk =
    Number.isSafeInteger(budgetMb) && budgetMb >= 1 && budgetMb <= MAX_ARCHIVE_BUDGET_MB;
  if (!cacheKeyOk || parts.length !== 2 || !ownerOk || !repoOk || !commitOk || !budgetOk) {
    return null;
  }
  const commit = baseCommit.toLowerCase();
  const cacheKey = archiveCacheKey(
    instanceId, repo, commit, budgetMb, ARCHIVE_EXTRACTION_POLICY,
  );
  return { cacheKey, repo, commit };
}

/** Normalize a dataset-provided Git path without allowing it to name a host path. */
export function safeRepoRelativePath(candidate: string): string | null {
  if (
    candidate.length === 0 ||
    candidate.length > 4096 ||
    candidate.includes("\0") ||
    candidate.includes("\\") ||
    posix.isAbsolute(candidate)
  ) {
    return null;
  }
  const normalized = posix.normalize(candidate);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) return null;
  return normalized;
}

// ── language, from the gold files themselves ─────────────────────────────────

const LANG_BY_EXT: Record<string, string> = {
  py: "python", go: "go", js: "js/ts", jsx: "js/ts", ts: "js/ts", tsx: "js/ts", mjs: "js/ts",
  rb: "ruby", java: "java", c: "c/c++", h: "c/c++", cc: "c/c++", cpp: "c/c++", hpp: "c/c++",
  rs: "rust", php: "php", cs: "c#", swift: "swift", kt: "kotlin",
};

export function instanceLanguage(goldFiles: string[]): string {
  const votes = new Map<string, number>();
  for (const f of goldFiles) {
    const dot = f.lastIndexOf(".");
    const lang = dot === -1 ? null : LANG_BY_EXT[f.slice(dot + 1).toLowerCase()];
    if (lang) votes.set(lang, (votes.get(lang) ?? 0) + 1);
  }
  let best = "other", n = 0;
  for (const [lang, v] of votes) if (v > n) { best = lang; n = v; }
  return best;
}

// ── query derivation, fixed and versioned ─────────────────────────────────────

/**
 * `qderive-v1`'s own stop list. It is equal to `IDENTIFIER_STOP` in `hint-derive.ts` today and is
 * kept as a separate frozen copy on purpose: an edit to the hint rule must not silently re-derive
 * the published headline queries without a version bump here.
 */
const STOP = new Set([
  "the", "and", "for", "with", "this", "that", "from", "not", "are", "was", "when", "where",
  "def", "class", "function", "return", "import", "true", "false", "none", "null", "self",
  "python", "error", "line", "file", "files", "code", "test", "tests", "using", "used", "does",
  "should", "would", "could", "expected", "actual", "result", "results", "issue", "bug",
]);

/**
 * Deterministic queries from issue text: backticked tokens first (the author marked them as
 * code), then identifier-shaped tokens with a case transition, underscore, or dot — the shapes
 * `harvest-queries.ts` accepts from real agents. First five, order of appearance, no tuning.
 */
export function deriveQueries(title: string, body: string): string[] {
  const text = `${title}\n${body ?? ""}`;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = raw.trim();
    const k = t.toLowerCase();
    if (t.length < 3 || t.length > 40 || seen.has(k) || STOP.has(k)) return;
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(t)) return;
    seen.add(k);
    out.push(t);
  };
  // 1. Inline code spans, split on non-identifier characters so `foo(bar)` yields foo and bar.
  for (const m of text.matchAll(/`([^`\n]{1,80})`/g)) {
    for (const tok of m[1]!.split(/[^A-Za-z0-9_.]+/)) {
      const bare = tok.replace(/^\.+|\.+$/g, "");
      if (/[A-Z]/.test(bare) || bare.includes("_") || bare.includes(".")) push(bare);
      else if (/^[a-z][a-z0-9]{2,}$/.test(bare) && bare.length >= 6) push(bare);
    }
    if (out.length >= 5) return out.slice(0, 5);
  }
  // 2. Identifier-shaped words in prose: camelCase, snake_case, or dotted paths.
  for (const m of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+|[a-z0-9]+_[a-z0-9_]+|[a-z]+[A-Z][A-Za-z0-9]*)\b/g)) {
    push(m[1]!);
    if (out.length >= 5) break;
  }
  return out.slice(0, 5);
}

// ── aggregation ───────────────────────────────────────────────────────────────

export type QueryResult = {
  rr: number; top10: number; ndcg: number; truncated: boolean; results: number;
};

/**
 * The instance is the unit: an agent tries a few searches and reads the best first page it gets,
 * so the instance's score is its best query's. Query-level effects are reported too, clustered
 * by instance, since queries within an instance share an issue and are not independent.
 */
export function bestOf(rs: QueryResult[]): { rr: number; top10: number; ndcg: number } {
  return {
    rr: Math.max(0, ...rs.map((r) => r.rr)),
    top10: Math.max(0, ...rs.map((r) => r.top10)),
    ndcg: Math.max(0, ...rs.map((r) => r.ndcg)),
  };
}

type HintObservation = {
  instanceId: string;
  hintCount: number;
  baseline: QueryResult & { pageComplete: boolean };
  hinted: QueryResult & { pageComplete: boolean };
};

function hintObservationIsComplete(observation: HintObservation): boolean {
  return !observation.baseline.truncated && !observation.hinted.truncated &&
    observation.baseline.pageComplete && observation.hinted.pageComplete;
}

export type HintEffect = {
  baselineMean: number;
  hintedMean: number;
  better: number;
  worse: number;
  tied: number;
  byQuery: Interval;
  randomizationByQuery: number;
  byInstanceCluster: Interval;
  randomizationByInstanceCluster: number;
};

/** One paired observation per primary query; instances are clusters, never best-of selectors. */
export function hintEffect(
  observations: HintObservation[],
  metric: "rr" | "top10" | "ndcg",
): HintEffect {
  const diffs = observations.map((r) => r.hinted[metric] - r.baseline[metric]);
  const byInstance = new Map<string, number[]>();
  for (let i = 0; i < observations.length; i++) {
    const id = observations[i]!.instanceId;
    byInstance.set(id, [...(byInstance.get(id) ?? []), diffs[i]!]);
  }
  return {
    baselineMean: mean(observations.map((r) => r.baseline[metric])),
    hintedMean: mean(observations.map((r) => r.hinted[metric])),
    better: diffs.filter((d) => d > 0).length,
    worse: diffs.filter((d) => d < 0).length,
    tied: diffs.filter((d) => d === 0).length,
    byQuery: bootstrapCI(diffs.map((d) => [d])),
    randomizationByQuery: randomizationP(diffs.map((d) => [d])),
    byInstanceCluster: bootstrapCI([...byInstance.values()]),
    randomizationByInstanceCluster: randomizationP([...byInstance.values()]),
  };
}

type BaselineEffect = { byInstance: Interval; randomizationByInstance: number };

type CommonPayload = {
  benchmark: string;
  claim: string;
  qderive: typeof QDERIVE_VERSION;
  /** Recorded in both modes; `mode` says whether this rule was applied. */
  hderive: typeof HDERIVE_VERSION;
  seed: number;
  sourceSha256: {
    benchmarkJsonl: string;
    verifiedIssues: string;
    multilingualIssues: string;
  };
  manifestPath: string;
  manifestSha256: string;
  manifestInstanceIds: string[];
  instances: number;
  queries: number;
  byLanguage: Record<string, number>;
  excluded: {
    noPublicIssueText: number;
    repoSkipped: number;
    noDerivableQueries: number;
    noVisibleGold: number;
  };
  archiveLinkMembersDropped: number;
  checkoutsWithUnrecordedDrops: number;
  toolVersions: { hay: string; rg: string };
  toolSha256: { hay: string; rg: string };
};

export type BaselinePayload = CommonPayload & {
  mode: "baseline";
  hayAblation: string[];
  mrrRg: number;
  mrrHay: number;
  top10Rg: number;
  top10Hay: number;
  ndcg10Rg: number;
  ndcg10Hay: number;
  deltaMrr: BaselineEffect;
  deltaTop10: BaselineEffect;
  deltaNdcg10: BaselineEffect;
  hayTruncatedQueries: number;
};

export type HintComparisonPayload = CommonPayload & {
  mode: "compare-hints";
  hderive: typeof HDERIVE_VERSION;
  hayAblation: [];
  archiveBudgetMb: typeof CANONICAL_HINT_BUDGET_MB;
  scoredInstanceIds: string[];
  sampleExclusions: {
    repoSkipped: string[];
    noDerivableQueries: string[];
    noVisibleGold: string[];
  };
  primaryContrast: "paired-query";
  statisticalReplicates: 10_000;
  validatedPairs: number;
  validatedInstances: number;
  zeroHintQueries: number;
  incompletePairs: {
    candidateCap: number;
    pageTruncated: number;
    total: number;
  };
  candidateCapQueries: { baseline: number; hinted: number };
  pageTruncatedQueries: { baseline: number; hinted: number };
  mrr: HintEffect;
  top10: HintEffect;
  ndcg10: HintEffect;
};

export type SwePayload = BaselinePayload | HintComparisonPayload;

/** Fail closed before evidence is written: JSON shape and arithmetic must agree. */
export function validateSwePayload(value: unknown): SwePayload {
  const bad = (path: string, actual: unknown, expected: string): never => {
    throw new Error(`SWE evidence invalid: ${path} = ${JSON.stringify(actual)} (expected ${expected})`);
  };
  const record = (actual: unknown, path: string): Record<string, unknown> => {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) bad(path, actual, "object");
    return actual as Record<string, unknown>;
  };
  const string = (actual: unknown, path: string): string => {
    if (typeof actual !== "string" || actual.length === 0) bad(path, actual, "nonempty string");
    return actual as string;
  };
  const finite = (actual: unknown, path: string): number => {
    if (typeof actual !== "number" || !Number.isFinite(actual)) bad(path, actual, "finite number");
    return actual as number;
  };
  const integer = (actual: unknown, path: string, min = 0): number => {
    const n = finite(actual, path);
    if (!Number.isInteger(n) || n < min) bad(path, actual, `integer >= ${min}`);
    return n;
  };
  const probability = (actual: unknown, path: string): number => {
    const n = finite(actual, path);
    if (n < 0 || n > 1) bad(path, actual, "number in [0, 1]");
    return n;
  };
  const interval = (actual: unknown, path: string, n: number, clusters: number): Interval => {
    const row = record(actual, path);
    for (const key of ["mean", "lo", "hi"] as const) {
      const x = finite(row[key], `${path}.${key}`);
      if (x < -1 || x > 1) bad(`${path}.${key}`, x, "number in [-1, 1]");
    }
    probability(row["p"], `${path}.p`);
    if (integer(row["n"], `${path}.n`) !== n) bad(`${path}.n`, row["n"], `${n}`);
    if (integer(row["clusters"], `${path}.clusters`) !== clusters) {
      bad(`${path}.clusters`, row["clusters"], `${clusters}`);
    }
    if ((row["lo"] as number) > (row["hi"] as number)) bad(path, row, "lo <= hi");
    return row as unknown as Interval;
  };
  const effect = (actual: unknown, path: string, queries: number, instances: number): HintEffect => {
    const row = record(actual, path);
    const baselineMean = probability(row["baselineMean"], `${path}.baselineMean`);
    const hintedMean = probability(row["hintedMean"], `${path}.hintedMean`);
    const better = integer(row["better"], `${path}.better`);
    const worse = integer(row["worse"], `${path}.worse`);
    const tied = integer(row["tied"], `${path}.tied`);
    if (better + worse + tied !== queries) bad(path, row, `better + worse + tied = ${queries}`);
    const byQuery = interval(row["byQuery"], `${path}.byQuery`, queries, queries);
    const byInstanceCluster = interval(
      row["byInstanceCluster"], `${path}.byInstanceCluster`, queries, instances,
    );
    const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9;
    if (!close(byQuery.mean, hintedMean - baselineMean)) {
      bad(`${path}.byQuery.mean`, byQuery.mean, `hintedMean - baselineMean (${hintedMean - baselineMean})`);
    }
    if (!close(byInstanceCluster.mean, hintedMean - baselineMean)) {
      bad(`${path}.byInstanceCluster.mean`, byInstanceCluster.mean, "same paired mean as byQuery");
    }
    probability(row["randomizationByQuery"], `${path}.randomizationByQuery`);
    probability(row["randomizationByInstanceCluster"], `${path}.randomizationByInstanceCluster`);
    return row as unknown as HintEffect;
  };

  const payload = record(value, "payload");
  string(payload["benchmark"], "benchmark");
  string(payload["claim"], "claim");
  if (payload["qderive"] !== QDERIVE_VERSION) bad("qderive", payload["qderive"], QDERIVE_VERSION);
  if (payload["hderive"] !== HDERIVE_VERSION) bad("hderive", payload["hderive"], HDERIVE_VERSION);
  integer(payload["seed"], "seed");
  const sourceSha256 = record(payload["sourceSha256"], "sourceSha256");
  const sourceKeys = ["benchmarkJsonl", "verifiedIssues", "multilingualIssues"] as const;
  if (JSON.stringify(Object.keys(sourceSha256).sort()) !== JSON.stringify([...sourceKeys].sort())) {
    bad("sourceSha256", sourceSha256, `exact keys ${sourceKeys.join(", ")}`);
  }
  for (const key of sourceKeys) {
    const sourceDigest = string(sourceSha256[key], `sourceSha256.${key}`);
    if (!/^[0-9a-f]{64}$/.test(sourceDigest)) {
      bad(`sourceSha256.${key}`, sourceDigest, "lowercase SHA-256");
    }
  }
  string(payload["manifestPath"], "manifestPath");
  const digest = string(payload["manifestSha256"], "manifestSha256");
  if (!/^[0-9a-f]{64}$/.test(digest)) bad("manifestSha256", digest, "lowercase SHA-256");
  if (!Array.isArray(payload["manifestInstanceIds"]) || payload["manifestInstanceIds"].length === 0) {
    bad("manifestInstanceIds", payload["manifestInstanceIds"], "nonempty string array");
  }
  const manifestIds = payload["manifestInstanceIds"] as unknown[];
  const ids = manifestIds.map((id, i) => string(id, `manifestInstanceIds[${i}]`));
  if (new Set(ids).size !== ids.length) bad("manifestInstanceIds", ids, "unique ordered IDs");
  const instances = integer(payload["instances"], "instances", 1);
  const queries = integer(payload["queries"], "queries", 1);
  if (instances > ids.length) bad("instances", instances, `at most manifest size ${ids.length}`);
  if (queries < instances || queries > instances * 5) {
    bad("queries", queries, `between one and five qderive-v1 queries per scored instance`);
  }
  const byLanguage = record(payload["byLanguage"], "byLanguage");
  const languageTotal = Object.entries(byLanguage).reduce(
    (sum, [lang, count]) => sum + integer(count, `byLanguage.${lang}`, 1), 0,
  );
  if (languageTotal !== instances) bad("byLanguage", byLanguage, `counts sum to ${instances}`);
  const excluded = record(payload["excluded"], "excluded");
  const noPublicIssueText = integer(excluded["noPublicIssueText"], "excluded.noPublicIssueText");
  void noPublicIssueText;
  const repoSkipped = integer(excluded["repoSkipped"], "excluded.repoSkipped");
  const noDerivableQueries = integer(excluded["noDerivableQueries"], "excluded.noDerivableQueries");
  const noVisibleGold = integer(excluded["noVisibleGold"], "excluded.noVisibleGold");
  if (instances + repoSkipped + noDerivableQueries + noVisibleGold !== ids.length) {
    bad("excluded", excluded, `scored plus sampled exclusions = manifest size ${ids.length}`);
  }
  integer(payload["archiveLinkMembersDropped"], "archiveLinkMembersDropped");
  integer(payload["checkoutsWithUnrecordedDrops"], "checkoutsWithUnrecordedDrops");
  const tools = record(payload["toolVersions"], "toolVersions");
  string(tools["hay"], "toolVersions.hay");
  string(tools["rg"], "toolVersions.rg");
  const toolSha256 = record(payload["toolSha256"], "toolSha256");
  for (const key of ["hay", "rg"] as const) {
    const toolDigest = string(toolSha256[key], `toolSha256.${key}`);
    if (!/^[0-9a-f]{64}$/.test(toolDigest)) {
      bad(`toolSha256.${key}`, toolDigest, "lowercase SHA-256");
    }
  }
  if (!Array.isArray(payload["hayAblation"]) ||
      !(payload["hayAblation"] as unknown[]).every((flag) => typeof flag === "string")) {
    bad("hayAblation", payload["hayAblation"], "string array");
  }

  if (payload["mode"] === "compare-hints") {
    if ((payload["hayAblation"] as unknown[]).length !== 0) bad("hayAblation", payload["hayAblation"], "empty");
    if (payload["archiveBudgetMb"] !== CANONICAL_HINT_BUDGET_MB) {
      bad("archiveBudgetMb", payload["archiveBudgetMb"], `${CANONICAL_HINT_BUDGET_MB}`);
    }
    if (!Array.isArray(payload["scoredInstanceIds"])) {
      bad("scoredInstanceIds", payload["scoredInstanceIds"], "string array");
    }
    const scoredIds = (payload["scoredInstanceIds"] as unknown[])
      .map((id, i) => string(id, `scoredInstanceIds[${i}]`));
    if (scoredIds.length !== instances || new Set(scoredIds).size !== scoredIds.length) {
      bad("scoredInstanceIds", scoredIds, `${instances} unique IDs`);
    }
    const sampleExclusions = record(payload["sampleExclusions"], "sampleExclusions");
    const exclusionCounts = { repoSkipped, noDerivableQueries, noVisibleGold };
    const excludedIds: string[] = [];
    for (const key of ["repoSkipped", "noDerivableQueries", "noVisibleGold"] as const) {
      const actual = sampleExclusions[key];
      if (!Array.isArray(actual)) bad(`sampleExclusions.${key}`, actual, "string array");
      const values = (actual as unknown[]).map((id, i) => string(id, `sampleExclusions.${key}[${i}]`));
      if (values.length !== exclusionCounts[key]) {
        bad(`sampleExclusions.${key}`, values, `${exclusionCounts[key]} IDs`);
      }
      excludedIds.push(...values);
    }
    const partition = [...scoredIds, ...excludedIds];
    const manifestSet = new Set(ids);
    if (partition.length !== ids.length || new Set(partition).size !== ids.length ||
        partition.some((id) => !manifestSet.has(id))) {
      bad("sample partition", partition, "each manifest ID exactly once across scored and excluded IDs");
    }
    if (payload["primaryContrast"] !== "paired-query") {
      bad("primaryContrast", payload["primaryContrast"], "paired-query");
    }
    if (payload["statisticalReplicates"] !== 10_000) {
      bad("statisticalReplicates", payload["statisticalReplicates"], "10000");
    }
    const validatedPairs = integer(payload["validatedPairs"], "validatedPairs", 1);
    if (validatedPairs > queries) bad("validatedPairs", validatedPairs, `at most ${queries}`);
    const validatedInstances = integer(payload["validatedInstances"], "validatedInstances", 1);
    if (validatedInstances > instances || validatedInstances > validatedPairs) {
      bad("validatedInstances", validatedInstances, `at most ${Math.min(instances, validatedPairs)}`);
    }
    const zeroHints = integer(payload["zeroHintQueries"], "zeroHintQueries");
    if (zeroHints > validatedPairs) bad("zeroHintQueries", zeroHints, `at most ${validatedPairs}`);
    const incomplete = record(payload["incompletePairs"], "incompletePairs");
    const candidateCapPairs = integer(incomplete["candidateCap"], "incompletePairs.candidateCap");
    const pageTruncatedPairs = integer(incomplete["pageTruncated"], "incompletePairs.pageTruncated");
    const incompleteTotal = integer(incomplete["total"], "incompletePairs.total");
    if (incompleteTotal !== queries - validatedPairs) {
      bad("incompletePairs.total", incompleteTotal, `queries - validatedPairs (${queries - validatedPairs})`);
    }
    if (candidateCapPairs > incompleteTotal || pageTruncatedPairs > incompleteTotal) {
      bad("incompletePairs", incomplete, `component counts at most ${incompleteTotal}`);
    }
    const armCounts = (key: "candidateCapQueries" | "pageTruncatedQueries") => {
      const counts = record(payload[key], key);
      const baseline = integer(counts["baseline"], `${key}.baseline`);
      const hinted = integer(counts["hinted"], `${key}.hinted`);
      if (baseline > incompleteTotal || hinted > incompleteTotal) {
        bad(key, counts, `arm counts at most ${incompleteTotal}`);
      }
      return { baseline, hinted };
    };
    const candidateArms = armCounts("candidateCapQueries");
    const pageArms = armCounts("pageTruncatedQueries");
    const possibleUnion = (union: number, arms: { baseline: number; hinted: number }, path: string) => {
      if (union < Math.max(arms.baseline, arms.hinted) || union > arms.baseline + arms.hinted) {
        bad(path, union, `between max arm count and arm sum`);
      }
    };
    possibleUnion(candidateCapPairs, candidateArms, "incompletePairs.candidateCap");
    possibleUnion(pageTruncatedPairs, pageArms, "incompletePairs.pageTruncated");
    if (
      incompleteTotal < Math.max(candidateCapPairs, pageTruncatedPairs) ||
      incompleteTotal > candidateCapPairs + pageTruncatedPairs
    ) {
      bad("incompletePairs.total", incompleteTotal, "a possible union of its component counts");
    }
    effect(payload["mrr"], "mrr", validatedPairs, validatedInstances);
    effect(payload["top10"], "top10", validatedPairs, validatedInstances);
    effect(payload["ndcg10"], "ndcg10", validatedPairs, validatedInstances);
  } else if (payload["mode"] === "baseline") {
    for (const key of ["mrrRg", "mrrHay", "top10Rg", "top10Hay", "ndcg10Rg", "ndcg10Hay"] as const) {
      probability(payload[key], key);
    }
    const deltaRows = [
      ["deltaMrr", "mrrRg", "mrrHay"],
      ["deltaTop10", "top10Rg", "top10Hay"],
      ["deltaNdcg10", "ndcg10Rg", "ndcg10Hay"],
    ] as const;
    for (const [key, baselineKey, treatmentKey] of deltaRows) {
      const row = record(payload[key], key);
      const measured = interval(row["byInstance"], `${key}.byInstance`, instances, instances);
      const expected = (payload[treatmentKey] as number) - (payload[baselineKey] as number);
      if (Math.abs(measured.mean - expected) > 1e-9) {
        bad(`${key}.byInstance.mean`, measured.mean, `${treatmentKey} - ${baselineKey} (${expected})`);
      }
      probability(row["randomizationByInstance"], `${key}.randomizationByInstance`);
    }
    const capped = integer(payload["hayTruncatedQueries"], "hayTruncatedQueries");
    if (capped > queries) bad("hayTruncatedQueries", capped, `at most ${queries}`);
  } else {
    bad("mode", payload["mode"], "baseline or compare-hints");
  }
  return value as SwePayload;
}

// ── remote archive boundary ───────────────────────────────────────────────────

export type ArchiveLimits = { expandedBytes: number; members: number; depth: number };
type ArchiveGuard = ((path: string, entry: ReadEntry | Stats) => boolean) & {
  violation: () => string | null;
  /** Members dropped without failing the archive — links, which are never written to disk. */
  skipped: () => number;
};

/** Validate every archive member before the maintained parser writes it to disk. */
export function archiveEntryGuard(limits: ArchiveLimits): ArchiveGuard {
  let members = 0, expandedBytes = 0, skipped = 0, violation: string | null = null;
  const reject = (message: string): false => { violation ??= message; return false; };
  const guard = ((path: string, entry: ReadEntry | Stats): boolean => {
    if (violation) return false;
    // `tar` shares one filter type between creation (fs.Stats) and extraction (ReadEntry).
    // This guard is extraction-only; rejecting the other shape keeps the boundary explicit.
    if (!("type" in entry)) return reject("unexpected archive metadata");
    if (
      path.length === 0 || path.length > 4096 || path.includes("\0") ||
      path.includes("\\") || posix.isAbsolute(path)
    ) return reject("unsafe archive path");
    const components = path.replace(/\/$/, "").split("/");
    if (
      components.some((component) => component === "" || component === "." || component === "..") ||
      components.length > limits.depth
    ) return reject("unsafe archive path depth");
    // Every header consumes the member budget, including entries intentionally filtered below.
    // Otherwise an archive can hide an unbounded number of symlink headers outside the limit.
    members++;
    if (members > limits.members) return reject("archive member limit exceeded");
    // SYMBOLIC links are dropped, not fatal. One in an untrusted archive is the classic escape, so
    // none is ever written — but rejecting the whole tarball for containing one threw away 21 of
    // the 97 committed SWE-Explore instances on a clean machine (django, sympy and friends all
    // ship symlinks), which is the external-validity evidence disappearing over a member nothing
    // here would have read: ripgrep does not follow symlinks by default, so the extracted tree is
    // identical for the measurement with the links absent. Counted, per invariant 7.
    //
    // HARD links fall through to the fatal branch below (review finding, 2026-08-27): a hard link
    // is an ordinary file to ripgrep, so dropping one would remove searchable content — possibly a
    // gold file — while the run went on scoring the archive as complete. `git archive`, which is
    // what GitHub's codeload endpoint serves, emits only regular files, directories and symlinks,
    // so this should never fire; if it ever does the archive is refused loudly and counted as a
    // skipped repository rather than quietly measured with a hole in it.
    if (entry.type === "SymbolicLink") {
      skipped++;
      return false;
    }
    if (entry.type !== "File" && entry.type !== "OldFile" && entry.type !== "Directory") {
      return reject("unsupported archive entry type");
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) return reject("invalid archive entry size");
    if (entry.size > limits.expandedBytes - expandedBytes) {
      return reject("archive expanded-byte limit exceeded");
    }
    expandedBytes += entry.size;
    return true;
  }) as ArchiveGuard;
  guard.violation = () => violation;
  guard.skipped = () => skipped;
  return guard;
}

/**
 * Extract the archive, returning how many members were dropped without failing it.
 *
 * The count is returned rather than kept private because a counter only the selftest can read is
 * the exact defect this whole change is about: the harness had been printing `repoSkipped: 22`
 * into the payload for weeks and nobody read it. It ends up in the published evidence.
 */
export async function extractSafeArchive(
  archive: string,
  destination: string,
  limits: ArchiveLimits,
): Promise<number> {
  const guard = archiveEntryGuard(limits);
  await new Promise<void>((resolveExtraction, reject) => {
    let settled = false;
    const input = createReadStream(archive);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      input.destroy();
      if (error) reject(error);
      else resolveExtraction();
    };
    const fail = (error: unknown) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    };
    let unpack: Unpack;
    unpack = new Unpack({
      cwd: destination,
      gzip: true,
      strict: true,
      preservePaths: false,
      unlink: true,
      maxDecompressionRatio: MAX_DECOMPRESSION_RATIO,
      filter: (path, entry) => {
        if (guard(path, entry)) return true;
        // A dropped link is not a violation: the guard says so by leaving `violation` unset, and
        // extraction continues without it.
        if (guard.violation() === null) return false;
        const error = new Error(guard.violation() ?? "archive safety limit exceeded");
        input.destroy();
        unpack.abort(error);
        finish(error);
        return false;
      },
    });
    input.once("error", fail);
    unpack.once("error", fail);
    unpack.once("close", () => {
      const violation = guard.violation();
      finish(violation ? new Error(violation) : undefined);
    });
    input.pipe(unpack);
  });
  return guard.skipped();
}

// ── plumbing ──────────────────────────────────────────────────────────────────

type HttpFetcher = (url: string, init: RequestInit) => Promise<Response>;

type BoundedFetchOptions = {
  maxBytes: number;
  timeoutMs: number;
  redirect?: RequestRedirect;
  fetcher?: HttpFetcher;
  onChunk?: (chunk: Uint8Array) => void | Promise<void>;
};

/** Stream one response under a total byte and wall-clock budget; any overflow fails the run. */
export async function fetchBounded(
  url: string,
  options: BoundedFetchOptions,
): Promise<{ bytes: Uint8Array | null; byteLength: number }> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 ||
      !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) {
    throw new Error("bounded fetch needs positive integer byte and timeout limits");
  }
  const controller = new AbortController();
  const timeoutError = new Error(`${url}: timed out after ${options.timeoutMs} ms`);
  let rejectTimeout!: (reason: Error) => void;
  const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => {
    controller.abort(timeoutError);
    rejectTimeout(timeoutError);
  }, options.timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const operation = async (): Promise<{ bytes: Uint8Array | null; byteLength: number }> => {
    const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    const response = await fetcher(url, {
      headers: { "User-Agent": HTTP_USER_AGENT },
      redirect: options.redirect,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    if (response.body === null) throw new Error(`${url}: response has no body`);
    const declared = response.headers.get("content-length");
    if (declared !== null) {
      const length = Number(declared);
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new Error(`${url}: invalid Content-Length`);
      }
      if (length > options.maxBytes) {
        throw new Error(`${url}: response byte limit exceeded (${length} > ${options.maxBytes})`);
      }
    }
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > options.maxBytes - byteLength) {
        throw new Error(`${url}: response byte limit exceeded (${options.maxBytes})`);
      }
      byteLength += value.byteLength;
      if (options.onChunk) await options.onChunk(value);
      else chunks.push(value);
    }
    if (options.onChunk) return { bytes: null, byteLength };
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, byteLength };
  };
  try {
    return await Promise.race([operation(), timeout]);
  } catch (error) {
    controller.abort(error);
    if (reader) void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function decodeUtf8(bytes: Uint8Array, source: string): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (error) { throw new Error(`${source}: invalid UTF-8: ${String(error)}`); }
}

function parseJsonBytes(bytes: Uint8Array, source: string): unknown {
  try { return JSON.parse(decodeUtf8(bytes, source)); }
  catch (error) { throw new Error(`${source}: invalid JSON: ${String(error)}`); }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetchBounded(url, {
    maxBytes: MAX_ISSUE_PAGE_BYTES,
    timeoutMs: JSON_FETCH_TIMEOUT_MS,
  });
  if (response.bytes === null) throw new Error(`${url}: internal JSON buffer error`);
  return parseJsonBytes(response.bytes, url);
}

function readBoundedCache(path: string, maxBytes: number): Uint8Array {
  const state = lstatSync(path);
  if (!state.isFile() || state.isSymbolicLink()) throw new Error(`${path}: unsafe cache entry`);
  if (state.size > maxBytes) throw new Error(`${path}: cache byte limit exceeded (${maxBytes})`);
  const bytes = readFileSync(path);
  if (bytes.byteLength > maxBytes) throw new Error(`${path}: cache byte limit exceeded (${maxBytes})`);
  return bytes;
}

/** Same-directory rename is the cache commit point; failed downloads never become readable data. */
function writeCacheAtomically(path: string, bytes: string | Uint8Array): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Provenance over the exact bytes consumed, not a re-serialized approximation. */
export function readManifestProvenance(path: string): {
  instances: string[];
  sha256: string;
} {
  const bytes = readFileSync(path);
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch (error) { throw new Error(`${path}: invalid manifest JSON: ${String(error)}`); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path}: manifest must be an object`);
  }
  const row = parsed as Record<string, unknown>;
  if (row["qderive"] !== QDERIVE_VERSION) {
    throw new Error(`${path}: manifest qderive must be ${QDERIVE_VERSION}`);
  }
  if (!Array.isArray(row["instances"]) || row["instances"].length === 0 ||
      !row["instances"].every((id) => typeof id === "string" && id.length > 0)) {
    throw new Error(`${path}: manifest instances must be a nonempty string array`);
  }
  const instances = [...row["instances"]] as string[];
  if (new Set(instances).size !== instances.length) {
    throw new Error(`${path}: manifest instance IDs must be unique`);
  }
  return { instances, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** SHA-256 over the exact source bytes consumed by qderive/hderive and the instance join. */
export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readSourceProvenance(): CommonPayload["sourceSha256"] {
  return {
    benchmarkJsonl: sha256File(`${CACHE}/bench.final.public.jsonl`),
    verifiedIssues: sha256File(`${CACHE}/issues-verified.json`),
    multilingualIssues: sha256File(`${CACHE}/issues-multilingual.json`),
  };
}

type IssueCollectionOptions = {
  pageSize?: number;
  maxPages?: number;
  maxRows?: number;
  fetchPage?: (url: string) => Promise<unknown>;
};

/** Page a split under independent page and row ceilings; hitting either is a hard failure. */
async function collectIssueRows(
  dataset: string,
  options: IssueCollectionOptions = {},
): Promise<Issue[]> {
  const pageSize = options.pageSize ?? ISSUE_PAGE_SIZE;
  const maxPages = options.maxPages ?? MAX_ISSUE_PAGES;
  const maxRows = options.maxRows ?? MAX_ISSUE_ROWS;
  const fetchPage = options.fetchPage ?? fetchJson;
  if (![pageSize, maxPages, maxRows].every((limit) => Number.isSafeInteger(limit) && limit > 0)) {
    throw new Error("issue pagination needs positive integer limits");
  }
  const rows: Issue[] = [];
  for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
    const offset = pageIndex * pageSize;
    const raw = await fetchPage(
      `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=default&split=test&offset=${offset}&length=${pageSize}`,
    );
    if (typeof raw !== "object" || raw === null || Array.isArray(raw) ||
        !Array.isArray((raw as Record<string, unknown>)["rows"])) {
      throw new Error(`${dataset}: malformed issue page at offset ${offset}`);
    }
    const page = (raw as { rows: unknown[] }).rows;
    if (page.length > pageSize) {
      throw new Error(`${dataset}: issue page exceeded requested row count at offset ${offset}`);
    }
    for (const item of page) {
      if (typeof item !== "object" || item === null || Array.isArray(item) ||
          typeof (item as Record<string, unknown>)["row"] !== "object" ||
          (item as Record<string, unknown>)["row"] === null ||
          Array.isArray((item as Record<string, unknown>)["row"])) {
        throw new Error(`${dataset}: malformed issue row at offset ${offset}`);
      }
      if (rows.length >= maxRows) {
        throw new Error(`${dataset}: issue row limit exceeded (${maxRows})`);
      }
      const row = (item as { row: Record<string, unknown> }).row;
      rows.push({
        instance_id: String(row["instance_id"]),
        repo: String(row["repo"]),
        base_commit: String(row["base_commit"]),
        problem_statement: String(row["problem_statement"] ?? ""),
      });
    }
    if (page.length < pageSize) return rows;
  }
  throw new Error(`${dataset}: issue page limit exceeded (${maxPages})`);
}

function parseCachedIssues(cache: string): Issue[] {
  const parsed = parseJsonBytes(readBoundedCache(cache, MAX_ISSUE_CACHE_BYTES), cache);
  if (!Array.isArray(parsed) || parsed.length > MAX_ISSUE_ROWS) {
    throw new Error(`${cache}: cached issue row limit exceeded or invalid`);
  }
  return parsed.map((value, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`${cache}: invalid cached issue row ${index}`);
    }
    const row = value as Record<string, unknown>;
    for (const field of ["instance_id", "repo", "base_commit", "problem_statement"] as const) {
      if (typeof row[field] !== "string") {
        throw new Error(`${cache}: invalid cached issue row ${index}.${field}`);
      }
    }
    return row as Issue;
  });
}

async function fetchIssues(dataset: string, cacheName: string): Promise<Map<string, Issue>> {
  const cache = `${CACHE}/${cacheName}`;
  if (existsSync(cache)) {
    const rows = parseCachedIssues(cache);
    return new Map(rows.map((r) => [r.instance_id, r]));
  }
  const rows = await collectIssueRows(dataset);
  writeCacheAtomically(cache, JSON.stringify(rows));
  return new Map(rows.map((r) => [r.instance_id, r]));
}

/**
 * Download and extract the repo snapshot; returns the checkout root or null (skip, counted).
 *
 * The budget is enforced on bytes actually read, not on Content-Length — GitHub's archive
 * endpoint streams chunked responses with no length header, so a header check alone would
 * enforce nothing (review finding). Extraction lands in a `.tmp` directory promoted only on
 * success: an interrupted run must not leave a half-extracted tree that a later run silently
 * scores as the repository (review finding).
 *
 * `droppedLinks` is how many symlink members this checkout's archive omitted. It is recorded in a
 * sidecar beside the checkout — not inside it, which would put a file into the searched tree —
 * so a cached repository still reports it and the published count does not silently depend on
 * whether the cache was warm.
 */
async function fetchRepo(
  issue: Issue,
  budgetMb: number,
): Promise<{ root: string; droppedLinks: number } | null> {
  const coordinates = safeArchiveCoordinates(
    issue.instance_id, issue.repo, issue.base_commit, budgetMb,
  );
  if (!coordinates) return null;
  const dir = join(CACHE, "checkouts", coordinates.cacheKey);
  if (existsSync(dir)) {
    const cacheState = lstatSync(dir);
    if (!cacheState.isDirectory() || cacheState.isSymbolicLink()) {
      throw new Error(`unsafe repository cache entry: ${dir}`);
    }
    const entries = readdirSync(dir);
    if (entries.length === 1 && lstatSync(join(dir, entries[0]!)).isDirectory()) {
      return { root: join(dir, entries[0]!), droppedLinks: readDroppedLinks(dir) };
    }
  }
  const tmp = `${dir}.tmp`;
  const archive = `${dir}.tar.gz.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  rmSync(archive, { force: true });
  mkdirSync(tmp, { recursive: true, mode: 0o700 });
  chmodSync(tmp, 0o700);
  const budget = budgetMb * 1024 * 1024;
  const url = `https://github.com/${coordinates.repo}/archive/${coordinates.commit}.tar.gz`;
  let ok = false;
  let droppedLinks = 0;
  writeFileSync(archive, "", { mode: 0o600 });
  chmodSync(archive, 0o600);
  const writer = Bun.file(archive).writer();
  let writerClosed = false;
  try {
    // Over budget, an HTTP error, or a stalled download all throw here and skip the instance,
    // exactly as an oversized archive always has; none of them can hang the run.
    await fetchBounded(url, {
      maxBytes: budget,
      timeoutMs: ARCHIVE_FETCH_TIMEOUT_MS,
      redirect: "follow",
      onChunk: (chunk) => { writer.write(chunk); },
    });
    await writer.end();
    writerClosed = true;
    droppedLinks = await extractSafeArchive(archive, tmp, {
      expandedBytes: budget,
      members: MAX_ARCHIVE_MEMBERS,
      depth: MAX_ARCHIVE_DEPTH,
    });
    ok = true;
  } catch (error) {
    console.error(`archive rejected for ${issue.instance_id}: ${String(error).slice(0, 300)}`);
  } finally {
    if (!writerClosed) {
      try { await writer.end(); } catch {}
    }
    rmSync(archive, { force: true });
  }
  if (!ok) {
    rmSync(tmp, { recursive: true, force: true });
    return null;
  }
  const entries = readdirSync(tmp);
  if (entries.length !== 1 || !lstatSync(join(tmp, entries[0]!)).isDirectory()) {
    rmSync(tmp, { recursive: true, force: true });
    return null;
  }
  renameSync(tmp, dir);
  writeFileSync(droppedLinksPath(dir), JSON.stringify({ droppedLinks }), { mode: 0o600 });
  return { root: join(dir, entries[0]!), droppedLinks };
}

/** Sidecar path for a checkout's dropped-member count — beside the tree, never inside it. */
function droppedLinksPath(checkoutDir: string): string {
  return `${checkoutDir}.links.json`;
}

/**
 * What a cached checkout omitted, or -1 when the cache predates the sidecar.
 *
 * -1 rather than 0: "we do not know" and "nothing was dropped" are different claims, and this
 * project's whole complaint about itself is publishing the second when it means the first.
 */
function readDroppedLinks(checkoutDir: string): number {
  const path = droppedLinksPath(checkoutDir);
  if (!existsSync(path)) return -1;
  try {
    const value = (JSON.parse(readFileSync(path, "utf8")) as { droppedLinks?: unknown }).droppedLinks;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : -1;
  } catch {
    return -1;
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const argv = Bun.argv.slice(2);

  if (argv.includes("--selftest")) {
    const eq = (a: unknown, b: unknown, m: string) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    };

    // Language from gold files: majority extension wins, unknown extensions do not vote.
    eq(instanceLanguage(["a/b.py", "c/d.py", "e/f.go"]), "python", "majority language");
    eq(instanceLanguage(["x.go"]), "go", "single gold file");
    eq(instanceLanguage(["README", "LICENSE"]), "other", "no extension, no vote");
    eq(instanceLanguage(["a.ts", "b.js"]), "js/ts", "ts and js pool");

    // Remote archive coordinates must be harmless before cache cleanup or fetch construction.
    const commit = "a".repeat(40);
    const instance = ["astropy", "astropy-12907"].join("__");
    const acceptedCoordinates = safeArchiveCoordinates(instance, "astropy/astropy", commit, 500);
    if (!acceptedCoordinates) throw new Error("live SWE-bench coordinate shape must be accepted");
    eq([acceptedCoordinates.repo, acceptedCoordinates.commit], ["astropy/astropy", commit], "archive source is preserved");
    if (!/^[0-9a-f]{64}$/.test(acceptedCoordinates.cacheKey)) {
      throw new Error("archive cache key must be a SHA-256 coordinate digest");
    }
    eq(acceptedCoordinates.cacheKey, safeArchiveCoordinates(instance, "astropy/astropy", commit, 500)?.cacheKey, "cache key is stable");
    if (acceptedCoordinates.cacheKey === safeArchiveCoordinates(instance, "astropy/astropy", "b".repeat(40), 500)?.cacheKey) {
      throw new Error("a changed source commit must not reuse a stale checkout cache");
    }
    if (acceptedCoordinates.cacheKey === safeArchiveCoordinates(instance, "astropy/astropy", commit, 501)?.cacheKey) {
      throw new Error("a changed archive budget must not reuse a larger cached checkout");
    }
    eq(
      safeArchiveCoordinates("../../victim", "astropy/astropy", commit, 500),
      null,
      "cache traversal is rejected",
    );
    eq(
      safeArchiveCoordinates("safe", "astropy/../../victim", commit, 500),
      null,
      "repo traversal is rejected",
    );
    eq(
      safeArchiveCoordinates("safe", "astropy/astropy", "main", 500),
      null,
      "non-SHA commit is rejected",
    );
    eq(
      safeArchiveCoordinates("safe", "astropy/astropy", commit, 0),
      null,
      "invalid archive budget is rejected",
    );

    eq(
      safeRepoRelativePath("src/query/parser.ts"),
      "src/query/parser.ts",
      "repo-relative gold path is accepted",
    );
    eq(
      safeRepoRelativePath("src/../parser.ts"),
      "parser.ts",
      "contained path is normalized",
    );
    eq(
      safeRepoRelativePath("../../outside-secret"),
      null,
      "gold path traversal is rejected",
    );
    eq(safeRepoRelativePath("/etc/passwd"), null, "absolute gold path is rejected");
    eq(
      safeRepoRelativePath("src\\..\\outside-secret"),
      null,
      "platform-specific separator traversal is rejected",
    );

    // The derivation rule, on hand-built issues. Backticks outrank prose identifiers.
    eq(
      deriveQueries("`combine_by_coords` drops attrs", "calling `xr.combine_by_coords(datasets)` loses `dataset_attrs` info"),
      ["combine_by_coords", "xr.combine_by_coords", "datasets", "dataset_attrs"],
      "backticked tokens, split, deduped case-insensitively, order kept",
    );
    eq(
      deriveQueries("DataFrame.to_csv writes wrong line_terminator", ""),
      ["DataFrame.to_csv", "line_terminator"],
      "prose identifiers need a case transition, underscore or dot",
    );
    eq(deriveQueries("a bug in the code", "it should return the expected result"), [], "pure English derives nothing");
    eq(deriveQueries("x", "").length, 0, "too short");
    const five = deriveQueries("`a_1` `b_2` `c_3` `d_4` `e_5` `f_6`", "");
    eq(five.length, 5, "capped at five");
    // Determinism is the whole point of a fixed rule.
    eq(deriveQueries("`foo_bar` baz", "camelCase here"), deriveQueries("`foo_bar` baz", "camelCase here"), "deterministic");
    // qderive-v1 is the control and must stay exactly as it was when hints are added. This fixture
    // exercises code-span priority, case-insensitive deduplication, prose fallback, and the cap.
    eq(
      deriveQueries(
        "`PrimaryThing` and `secondary_id`",
        "PrimaryThing repeats; pkg.member and camelCase then `third_token` `fourth_token` `fifth_token`",
      ),
      ["PrimaryThing", "secondary_id", "third_token", "fourth_token", "fifth_token"],
      "qderive-v1 regression fixture is unchanged",
    );

    eq(
      deriveHints(
        "`combine_by_coords` drops attrs",
        "calling `xr.combine_by_coords(datasets)` loses `dataset_attrs` and camelCase info",
        "COMBINE_BY_COORDS",
      ),
      ["xr.combine_by_coords", "datasets", "dataset_attrs", "camelCase"],
      "hderive excludes the primary query case-insensitively and keeps first occurrence",
    );
    eq(
      deriveHints("`a_1` `b_2` `c_3` `d_4` `e_5` `f_6` `g_7` `h_8` `i_9`", "", "e_5"),
      ["a_1", "b_2", "c_3", "d_4", "f_6", "g_7", "h_8", "i_9"],
      "hderive fills all eight slots after excluding the primary",
    );
    eq(
      deriveHints("camelCase appears before `later_token`", "", "primary_id"),
      ["camelCase", "later_token"],
      "hderive preserves first occurrence across prose and code spans",
    );
    eq(deriveHints("a bug in the code", "it should return the expected result", "anything"), [], "hderive ignores prose noise");

    // Instance aggregation: best query wins; an instance with no hits is all zeros.
    const archiveRoot = mkdtempSync(join(tmpdir(), "hay-swe-archive-"));
    try {
      const source = join(archiveRoot, "source");
      const extracted = join(archiveRoot, "extracted");
      mkdirSync(join(source, "root"), { recursive: true });
      mkdirSync(extracted, { mode: 0o700 });
      writeFileSync(join(source, "root", "small.txt"), "safe");
      const goodArchive = join(archiveRoot, "good.tar.gz");
      await createTar({ cwd: source, file: goodArchive, gzip: true }, ["root"]);
      await extractSafeArchive(goodArchive, extracted, { expandedBytes: 1024, members: 10, depth: 4 });
      eq(await Bun.file(join(extracted, "root/small.txt")).text(), "safe", "safe archive extracts");
      if (process.platform !== "win32") {
        eq(lstatSync(extracted).mode & 0o777, 0o700, "archive extraction state is private");
      }

      const fileEntry = { type: "File", size: 0 } as unknown as ReadEntry;
      let guard = archiveEntryGuard({ expandedBytes: 10, members: 10, depth: 4 });
      eq(guard("../escape", fileEntry), false, "archive traversal is rejected");
      guard = archiveEntryGuard({ expandedBytes: 10, members: 10, depth: 1 });
      eq(guard("root/nested", fileEntry), false, "archive path depth is bounded");
      guard = archiveEntryGuard({ expandedBytes: 10, members: 1, depth: 4 });
      eq(guard("first", fileEntry), true, "first archive member is admitted");
      eq(guard("second", fileEntry), false, "archive member count is bounded");
      guard = archiveEntryGuard({ expandedBytes: 10, members: 10, depth: 4 });
      eq(
        guard("link", { type: "SymbolicLink", size: 0 } as unknown as ReadEntry),
        false,
        "special archive entry types are rejected",
      );
      const bombSource = join(archiveRoot, "bomb-source");
      const bombDest = join(archiveRoot, "bomb-dest");
      mkdirSync(join(bombSource, "root"), { recursive: true });
      mkdirSync(bombDest, { mode: 0o700 });
      writeFileSync(join(bombSource, "root", "bomb"), Buffer.alloc(2 * 1024 * 1024));
      const bombArchive = join(archiveRoot, "bomb.tar.gz");
      await createTar({ cwd: bombSource, file: bombArchive, gzip: true }, ["root"]);
      let rejection = "";
      try {
        await extractSafeArchive(bombArchive, bombDest, { expandedBytes: 64 * 1024, members: 10, depth: 4 });
      } catch (error) { rejection = String(error); }
      eq(
        rejection.includes("archive expanded-byte limit exceeded"),
        true,
        "gzip bomb aborts at the expanded-byte limit",
      );
      eq(existsSync(join(bombDest, "root/bomb")), false, "rejected archive member is never written");
      const ratioDest = join(archiveRoot, "ratio-dest");
      mkdirSync(ratioDest, { mode: 0o700 });
      let rejected = false;
      try {
        await extractSafeArchive(bombArchive, ratioDest, {
          expandedBytes: 4 * 1024 * 1024, members: 10, depth: 4,
        });
      } catch { rejected = true; }
      eq(rejected, true, "gzip bomb exceeds decompression-ratio limit");

      if (process.platform !== "win32") {
        const linkSource = join(archiveRoot, "link-source");
        const linkDest = join(archiveRoot, "link-dest");
        mkdirSync(join(linkSource, "root"), { recursive: true });
        mkdirSync(linkDest, { mode: 0o700 });
        symlinkSync("/tmp", join(linkSource, "root/link"));
        const linkArchive = join(archiveRoot, "link.tar.gz");
        await createTar({ cwd: linkSource, file: linkArchive, gzip: true }, ["root"]);
        // A link must never reach disk, and must not cost us the rest of the archive: the guard
        // drops it and extraction completes. Both halves are asserted — dropping it silently
        // while still writing it would pass a test that only checked the exit path.
        await extractSafeArchive(linkArchive, linkDest, { expandedBytes: 1024, members: 10, depth: 4 });
        eq(existsSync(join(linkDest, "root/link")), false, "an archive link is never written");
        const guardedLinks = archiveEntryGuard({ expandedBytes: 1024, members: 10, depth: 4 });
        eq(guardedLinks("root/link", { type: "SymbolicLink", size: 0 } as unknown as ReadEntry), false, "a link member is filtered out");
        eq(guardedLinks.violation(), null, "a dropped link does not fail the archive");
        eq(guardedLinks.skipped(), 1, "dropped links are counted, never absorbed");
        // A HARD link is an ordinary file to ripgrep: dropping one would put a hole in the
        // measured tree, so it fails the archive instead of being skipped.
        const guardedHard = archiveEntryGuard({ expandedBytes: 1024, members: 10, depth: 4 });
        eq(guardedHard("root/hard", { type: "Link", size: 0 } as unknown as ReadEntry), false, "a hard link is not extracted");
        eq(guardedHard.violation(), "unsupported archive entry type", "a hard link fails the archive");
        eq(guardedHard.skipped(), 0, "a hard link is not counted as a dropped link");
      }
    } finally {
      rmSync(archiveRoot, { recursive: true, force: true });
    }

    const q = (rr: number, top10: number, ndcg: number): QueryResult => ({ rr, top10, ndcg, truncated: false, results: 1 });
    eq(bestOf([q(0, 0, 0), q(0.5, 1, 0.4)]), { rr: 0.5, top10: 1, ndcg: 0.4 }, "best of queries");
    eq(bestOf([]), { rr: 0, top10: 0, ndcg: 0 }, "no queries, zero score");

    // The hints experiment is paired at query level. Independent per-arm best-of would be a
    // different estimand and can manufacture an apparent treatment effect from different queries.
    const observation = (
      instanceId: string, baselineRr: number, hintedRr: number,
    ): HintObservation => ({
      instanceId, hintCount: 1,
      baseline: { rr: baselineRr, top10: baselineRr > 0 ? 1 : 0, ndcg: baselineRr, truncated: false, results: 1, pageComplete: true },
      hinted: { rr: hintedRr, top10: hintedRr > 0 ? 1 : 0, ndcg: hintedRr, truncated: false, results: 1, pageComplete: true },
    });
    const paired = hintEffect([
      observation("one", 0, 1), observation("one", 1, 0), observation("two", 0.5, 0.5),
    ], "rr");
    eq([paired.better, paired.worse, paired.tied], [1, 1, 1], "paired direction counts use every query");
    eq([paired.byQuery.n, paired.byQuery.clusters], [3, 3], "query interval has one group per query");
    eq([paired.byInstanceCluster.n, paired.byInstanceCluster.clusters], [3, 2], "cluster interval keeps queries inside instances");
    eq(paired.baselineMean, paired.hintedMean, "opposing paired effects cancel without best-of selection");
    const cappedObservation = observation("capped", 0, 1);
    cappedObservation.hinted.truncated = true;
    eq(hintObservationIsComplete(cappedObservation), false, "candidate-capped pairs are incomplete");
    eq(hintObservationIsComplete(observation("complete", 0, 1)), true, "complete pairs remain eligible");

    const zeroInterval: Interval = { mean: 0, lo: 0, hi: 0, p: 1, n: 1, clusters: 1 };
    const zeroHintEffect: HintEffect = {
      baselineMean: 0, hintedMean: 0, better: 0, worse: 0, tied: 1,
      byQuery: zeroInterval, randomizationByQuery: 1,
      byInstanceCluster: zeroInterval, randomizationByInstanceCluster: 1,
    };
    const common = {
      benchmark: "fixture", claim: "fixture", qderive: QDERIVE_VERSION, seed: SEED,
      sourceSha256: {
        benchmarkJsonl: "b".repeat(64), verifiedIssues: "c".repeat(64),
        multilingualIssues: "d".repeat(64),
      },
      manifestPath: "evidence/fixture-manifest.json", manifestSha256: "a".repeat(64),
      manifestInstanceIds: ["one"] as string[], instances: 1, queries: 1, byLanguage: { python: 1 },
      excluded: { noPublicIssueText: 0, repoSkipped: 0, noDerivableQueries: 0, noVisibleGold: 0 },
      archiveLinkMembersDropped: 0, checkoutsWithUnrecordedDrops: 0,
      toolVersions: { hay: "hay fixture", rg: "ripgrep fixture" },
      toolSha256: { hay: "e".repeat(64), rg: "f".repeat(64) },
    } as const;
    const validHints: HintComparisonPayload = {
      ...common, mode: "compare-hints", hderive: HDERIVE_VERSION, hayAblation: [],
      archiveBudgetMb: CANONICAL_HINT_BUDGET_MB, scoredInstanceIds: ["one"],
      sampleExclusions: { repoSkipped: [], noDerivableQueries: [], noVisibleGold: [] },
      primaryContrast: "paired-query", statisticalReplicates: 10_000,
      validatedPairs: 1, validatedInstances: 1, zeroHintQueries: 0,
      incompletePairs: { candidateCap: 0, pageTruncated: 0, total: 0 },
      candidateCapQueries: { baseline: 0, hinted: 0 },
      pageTruncatedQueries: { baseline: 0, hinted: 0 },
      mrr: zeroHintEffect, top10: zeroHintEffect, ndcg10: zeroHintEffect,
    };
    eq(validateSwePayload(validHints).mode, "compare-hints", "valid hint payload passes");
    let rejectedPayloads = 0;
    for (const malformed of [
      { ...validHints, benchmark: "" },
      { ...validHints, mrr: { ...zeroHintEffect, hintedMean: Number.NaN } },
      { ...validHints, queries: 2 },
      { ...validHints, sourceSha256: { ...validHints.sourceSha256, verifiedIssues: "A".repeat(64) } },
      { ...validHints, sourceSha256: { ...validHints.sourceSha256, extra: "e".repeat(64) } },
      { ...validHints, archiveBudgetMb: 1 },
      { ...validHints, scoredInstanceIds: ["other"] },
      { ...validHints, validatedPairs: 0 },
      { ...validHints, incompletePairs: { candidateCap: 0, pageTruncated: 0, total: 1 } },
      {
        ...validHints, queries: 2,
        incompletePairs: { candidateCap: 0, pageTruncated: 0, total: 1 },
      },
      {
        ...validHints, queries: 2,
        incompletePairs: { candidateCap: 1, pageTruncated: 0, total: 1 },
      },
    ]) {
      try { validateSwePayload(malformed); } catch { rejectedPayloads++; }
    }
    eq(rejectedPayloads, 11, "malformed, incomplete, count-inconsistent, unpinned, or repartitioned evidence fails closed");

    const zeroBaselineEffect: BaselineEffect = { byInstance: zeroInterval, randomizationByInstance: 1 };
    const validBaseline: BaselinePayload = {
      ...common, mode: "baseline", hderive: HDERIVE_VERSION, hayAblation: [],
      mrrRg: 0, mrrHay: 0, top10Rg: 0, top10Hay: 0, ndcg10Rg: 0, ndcg10Hay: 0,
      deltaMrr: zeroBaselineEffect, deltaTop10: zeroBaselineEffect,
      deltaNdcg10: zeroBaselineEffect, hayTruncatedQueries: 0,
    };
    eq(validateSwePayload(validBaseline).mode, "baseline", "valid baseline payload passes the same boundary");

    const manifestRoot = mkdtempSync(join(tmpdir(), "hay-swe-manifest-"));
    try {
      const path = join(manifestRoot, "instances.json");
      const exact = '{\n  "qderive": "qderive-v1",\n  "instances": ["second", "first"]\n}\n';
      writeFileSync(path, exact);
      const provenance = readManifestProvenance(path);
      eq(provenance.instances, ["second", "first"], "manifest ID order is preserved");
      eq(
        provenance.sha256,
        createHash("sha256").update(Buffer.from(exact)).digest("hex"),
        "manifest hash covers the exact bytes",
      );
      eq(
        sha256File(path),
        createHash("sha256").update(Buffer.from(exact)).digest("hex"),
        "source provenance hashes exact file bytes",
      );
    } finally {
      rmSync(manifestRoot, { recursive: true, force: true });
    }

    // The ablation guard must not be defeatable by spelling the published path differently —
    // a check that only rejects one spelling is not a check.
    eq(namesTheSameFile(PUBLISHED_EVIDENCE, `./${PUBLISHED_EVIDENCE}`), true, "the same file by another spelling");
    eq(namesTheSameFile(PUBLISHED_EVIDENCE, "evidence/benchmark.json"), false, "different files are different");
    eq(namesTheSameFile("evidence/nonexistent-a.json", "evidence/nonexistent-b.json"), false, "two paths that do not exist yet");
    eq(namesTheSameFile("evidence/nonexistent-a.json", "./evidence/../evidence/nonexistent-a.json"), true, "same not-yet-created file");
    // A DANGLING symlink aimed at the published path: `existsSync` follows links, so both
    // existence checks fail and a basename comparison would wave the ablation through — after
    // which the write follows the link onto the file the guard exists to protect.
    {
      const linkDir = mkdtempSync(join(tmpdir(), "hay-outlink-"));
      const dangling = join(linkDir, "ablation.json");
      try {
        symlinkSync(resolve("evidence/does-not-exist-yet.json"), dangling);
        eq(namesTheSameFile(dangling, "evidence/does-not-exist-yet.json"), true, "a dangling symlink to the target is the same file");
        eq(namesTheSameFile(dangling, "evidence/benchmark.json"), false, "a dangling symlink elsewhere is not");
      } finally {
        rmSync(linkDir, { recursive: true, force: true });
      }
    }

    console.log("selftest ok");
    process.exit(0);
  }

  const flag = (name: string, dflt: string): string => {
    const i = argv.indexOf(name);
    if (i === -1) return dflt;
    const value = argv[i + 1];
    if (value === undefined) {
      console.error(`${name} needs a value`);
      process.exit(2);
    }
    return value;
  };
  const sampleSize = Number(flag("--sample", "100"));
  const budgetMb = Number(flag("--budget-mb", "500"));
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 1) {
    console.error("--sample must be a positive integer");
    process.exit(2);
  }
  if (!Number.isSafeInteger(budgetMb) || budgetMb < 1 || budgetMb > MAX_ARCHIVE_BUDGET_MB) {
    console.error(`--budget-mb must be an integer from 1 to ${MAX_ARCHIVE_BUDGET_MB}`);
    process.exit(2);
  }
  const perLang = 20;
  const compareHints = argv.includes("--compare-hints");
  // Ablation: `--ablate no-filename,no-word` turns hay signals off on the one public, agent-shaped
  // set this project has. It writes its own `--out`, never `evidence/swe-explore.json`, and the
  // flags go into the payload — an ablation must not be able to impersonate the headline run.
  const ablate = flag("--ablate", "").split(",").filter(Boolean);
  const outPath = flag("--out", compareHints ? HINTS_EVIDENCE : PUBLISHED_EVIDENCE);
  if (compareHints) requireHintSignalBinary();
  if (compareHints && ablate.length > 0) {
    console.error("--compare-hints is incompatible with --ablate: the control must be current hay");
    process.exit(2);
  }
  if (compareHints && argv.includes("--resample")) {
    console.error("--compare-hints uses the committed headline manifest and cannot resample it");
    process.exit(2);
  }
  if (compareHints && budgetMb !== CANONICAL_HINT_BUDGET_MB) {
    console.error(`--compare-hints fixes --budget-mb at ${CANONICAL_HINT_BUDGET_MB}`);
    process.exit(2);
  }
  if (compareHints && namesTheSameFile(outPath, PUBLISHED_EVIDENCE)) {
    console.error("--compare-hints cannot overwrite the headline rg-versus-hay evidence");
    process.exit(2);
  }
  if (ablate.length > 0) {
    setHayFlags(ablate.map((f) => `--${f}`));
    if (namesTheSameFile(outPath, PUBLISHED_EVIDENCE)) {
      console.error("--ablate needs its own --out: an ablation is not the published run");
      process.exit(2);
    }
  }

  mkdirSync(`${CACHE}/checkouts`, { recursive: true });
  const benchCache = `${CACHE}/bench.final.public.jsonl`;
  if (!existsSync(benchCache)) {
    console.error(`downloading instance list to ${CACHE} ...`);
    const response = await fetchBounded(BENCH_URL, {
      maxBytes: MAX_BENCHMARK_BYTES,
      timeoutMs: JSON_FETCH_TIMEOUT_MS,
      redirect: "follow",
    });
    if (response.bytes === null) throw new Error(`${BENCH_URL}: internal buffer error`);
    writeCacheAtomically(benchCache, response.bytes);
  }
  const benchLines = decodeUtf8(readBoundedCache(benchCache, MAX_BENCHMARK_BYTES), benchCache)
    .split("\n").filter(Boolean);
  if (benchLines.length > MAX_BENCHMARK_ROWS) {
    throw new Error(`${benchCache}: ${benchLines.length} rows exceeds ${MAX_BENCHMARK_ROWS}`);
  }
  const instances: Instance[] = benchLines.map((line) => JSON.parse(line) as Instance);

  console.error("fetching issue text (SWE-bench Verified + Multilingual) ...");
  const issues = new Map<string, Issue>([
    ...(await fetchIssues("princeton-nlp/SWE-bench_Verified", "issues-verified.json")),
    ...(await fetchIssues("SWE-bench/SWE-bench_Multilingual", "issues-multilingual.json")),
  ]);
  const sourceSha256 = readSourceProvenance();
  const hayBinaryPath = new URL("./hay/target/release/hay", import.meta.url).pathname;
  const rgBinaryPath = Bun.which("rg");
  if (rgBinaryPath === null) throw new Error("rg is required for benchmark provenance");
  const toolSha256 = { hay: sha256File(hayBinaryPath), rg: sha256File(rgBinaryPath) };

  // Candidates: instances whose issue text is public. `pro` instances are excluded here — their
  // issue text is not in either public source — and the exclusion is counted below.
  const candidates = instances.filter((i) => issues.has(i.instance_id));
  const excludedNoIssue = instances.length - candidates.length;

  // A committed manifest wins over resampling: the reproducibility claim is "a rerun scores
  // exactly the committed instance set", and a seeded shuffle over an UNPINNED upstream file
  // cannot deliver that — an upstream addition would shift the whole sample (review finding).
  // Pass --resample to draw a fresh seeded sample and overwrite the manifest.
  const manifestPath = "evidence/swe-explore-instances.json";
  const resample = argv.includes("--resample");
  if (!resample && !existsSync(manifestPath)) {
    console.error(`${manifestPath} is missing; pass --resample to select and record instances before scoring`);
    process.exit(2);
  }
  let sampled: Instance[];
  let manifestInstanceIds: string[];
  if (!resample) {
    const manifest = readManifestProvenance(manifestPath);
    manifestInstanceIds = manifest.instances;
    const byId = new Map(candidates.map((i) => [i.instance_id, i]));
    sampled = manifestInstanceIds.flatMap((id) => byId.get(id) ?? []);
    console.error(`scoring the committed manifest: ${sampled.length} of ${manifestInstanceIds.length} instances resolvable`);
    if (sampled.length < manifestInstanceIds.length) {
      console.error("some committed manifest instances are no longer resolvable upstream; refusing to publish a different sample");
      process.exit(2);
    }
  } else {
    // Seeded stratified sample: shuffle once, then take up to `perLang` per language.
    const rand = mulberry32(SEED);
    const shuffled = [...candidates];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const perLangCount = new Map<string, number>();
    sampled = [];
    for (const inst of shuffled) {
      if (sampled.length >= sampleSize) break;
      const lang = instanceLanguage(inst.ground_truth.read_core_files);
      if (lang === "other") continue;
      const n = perLangCount.get(lang) ?? 0;
      if (n >= perLang) continue;
      perLangCount.set(lang, n + 1);
      sampled.push(inst);
    }
    await Bun.write(
      manifestPath,
      JSON.stringify({ seed: SEED, qderive: QDERIVE_VERSION, instances: sampled.map((i) => i.instance_id) }, null, 2),
    );
    manifestInstanceIds = sampled.map((i) => i.instance_id);
    console.error(`recorded ${sampled.length} selected instances before scoring`);
  }
  const manifestProvenance = readManifestProvenance(manifestPath);
  if (JSON.stringify(manifestProvenance.instances) !== JSON.stringify(manifestInstanceIds)) {
    throw new Error("manifest changed while preparing the run");
  }

  type InstanceResult = {
    instance_id: string; lang: string; queries: number;
    rg: { rr: number; top10: number; ndcg: number };
    hay: { rr: number; top10: number; ndcg: number };
    hayTruncated: number;
  };
  const results: InstanceResult[] = [];
  const scoredInstances: { instance_id: string; lang: string; queries: number }[] = [];
  const hintObservations: HintObservation[] = [];
  let skippedRepo = 0, skippedNoQueries = 0, skippedNoGold = 0;
  const sampleExclusions = {
    repoSkipped: [] as string[],
    noDerivableQueries: [] as string[],
    noVisibleGold: [] as string[],
  };
  // Symlink members omitted from the measured trees. Published, because a counter only the
  // selftest can read is the defect this harness was just fixed for.
  let droppedLinkMembers = 0, checkoutsWithUnknownDrops = 0;

  for (const inst of sampled) {
    const issue = issues.get(inst.instance_id)!;
    const title = issue.problem_statement.split("\n", 1)[0] ?? "";
    const body = issue.problem_statement.slice(title.length);
    const queries = deriveQueries(title, body);
    if (queries.length === 0) {
      skippedNoQueries++;
      sampleExclusions.noDerivableQueries.push(inst.instance_id);
      continue;
    }

    const checkout = await fetchRepo(issue, budgetMb);
    if (!checkout) {
      skippedRepo++;
      sampleExclusions.repoSkipped.push(inst.instance_id);
      continue;
    }
    const root = checkout.root;
    // -1 means the cached checkout predates the sidecar, which is a different fact from zero.
    if (checkout.droppedLinks > 0) droppedLinkMembers += checkout.droppedLinks;
    else if (checkout.droppedLinks < 0) checkoutsWithUnknownDrops++;

    const gold = new Set(
      inst.ground_truth.read_core_files.flatMap((candidate) => {
        const safe = safeRepoRelativePath(candidate);
        return safe !== null && existsSync(join(root, safe)) ? [safe] : [];
      }),
    );
    if (gold.size === 0) {
      skippedNoGold++;
      sampleExclusions.noVisibleGold.push(inst.instance_id);
      continue;
    }

    const lang = instanceLanguage([...gold]);
    scoredInstances.push({ instance_id: inst.instance_id, lang, queries: queries.length });
    if (compareHints) {
      const start = hintObservations.length;
      for (const q of queries) {
        const hints = deriveHints(title, body, q);
        const extraFlags = hints.flatMap((hint) => ["--hint", hint]);
        const baseline = await rankOfAnswer(root, q, gold, "hay");
        const hinted = hints.length === 0
          ? baseline
          : await rankOfAnswer(root, q, gold, "hay", extraFlags);
        // A hint only re-scores lines; it cannot change which lines are visible. Arms that
        // disagree on that are a broken arm to refuse, not a difference to score (measure-mrr.ts
        // has the same guard; this loop lacked it).
        if ((baseline.scanned === 0) !== (hinted.scanned === 0)) {
          throw new Error(`${inst.instance_id}: paired hay arms disagreed on whether "${q}" had any visible matches`);
        }
        const score = (r: typeof baseline): QueryResult & { pageComplete: boolean } => ({
          rr: r.rank ? 1 / r.rank : 0,
          top10: r.rank !== null && r.rank <= 10 ? 1 : 0,
          ndcg: r.ndcg,
          truncated: r.truncated,
          results: r.scanned,
          pageComplete: r.pageComplete,
        });
        hintObservations.push({
          instanceId: inst.instance_id,
          hintCount: hints.length,
          baseline: score(baseline),
          hinted: score(hinted),
        });
      }
      const current = hintObservations.slice(start);
      console.error(
        `${inst.instance_id.padEnd(40)} ${lang.padEnd(8)} q=${queries.length}  ` +
        `hay rr=${mean(current.map((r) => r.baseline.rr)).toFixed(3)}  ` +
        `hinted rr=${mean(current.map((r) => r.hinted.rr)).toFixed(3)}`,
      );
    } else {
      const perQuery = { rg: [] as QueryResult[], hay: [] as QueryResult[] };
      for (const q of queries) {
        for (const retriever of ["rg", "hay"] as const) {
          const r = await rankOfAnswer(root, q, gold, retriever);
          perQuery[retriever].push({
            rr: r.rank ? 1 / r.rank : 0,
            top10: r.rank !== null && r.rank <= 10 ? 1 : 0,
            ndcg: r.ndcg,
            truncated: r.truncated,
            results: r.scanned,
          });
        }
      }
      results.push({
        instance_id: inst.instance_id, lang, queries: queries.length,
        rg: bestOf(perQuery.rg), hay: bestOf(perQuery.hay),
        hayTruncated: perQuery.hay.filter((r) => r.truncated).length,
      });
      console.error(
        `${inst.instance_id.padEnd(40)} ${lang.padEnd(8)} q=${queries.length}  ` +
        `rg rr=${results.at(-1)!.rg.rr.toFixed(3)}  hay rr=${results.at(-1)!.hay.rr.toFixed(3)}`,
      );
    }
  }

  if (scoredInstances.length === 0) {
    console.error("no instances scored; nothing to report");
    process.exit(1);
  }

  const manifestAfterScoring = readManifestProvenance(manifestPath);
  if (manifestAfterScoring.sha256 !== manifestProvenance.sha256 ||
      JSON.stringify(manifestAfterScoring.instances) !== JSON.stringify(manifestProvenance.instances)) {
    throw new Error("manifest changed during scoring; refusing to write mismatched evidence");
  }
  if (JSON.stringify(readSourceProvenance()) !== JSON.stringify(sourceSha256)) {
    throw new Error("benchmark or issue source bytes changed during scoring; refusing mismatched evidence");
  }
  if (sha256File(hayBinaryPath) !== toolSha256.hay || sha256File(rgBinaryPath) !== toolSha256.rg) {
    throw new Error("retriever binary changed during scoring; refusing mismatched evidence");
  }

  const byLang: Record<string, number> = {};
  for (const r of scoredInstances) byLang[r.lang] = (byLang[r.lang] ?? 0) + 1;
  const toolVersions = {
    hay: (await Bun.$`${hayBinaryPath} --version`.text()).trim(),
    rg: (await Bun.$`rg --version`.text()).split("\n")[0]!,
  };
  const common = {
    benchmark: "SWE-Explore-Bench (arXiv 2606.07297), verified + multilingual splits",
    qderive: QDERIVE_VERSION,
    seed: SEED,
    sourceSha256,
    manifestPath,
    manifestSha256: manifestProvenance.sha256,
    manifestInstanceIds: manifestProvenance.instances,
    instances: scoredInstances.length,
    queries: scoredInstances.reduce((sum, row) => sum + row.queries, 0),
    byLanguage: byLang,
    excluded: {
      noPublicIssueText: excludedNoIssue,
      repoSkipped: skippedRepo,
      noDerivableQueries: skippedNoQueries,
      noVisibleGold: skippedNoGold,
    },
    archiveLinkMembersDropped: droppedLinkMembers,
    checkoutsWithUnrecordedDrops: checkoutsWithUnknownDrops,
    toolVersions,
    toolSha256,
  } as const;

  let report: SwePayload;
  if (compareHints) {
    const completeObservations = hintObservations.filter(hintObservationIsComplete);
    if (completeObservations.length === 0) {
      throw new Error("every paired hint observation was incomplete; refusing to publish evidence");
    }
    const validatedInstanceIds = new Set(completeObservations.map((row) => row.instanceId));
    const candidateCapPairs = hintObservations.filter(
      (row) => row.baseline.truncated || row.hinted.truncated,
    ).length;
    const pageTruncatedPairs = hintObservations.filter(
      (row) => !row.baseline.pageComplete || !row.hinted.pageComplete,
    ).length;
    const mrr = hintEffect(completeObservations, "rr");
    const top10 = hintEffect(completeObservations, "top10");
    const ndcg10 = hintEffect(completeObservations, "ndcg");
    report = {
      ...common,
      mode: "compare-hints",
      claim: "on every complete qderive-v1 paired query, do hderive-v1 issue-text hints improve hay over the same hay baseline; capped or page-truncated pairs are excluded and gold and retrieval results never derive hints",
      hderive: HDERIVE_VERSION,
      hayAblation: [],
      archiveBudgetMb: CANONICAL_HINT_BUDGET_MB,
      scoredInstanceIds: scoredInstances.map((row) => row.instance_id),
      sampleExclusions,
      primaryContrast: "paired-query",
      statisticalReplicates: 10_000,
      validatedPairs: completeObservations.length,
      validatedInstances: validatedInstanceIds.size,
      zeroHintQueries: completeObservations.filter((r) => r.hintCount === 0).length,
      incompletePairs: {
        candidateCap: candidateCapPairs,
        pageTruncated: pageTruncatedPairs,
        total: hintObservations.length - completeObservations.length,
      },
      candidateCapQueries: {
        baseline: hintObservations.filter((r) => r.baseline.truncated).length,
        hinted: hintObservations.filter((r) => r.hinted.truncated).length,
      },
      pageTruncatedQueries: {
        baseline: hintObservations.filter((r) => !r.baseline.pageComplete).length,
        hinted: hintObservations.filter((r) => !r.hinted.pageComplete).length,
      },
      mrr, top10, ndcg10,
    };
    const show = (name: string, e: HintEffect) => console.error(
      `  ${name.padEnd(10)} ${e.baselineMean.toFixed(4)} -> ${e.hintedMean.toFixed(4)}  ` +
      `cluster 95% CI [${e.byInstanceCluster.lo.toFixed(4)}, ${e.byInstanceCluster.hi.toFixed(4)}]  ` +
      `rand p=${e.randomizationByInstanceCluster.toFixed(4)}  ` +
      `better/worse/tied=${e.better}/${e.worse}/${e.tied}`,
    );
    console.error(
      `\n${report.instances} scored instances · ${report.validatedPairs}/${report.queries} complete paired queries ` +
      `across ${report.validatedInstances} validated instances · ${report.incompletePairs.total} incomplete excluded`,
    );
    show("MRR", report.mrr);
    show("top-10", report.top10);
    show("nDCG@10", report.ndcg10);
  } else {
    const effect = (diff: (r: InstanceResult) => number): BaselineEffect => ({
      byInstance: bootstrapCI(results.map((r) => [diff(r)])),
      randomizationByInstance: randomizationP(results.map((r) => [diff(r)])),
    });
    report = {
      ...common,
      mode: "baseline",
      claim: "given identical mechanically-derived queries, does hay's reordering surface gold files earlier than rg's path order — this does not measure issue localization",
      // The version is provenance only in baseline mode; no hints are derived or passed.
      hderive: HDERIVE_VERSION,
      hayAblation: ablate,
      mrrRg: mean(results.map((r) => r.rg.rr)),
      mrrHay: mean(results.map((r) => r.hay.rr)),
      top10Rg: mean(results.map((r) => r.rg.top10)),
      top10Hay: mean(results.map((r) => r.hay.top10)),
      ndcg10Rg: mean(results.map((r) => r.rg.ndcg)),
      ndcg10Hay: mean(results.map((r) => r.hay.ndcg)),
      deltaMrr: effect((r) => r.hay.rr - r.rg.rr),
      deltaTop10: effect((r) => r.hay.top10 - r.rg.top10),
      deltaNdcg10: effect((r) => r.hay.ndcg - r.rg.ndcg),
      hayTruncatedQueries: results.reduce((sum, r) => sum + r.hayTruncated, 0),
    };
    const show = (name: string, e: BaselineEffect) => console.error(
      `  ${name.padEnd(10)} ${e.byInstance.mean >= 0 ? "+" : ""}${e.byInstance.mean.toFixed(4)}  ` +
      `95% CI [${e.byInstance.lo.toFixed(4)}, ${e.byInstance.hi.toFixed(4)}]  ` +
      `boot p=${e.byInstance.p.toFixed(4)}  rand p=${e.randomizationByInstance.toFixed(4)}  n=${e.byInstance.n}`,
    );
    console.error(`\n${report.instances} instances scored  ·  languages: ${JSON.stringify(byLang)}`);
    console.error(`  MRR      rg ${report.mrrRg.toFixed(4)}  ->  hay ${report.mrrHay.toFixed(4)}`);
    console.error(`  top-10   rg ${report.top10Rg.toFixed(4)}  ->  hay ${report.top10Hay.toFixed(4)}`);
    console.error(`  nDCG@10  rg ${report.ndcg10Rg.toFixed(4)}  ->  hay ${report.ndcg10Hay.toFixed(4)}`);
    show("dMRR", report.deltaMrr);
    show("dTop10", report.deltaTop10);
    show("dNDCG10", report.deltaNdcg10);
  }
  console.error(`  excluded: ${JSON.stringify(report.excluded)}`);

  const validated = validateSwePayload(report);
  await Bun.write(outPath, JSON.stringify(validated, null, 2));
  console.error(`\nwrote ${outPath} (all public data; sample manifest was not changed while scoring)`);
}
