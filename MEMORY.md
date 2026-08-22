# MEMORY — hay

Curated long-term memory for this repo. Daily detail lives in `memory/YYYY-MM-DD.md`.
Read this and the most recent journal entry before working here.

## What this project is now

It started as "score a repository on how well it answers a coding agent's searches". That score was
built, published, tested against real agent behaviour, and **falsified**. What survived is more
useful than what was attempted:

- **`hay/`** — a ranked grep in Rust. Drop-in for `rg`, reorders results so the definition comes
  first. This is the deliverable.
- **The measurement kit** (`harvest-queries.ts`, `measure-mrr.ts`, `doc-authority.ts`) — turns
  local agent transcripts into a retrieval test collection with behavioural relevance judgments.
  This is the reusable asset, and it is what killed the original metric.
- **`grep-hygiene.ts`** — the falsified scorer. Kept only so the negative result is reproducible.
  **Do not use its numbers to judge a codebase.**

## Decisions, and why

**An A/B has to feed both sides the same input, and you have to check rather than assume**
(2026-08-20). `measure-mrr.ts` gave ripgrep `--hidden` and never gave `hay` the matching flag, so
for four versions the headline comparison ran two different searches — in a file whose own comment
demands identical feeding. The fix moved the effect from +0.131 to +0.1318, i.e. not at all. That
is the useful shape of the lesson: **"it turned out not to matter" is a sentence you may only write
after measuring it.** The reflex is now invariant 6.

**Then apply the rule, not just the patch** (2026-08-20). Having written invariant 6 down, checking
`benchmark.ts` against it found the same class of defect there — ripgrep honouring the global
gitignore and `.ignore` files that `hay` deliberately disables, 231 files against 225 on the
ripgrep corpus. One fix is a patch; the rule is what finds the second instance. And the reference
invocation existed all along in `differential-test.sh`, which had both sides symmetric since it was
written: the harness that proves correctness was rigorous, the two that publish numbers were not.
**Copy the differential test's invocation.**

**Cap a metric in its own unit** (2026-08-20). nDCG counts distinct files; the scan stopped at
1,000 result lines. A query whose first file carried a thousand matches would have scored nDCG 0
with the answer at file-rank 2. Caught by review before publication, fired on 0 of 953 queries, and
the fix stayed in anyway because the next corpus is not this one. The durable part: the state
machine was extracted into a pure `ResultScan` class, because a function that spawns a process
cannot be unit-tested for this and that is *why* it was invisible.

**Run the test you cite** (2026-08-20). The project cited Smucker et al. (CIKM 2007) to justify a
bootstrap. What that paper does is treat Fisher's randomization test as the reference and validate
the bootstrap *against* it; the 2009 follow-up finds the bootstrap biased toward smaller p-values
at small samples. Citing the paper while shipping only the approximation it was used to check is
having the argument both ways. Both now run, at both clustering levels, and they agree.

**A stricter test is worth running even when — especially when — it takes a claim away**
(2026-08-20). On its first run the randomization test disagreed with the bootstrap on the openclaw
corpus: +0.150 with an interval of [0.005, 0.297] excluding zero, against p=0.058. Small-sample
bootstrap optimism, exactly as documented, at n=30. `BENCHMARK.md` now bolds only where both tests
agree and prints the disagreement; `hay`'s benchmark win is detected on 2 of 3 usable corpora, not
3. It still ranks first on all three, ahead of `ast-grep`.

**Use every judgment you collected** (2026-08-20). The corpus averages 2.27 answer files per query,
so MRR — first hit only — was discarding most of the relevance data. nDCG@10 over distinct files
gives +0.1306 [0.1097, 0.1524] against MRR's +0.1318: the same effect, which is the reassuring
answer. It is deliberately absent from `benchmark.ts`, whose ground truth is one declaring file per
symbol; under single-positive binary relevance nDCG and MRR degenerate into the same signal.

**The strongest argument against this tool is from ripgrep's author, and it belongs in the README**
(2026-08-20). BurntSushi: ripgrep "very explicitly does not rank results and never will", and in
the ngram RFC, that it was hubris to think he could do code-aware relevance ranking alone. Half of
that justifies `hay` existing as a wrapper — the gap will never close upstream. The other half is a
warning this project has already partly earned. `hay` is four structural priors and a tie-break,
not code-aware ranking, and saying so is the honest ceiling of the claim.

**Test in a language your tests do not use** (2026-08-20). `hay`'s definition signal was inert on
C for four versions: a kernel function definition has no declaration keyword, so on the Linux
kernel switching the signal *off* changed the score by exactly nothing. Every unit test was written
in Rust or TypeScript, so nothing could see it. It surfaced only when a benchmark ran the tool over
a language nobody had tested. Fixed in 0.4.0: +0.081 MRR on the kernel, CI [0.018, 0.148].

