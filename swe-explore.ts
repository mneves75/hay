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

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

// ── plumbing ──────────────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
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
  const dir = `${CACHE}/checkouts/${issue.instance_id}`;
  if (existsSync(dir)) {
    const entries = readdirSync(dir);
    if (entries.length === 1) return `${dir}/${entries[0]}`;
  }
  const tmp = `${dir}.tmp`;
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const budget = budgetMb * 1024 * 1024;
  const url = `https://github.com/${issue.repo}/archive/${issue.base_commit}.tar.gz`;
  const tar = Bun.spawn(["tar", "-xz", "-C", tmp], { stdin: "pipe", stderr: "ignore" });
  let ok = false;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (res.ok && res.body) {
      let read = 0;
      for await (const chunk of res.body) {
        read += chunk.byteLength;
        if (read > budget) break;
        tar.stdin.write(chunk);
      }
      await tar.stdin.end();
      ok = read <= budget && (await tar.exited) === 0;
    } else {
      tar.kill();
      await tar.exited;
    }
  } catch {
    tar.kill();
    await tar.exited.catch(() => {});
  }
  if (!ok) {
    rmSync(tmp, { recursive: true, force: true });
    return null;
  }
  const entries = readdirSync(tmp);
  if (entries.length !== 1) {
    rmSync(tmp, { recursive: true, force: true });
    return null;
  }
  renameSync(tmp, dir);
  return `${dir}/${entries[0]}`;
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
    await Bun.write(`${CACHE}/bench.final.public.jsonl`, await (await fetch(BENCH_URL)).arrayBuffer());
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
  let sampled: Instance[];
  if (existsSync(manifestPath) && !argv.includes("--resample")) {
    const manifest: { instances: string[] } = await Bun.file(manifestPath).json();
    const byId = new Map(candidates.map((i) => [i.instance_id, i]));
    sampled = manifest.instances.flatMap((id) => byId.get(id) ?? []);
    console.error(`scoring the committed manifest: ${sampled.length} of ${manifest.instances.length} instances resolvable`);
    if (sampled.length < manifest.instances.length) {
      console.error("some manifest instances are no longer resolvable upstream; their absence is visible in the counts");
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

    const gold = new Set(inst.ground_truth.read_core_files.filter((f) => existsSync(`${root}/${f}`)));
    if (gold.size === 0) { skippedNoGold++; continue; }

    const lang = instanceLanguage(inst.ground_truth.read_core_files);
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
  await Bun.write(
    "evidence/swe-explore-instances.json",
    JSON.stringify({ seed: SEED, qderive: QDERIVE_VERSION, instances: results.map((r) => r.instance_id) }, null, 2),
  );
  console.error("\nwrote evidence/swe-explore.json and evidence/swe-explore-instances.json (all public data)");
}
