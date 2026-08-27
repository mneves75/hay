#!/usr/bin/env bun
/**
 * swe-explore — hay versus ripgrep on a public, agent-shaped localization benchmark.
 *
 * THE CLAIM THIS TESTS, VERBATIM: given identical mechanically-derived queries, does hay's
 * reordering surface gold files earlier than ripgrep's path order? It does NOT measure issue
 * localization — deriving good queries from an issue is the agent's job, and the derivation rule
 * here is deliberately dumb, fixed, and versioned so no per-instance tuning can leak in.
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
 *   bun swe-explore.ts --selftest
 */

import {
  chmodSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync,
  renameSync, rmSync,
  symlinkSync, writeFileSync, type Stats,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, posix } from "node:path";
import { create as createTar, Unpack, type ReadEntry } from "tar";

import {
  ResultScan, bootstrapCI, mean, mulberry32, randomizationP, rankOfAnswer,
} from "./measure-mrr.ts";

const cacheHome = process.env["XDG_CACHE_HOME"] ?? join(homedir(), ".cache");
const CACHE = join(cacheHome, "hay", "corpora", "swe-explore");
const BENCH_URL = "https://huggingface.co/datasets/SWE-Explore-Bench/SWE-Explore-Bench/resolve/main/bench.final.public.jsonl";
const SEED = 20260820;
/** The derivation rule's identity. Bump it if the rule changes; results are not comparable across versions. */
export const QDERIVE_VERSION = "qderive-v1";

type Instance = {
  instance_id: string;
  dataset: string;
  ground_truth: { read_core_files: string[] };
};

type Issue = { instance_id: string; repo: string; base_commit: string; problem_statement: string };

type ArchiveCoordinates = { cacheKey: string; repo: string; commit: string };

/** Reject remote dataset fields before they can influence a cache path or archive URL. */
export function safeArchiveCoordinates(
  instanceId: string,
  repo: string,
  baseCommit: string,
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
  if (!cacheKeyOk || parts.length !== 2 || !ownerOk || !repoOk || !commitOk) {
    return null;
  }
  return { cacheKey: instanceId, repo, commit: baseCommit };
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

/** Words that are identifier-shaped but are just English or language noise. */
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

// ── remote archive boundary ───────────────────────────────────────────────────

const HTTP_USER_AGENT = "OpenAI File Downloader, XaiImageApiFetch/1.0";
const MAX_ARCHIVE_MEMBERS = 200_000;
const MAX_ARCHIVE_DEPTH = 64;
const MAX_DECOMPRESSION_RATIO = 200;

export type ArchiveLimits = { expandedBytes: number; members: number; depth: number };
type ArchiveGuard = ((path: string, entry: ReadEntry | Stats) => boolean) & {
  violation: () => string | null;
};

/** Validate every archive member before the maintained parser writes it to disk. */
export function archiveEntryGuard(limits: ArchiveLimits): ArchiveGuard {
  let members = 0, expandedBytes = 0, violation: string | null = null;
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
    if (entry.type !== "File" && entry.type !== "OldFile" && entry.type !== "Directory") {
      return reject("unsupported archive entry type");
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) return reject("invalid archive entry size");
    members++;
    if (members > limits.members) return reject("archive member limit exceeded");
    if (entry.size > limits.expandedBytes - expandedBytes) {
      return reject("archive expanded-byte limit exceeded");
    }
    expandedBytes += entry.size;
    return true;
  }) as ArchiveGuard;
  guard.violation = () => violation;
  return guard;
}

export async function extractSafeArchive(
  archive: string,
  destination: string,
  limits: ArchiveLimits,
): Promise<void> {
  const guard = archiveEntryGuard(limits);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const input = createReadStream(archive);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      input.destroy();
      if (error) reject(error);
      else resolve();
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
}