**Count the false positives, do not imagine them** (2026-08-20). The first version of that rule
regressed Rust significantly. Enumerating what actually preceded each wrong firing — `match` 11
times, `in` 5, `dyn` 2, and English prose in comments for the rest — shrank the regression
five-fold. Guessing at the fix would have produced a different and worse exclusion list.

**Report absolute differences with an interval, paired** (2026-08-19). The A/B was published as
"+47%, 12/12 improved, none worse" — a relative improvement of an arithmetic mean with no effect
size, over repo medians, when the design is paired per query. Fuhr lists both among the common
mistakes in IR evaluation. Redone as a paired bootstrap (10k replicates, fixed seed, by query and
clustered by repo): MRR +0.131 [0.105, 0.158]. It also revealed that **hay is worse on 24% of
individual queries** — "none worse" was only ever true of repository medians. A Monte-Carlo
p-value uses `(crossings+1)/(replicates+1)`: a finite simulation cannot report an exact zero, and
printing `p=0.0000` overstates the precision it has.

**Two numbers, never one composite** (2026-08-19). Documentation load and naming quality move
independently — a repo can have spotless docs and the worst naming in a sample. A composite score
tells that repo it is fine while an agent drowns.

**The score is falsified, and the README says so at the top.** `proseShare` vs real-agent MRR is
ρ −0.035 (n=12), +0.043 controlling for repo size. Nothing else reaches significance either. It was
published as though validated and it was not. That admission stays at the top of the README.

**Do not build an index or a retriever competitor.** Prior art (ticket 01) found tree-sitter
knowledge graphs over MCP already reporting ~10× token reductions with real funding. `hay` is
deliberately stateless — no index, no daemon — because that is a much smaller claim and far cheaper
to adopt: you type `hay` instead of `rg`.

**Do not invent a metric.** CodeSearchNet settled this: MRR and NDCG@k, 4,026 expert relevance
judgments. The project spent weeks arriving at MRR by getting caught, when reading the paper first
would have taken an hour. Ticket 01 was open the entire time the scorer was being built.

**Ablate every ranking signal; delete the ones that earn nothing.** Three of six hand-designed
signals in `hay` contributed ≤0 and were removed. Removing one *improved* the score.

**Pre-register the ship gate before implementing.** `hay`'s gate (median MRR ≥ 0.50, top-10 ≥ 80%)
was fixed in `DESIGN-hay.md` before any Rust was written. It currently **fails at 0.387 / 58.2%**,
and it has not been moved, even though the improvement is statistically unambiguous — paired MRR
+0.132, 95% CI [0.106, 0.158]. Significance is not sufficiency; that is the point of fixing the
gate first. As of 0.5.0 `--compare` computes the gate itself; every earlier figure for it was
assembled by hand from a per-repo table, and no code had ever calculated the thing that decides
whether this ships.

**Delegate to the library before hand-rolling** (2026-08-19). Four review rounds found 12 defects
in 0.2.0; the two worst were both hand-rolled versions of something ripgrep's crates already do:
`-w` as `\b...\b` (cannot match a punctuation-edged pattern — `hay -w -F '@'` returned nothing,
exit 1, indistinguishable from no matches) and UTF-8 decoding that discarded every match in a
Latin-1 file. `RegexMatcherBuilder::word` was there the whole time. See [[review-history]] in
`DESIGN-hay.md`.

**A fix can be worse than its bug** (2026-08-19). Merging overlapping `-C` windows removed
duplicated lines and silently reordered results, which for a tool whose product IS rank order is a
larger defect than the one it replaced. When a fix touches the property the tool exists to provide,
the property wins — enforce the invariant by lookup, do not reorder.

**Measurement against live working trees is not reproducible** (2026-08-19). Two repos moved by
0.0001 MRR between two runs of the same evaluation; the cause was 1,795 and 179 files changing
under the measurement, proved by diffing the old and new binaries on exactly the queries that
moved (identical). Pin the corpus to a fixed checkout before comparing anything.

**Publish nothing that names a private repo.** Measured repos are client and personal work; the
destination is public. Use `=label` for repo identity and `--redact-names` for identifiers.
`corpus/` is gitignored — it contains real queries and paths.

## Current state

- `hay` **0.1.0** (2026-08-22, pushed — history squashed at release per owner call; pre-release development under the old repo name): no ranking change — differential 10/10 identical vs
  ripgrep, 45 tests (34 unit + 11 CLI contract), clippy clean under `-D warnings`, and the
  behavioural gate numbers are byte-identical to the pre-squash confirmation run (median-repo MRR
  0.3810 / top-10 0.5916, n=952 — still **FAIL** against 0.50 / 0.80, as pre-registered).
  Shipped: behavior-preserving dedup (`window()`, `hits_marker()`, `is_ident_char()`); `-l --json`
  now prints plain paths per the documented JSON contract; `benchmark-corpora.sh` (clone-missing →
  run → render → delete-only-its-clones, partial-corpus refusal); `MANUAL.html` (self-contained,
  searchable user manual); `benchmark.html` rebuilt as a publishable report page with inline-SVG
  charts and a Feynman explainer; `benchmark.ts --queries-from` pins a prior sample for paired
  before/after runs.
- Headline, one-shot confirmation run of the frozen binary, 951 paired queries in 12 repos:
  MRR 0.266 → 0.404 (+0.1380 [0.1120, 0.1646]), top-10 46.1% → 60.0% (+0.1399 [0.1073, 0.1735]),
  nDCG@10 +0.1301. Gate AS WRITTEN (median across repos — computed for the first time ever):
  0.3810 / 0.5916 → **FAIL** against 0.50 / 0.80. Zero repos worse than rg. Evidence:
  `evidence/2026-08-20-paired-bootstrap-after-taxonomy.json`.
- **GitHub Pages is LIVE and gh-pages is load-bearing**: https://mneves75.github.io/hay/ serves
  from the `gh-pages` branch root — landing + `MANUAL.html` + `benchmark.html` + designed HTML
  edition of BENCHMARK_FEYNMAN + the Remotion benchmark film. Deleting that branch deletes the
  site (owner once asked; explained, kept). Film source: `site/video-src/`. Release **v0.1.0**:
  tag + GH Release with an aarch64-apple-darwin tarball; `install.sh` is the supported install
  path. README links live HTML editions; repo homepage field points at the landing page.
- **External validity exists now**: SWE-Explore-Bench (public, agent-shaped, 8 languages), 97
  seeded instances, identical mechanically-derived queries to both retrievers: dMRR +0.2709
  [0.1920, 0.3529], dTop10 +26.8 pts, both tests p=0.0001. `evidence/swe-explore.json`; the
  instance list is committed so reruns score the same set. The claim is reordering under equal
  queries, NOT issue localization — the payload says so verbatim.
- Public benchmark: five corpora (Swift/Alamofire added because the taxonomy indicted Swift),
  codespelunker added as the closest ranked competitor. Re-measured 2026-08-22 on 0.1.0 by
  `benchmark-corpora.sh`: hay first on all five (MRR 0.967 linux, 0.879 openclaw, 0.800 ripgrep,
  0.691 alamofire, 1.000 this-repo-n=1), top-10 93–100%. The report page charts encode the same
  detection rule as the tables: filled = interval excludes zero AND randomization agrees.
- The evidence file is treated as a trust boundary: `validatePayload()` fails closed on non-finite
  numerics before any rendering, because evidence gets re-rendered into committed HTML by anyone
  who runs the report. Found by pre-release review with an injected-payload PoC.
- `cargo audit` clean across 58 dependencies — its first ever actual execution, since CI has never
  run. `evidence/` re-verified free of private repository names, absolute paths and raw queries.
- `-C/--context`, `--json`, `-e`, `-t/--type`, `cargo install`, and CI on Linux/macOS/Windows all
  ship as of 0.2.0. Engineering gaps closed; the research gaps are not, and were never going to be
  closed by shipping flags.
- All **nine** TypeScript tools have passing selftests and run in CI. `benchmark.ts` and
  `benchmark-report.ts` shipped in 0.4.0 with selftests nothing executed, so the statistics behind
  the published intervals were unguarded for a release.
- Committed and pushed to a **private** GitHub repo. Docs: `README.md` (the negative result, now
  also introducing `hay`), `HOWTO.md` (how to run anything), `DESIGN-hay.md` (design + results +
  review history), `CHANGELOG.md`, `SECURITY.md`, `docs/method/` (the wayfinder map and tickets).

## Blockers / open questions

1. **The gate still fails, but the gap now has a theory** (issue 10): the two largest remaining
   buckets are answers in files hay's own path prior penalizes (31% — prose 78, tests 53) and
   answers both retrievers rank deep (31%, all rankable). The prose/test bucket is currently
   *unaddressable without violating the firewall* — the public benchmark has no prose ground
   truth to develop a query-conditional penalty on. Building such a development set is the
   cycle-2 prerequisite.
2. **Weights are hand-set.** Fitting them on the same 12 repos would overfit the only evaluation
   set that exists. The public benchmark now covers c/ts/rust/swift and is the development set.
3. **External validity: one public result now exists** (SWE-Explore, above) for hay's ranking
   effect. The grep-hygiene *metric* findings (docs predict nothing, etc.) still have none.
4. **MRR is still a proxy.** The field's accepted outcome measures are tokens and tool calls per
   resolved task; nothing has been tested against those.
5. **Cross-platform CI remains unverified.** The workflow did not execute while the repository was
   private, so Linux and Windows claims require a successful public-repository run.

## The lesson this repo exists to remember

Nine instrument bugs produced numbers that looked entirely reasonable, and the headline moved three
separate times as they were fixed (~100× → ~29× spread; ρ −0.762 → −0.559 for repo size). Every one
was caught by checking the instrument against something already known, never by staring at the
output. **The correction history in the README is deliberate and should not be tidied away** — it
is more useful to whoever picks this up than the final table is.