// ── plumbing ──────────────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": HTTP_USER_AGENT } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Page a split through the datasets-server rows API, keeping only the join fields. */
async function fetchIssues(dataset: string, cacheName: string): Promise<Map<string, Issue>> {
  const cache = `${CACHE}/${cacheName}`;
  if (existsSync(cache)) {
    const rows: Issue[] = await Bun.file(cache).json();
    return new Map(rows.map((r) => [r.instance_id, r]));
  }
  const rows: Issue[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = (await fetchJson(
      `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(dataset)}&config=default&split=test&offset=${offset}&length=100`,
    )) as { rows: { row: Record<string, unknown> }[] };
    for (const { row } of page.rows) {
      rows.push({
        instance_id: String(row["instance_id"]),
        repo: String(row["repo"]),
        base_commit: String(row["base_commit"]),
        problem_statement: String(row["problem_statement"] ?? ""),
      });
    }
    if (page.rows.length < 100) break;
  }
  await Bun.write(cache, JSON.stringify(rows));
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
 */
async function fetchRepo(issue: Issue, budgetMb: number): Promise<string | null> {
  const coordinates = safeArchiveCoordinates(issue.instance_id, issue.repo, issue.base_commit);
  if (!coordinates) return null;
  const dir = join(CACHE, "checkouts", coordinates.cacheKey);
  if (existsSync(dir)) {
    const cacheState = lstatSync(dir);
    if (!cacheState.isDirectory() || cacheState.isSymbolicLink()) {
      throw new Error(`unsafe repository cache entry: ${dir}`);
    }
    const entries = readdirSync(dir);
    if (entries.length === 1 && lstatSync(join(dir, entries[0]!)).isDirectory()) {
      return join(dir, entries[0]!);
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
  writeFileSync(archive, "", { mode: 0o600 });
  chmodSync(archive, 0o600);
  const writer = Bun.file(archive).writer();
  let writerClosed = false;
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": HTTP_USER_AGENT } });
    if (res.ok && res.body) {
      let read = 0;
      let overBudget = false;
      for await (const chunk of res.body) {
        if (chunk.byteLength > budget - read) {
          overBudget = true;
          break;
        }
        read += chunk.byteLength;
        writer.write(chunk);
      }
      await writer.end();
      writerClosed = true;
      if (!overBudget) {
        await extractSafeArchive(archive, tmp, {
          expandedBytes: budget,
          members: MAX_ARCHIVE_MEMBERS,
          depth: MAX_ARCHIVE_DEPTH,
        });
        ok = true;
      }
    }
  } catch (error) {
    console.error(`archive rejected for ${coordinates.cacheKey}: ${String(error).slice(0, 300)}`);
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
  return join(dir, entries[0]!);
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
    eq(
      safeArchiveCoordinates(instance, "astropy/astropy", commit),
      { cacheKey: instance, repo: "astropy/astropy", commit },
      "live SWE-bench coordinate shape is accepted",
    );
    eq(
      safeArchiveCoordinates("../../victim", "astropy/astropy", commit),
      null,
      "cache traversal is rejected",
    );
    eq(
      safeArchiveCoordinates("safe", "astropy/../../victim", commit),
      null,
      "repo traversal is rejected",
    );
    eq(
      safeArchiveCoordinates("safe", "astropy/astropy", "main"),
      null,
      "non-SHA commit is rejected",
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
        rejected = false;
        try {
          await extractSafeArchive(linkArchive, linkDest, { expandedBytes: 1024, members: 10, depth: 4 });
        } catch { rejected = true; }
        eq(rejected, true, "archive links are rejected");
      }
    } finally {
      rmSync(archiveRoot, { recursive: true, force: true });
    }

    const q = (rr: number, top10: number, ndcg: number): QueryResult => ({ rr, top10, ndcg, truncated: false, results: 1 });
    eq(bestOf([q(0, 0, 0), q(0.5, 1, 0.4)]), { rr: 0.5, top10: 1, ndcg: 0.4 }, "best of queries");
    eq(bestOf([]), { rr: 0, top10: 0, ndcg: 0 }, "no queries, zero score");

    console.log("selftest ok");
    process.exit(0);
  }

  const flag = (name: string, dflt: string): string => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1]! : dflt;
  };
  const sampleSize = Number(flag("--sample", "100"));
  const budgetMb = Number(flag("--budget-mb", "500"));
  const perLang = 20;

  mkdirSync(`${CACHE}/checkouts`, { recursive: true });
  if (!existsSync(`${CACHE}/bench.final.public.jsonl`)) {
    console.error(`downloading instance list to ${CACHE} ...`);
    const response = await fetch(BENCH_URL, { headers: { "User-Agent": HTTP_USER_AGENT } });
    if (!response.ok) throw new Error(`${BENCH_URL}: HTTP ${response.status}`);
    await Bun.write(`${CACHE}/bench.final.public.jsonl`, await response.arrayBuffer());
  }
  const instances: Instance[] = (await Bun.file(`${CACHE}/bench.final.public.jsonl`).text())
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));

  console.error("fetching issue text (SWE-bench Verified + Multilingual) ...");
  const issues = new Map<string, Issue>([
    ...(await fetchIssues("princeton-nlp/SWE-bench_Verified", "issues-verified.json")),
    ...(await fetchIssues("SWE-bench/SWE-bench_Multilingual", "issues-multilingual.json")),
  ]);

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
  if (!resample) {
    const manifest: { instances: string[] } = await Bun.file(manifestPath).json();
    const byId = new Map(candidates.map((i) => [i.instance_id, i]));
    sampled = manifest.instances.flatMap((id) => byId.get(id) ?? []);
    console.error(`scoring the committed manifest: ${sampled.length} of ${manifest.instances.length} instances resolvable`);
    if (sampled.length < manifest.instances.length) {
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
    console.error(`recorded ${sampled.length} selected instances before scoring`);
  }

  type InstanceResult = {
    instance_id: string; lang: string; queries: number;
    rg: { rr: number; top10: number; ndcg: number };
    hay: { rr: number; top10: number; ndcg: number };
    hayTruncated: number;
  };
  const results: InstanceResult[] = [];
  let skippedRepo = 0, skippedNoQueries = 0, skippedNoGold = 0;

  for (const inst of sampled) {
    const issue = issues.get(inst.instance_id)!;
    const title = issue.problem_statement.split("\n", 1)[0] ?? "";
    const body = issue.problem_statement.slice(title.length);
    const queries = deriveQueries(title, body);
    if (queries.length === 0) { skippedNoQueries++; continue; }

    const root = await fetchRepo(issue, budgetMb);
    if (!root) { skippedRepo++; continue; }

    const gold = new Set(
      inst.ground_truth.read_core_files.flatMap((candidate) => {
        const safe = safeRepoRelativePath(candidate);
        return safe !== null && existsSync(join(root, safe)) ? [safe] : [];
      }),
    );
    if (gold.size === 0) { skippedNoGold++; continue; }

    const lang = instanceLanguage([...gold]);
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

  if (results.length === 0) {
    console.error("no instances scored; nothing to report");
    process.exit(1);
  }

  const effect = (diff: (r: InstanceResult) => number) => ({
    byInstance: bootstrapCI(results.map((r) => [diff(r)])),
    randomizationByInstance: randomizationP(results.map((r) => [diff(r)])),
  });
  const byLang: Record<string, number> = {};
  for (const r of results) byLang[r.lang] = (byLang[r.lang] ?? 0) + 1;

  const report = {
    benchmark: "SWE-Explore-Bench (arXiv 2606.07297), verified + multilingual splits",
    claim: "given identical mechanically-derived queries, does hay's reordering surface gold files earlier than rg's path order — this does not measure issue localization",
    qderive: QDERIVE_VERSION,
    seed: SEED,
    instances: results.length,
    byLanguage: byLang,
    excluded: { noPublicIssueText: excludedNoIssue, repoSkipped: skippedRepo, noDerivableQueries: skippedNoQueries, noVisibleGold: skippedNoGold },
    mrrRg: mean(results.map((r) => r.rg.rr)),
    mrrHay: mean(results.map((r) => r.hay.rr)),
    top10Rg: mean(results.map((r) => r.rg.top10)),
    top10Hay: mean(results.map((r) => r.hay.top10)),
    ndcg10Rg: mean(results.map((r) => r.rg.ndcg)),
    ndcg10Hay: mean(results.map((r) => r.hay.ndcg)),
    deltaMrr: effect((r) => r.hay.rr - r.rg.rr),
    deltaTop10: effect((r) => r.hay.top10 - r.rg.top10),
    deltaNdcg10: effect((r) => r.hay.ndcg - r.rg.ndcg),
    hayTruncatedQueries: results.reduce((a, r) => a + r.hayTruncated, 0),
    toolVersions: {
      hay: (await Bun.$`${new URL("./hay/target/release/hay", import.meta.url).pathname} --version`.text()).trim(),
      rg: (await Bun.$`rg --version`.text()).split("\n")[0],
    },
  };

  const show = (name: string, e: ReturnType<typeof effect>) =>
    console.error(
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
  console.error(`  excluded: ${JSON.stringify(report.excluded)}`);

  await Bun.write("evidence/swe-explore.json", JSON.stringify(report, null, 2));
  console.error("\nwrote evidence/swe-explore.json (all public data; sample manifest was not changed while scoring)");
}
