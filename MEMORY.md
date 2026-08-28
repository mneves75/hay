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

**A benchmark cannot judge a signal that detects its ground-truth rule** (2026-08-28). The docs
track's ground truth is "the token appears in exactly one markdown file's headings"; a heading
signal is an oracle for that rule, so its enormous win there (+0.19 to +0.45 across five corpora)
measures agreement with the generator, not retrieval. Deleted, with the circularity written down
*before* the numbers were taken — the difference from the v0.2.0 filename deletion, which was
decided after seeing them. The reason matters more than the verdict: the SWE-Explore difference
(−0.0054, n=96) is not distinguishable from zero, so leaning on it would have been its own
overclaim. See `docs/method/issues/13-heading-signal.md`.

**A new metric that correlates 0.9 with an old one is a translation, not evidence** (2026-08-28).
R-precision was added because the field measures context precision, not rank. On this corpus it
correlates r=0.905 with reciprocal rank and r=0.845 with nDCG@10. It stays — the field's units are
worth speaking — but the correlation is printed beside it, because a fourth number that moves with
the other three reads as fourfold confirmation to anyone who does not check.

**Every gate must report its own exit code** (2026-08-28). Twice in two sessions a red test passed
unnoticed inside a `&&` chain whose next command was a grep that succeeded. Run each gate on its
own line with `echo "name=$?"`. A gate whose failure you cannot see is not a gate.

**Refusing a valid invocation is a decision you push onto the caller** (2026-08-28). `-c`, `-v` and
`-o` exited 2 saying "use rg", on the correct grounds that they leave nothing to rank. That made
`hay` a tool you could only reach for once you already knew the question ranks. They run unranked
now; the shape of a drop-in is answering everything, and ranking the part where rank means
something.

**A citation nobody opened** (2026-08-28). The motivation for R-precision cited a preprint that is
WITHDRAWN, for a statistic that is not in its abstract — taken from a search summary. Caught by
review, inside the file whose purpose is measuring exactly this class of failure. Open the source.

**The unit of an answer is a file, and the metric counted lines** (2026-08-27). Judgments here are
per file — an agent opens files — while MRR counts result lines, so a module with forty matching
lines pushed the declaring file to line-rank forty-one. Round-robining the ranked list by file
(pass one = each file's best line) moved the behavioural top-10 rate **18.8 points without
re-scoring anything**, the largest single retrieval gain this project has measured. It came from
noticing what was being counted, not from understanding code better. See [[2026-08-27]].

**The firewall's first real cost** (2026-08-27). A filename signal — the highest-weighted field in
every published lexical code retriever — simulated at **+0.033 median MRR on the private
evaluation corpus**, which would have brought the pre-registered gate within 0.02 of passing. On
the development sets it earned +0.008 / +0.000 / −0.002 and **−0.0136 on SWE-Explore**, the only
public agent-shaped benchmark. Deleted. The evaluation set does not get a vote on what ships,
*especially* when it says the thing you want to hear. The honest caveat is recorded too: the
public definition benchmark is structurally blind to a filename signal, because its queries are
function names — which is an argument for the signal and not evidence for it.

**Check whether the excuse is available before reaching for it** (2026-08-27). With the gate still
failing at 0.4437, the tempting move was to blame the corpus. An oracle that ranks any answer file
first scores **1.00** here, so 0.50 was always attainable and the shortfall is ranking quality.
Measuring the ceiling removed the excuse rather than supplying one, which is the only reason it
was worth measuring.

**Every safety limit is a potential silent sampler** (2026-08-27). The SWE-Explore archive reader
rejected any repository tarball containing a symlink, so 21 of 97 committed instances silently
stopped scoring — 22% of the project's only external evidence. The payload had been printing
`repoSkipped: 22` the whole time. Invariant 7 recorded it and nobody read it: **a counter nobody
reads is not a gate.** Links are now dropped individually, still never written to disk.

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
was fixed in `DESIGN-hay.md` before any Rust was written. It currently **fails at 0.381 / 59.2%**,
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

- **v0.3.0 — every valid ripgrep invocation now has an answer** (2026-08-28). `-c`,
  `--count-matches`, `-v`, `-o` stop refusing and run unranked; `--stream` (pre-registered in
  DESIGN, never built) skips ranking with **no candidate cap**. Ranking model untouched — same
  four signals, same weights, same failed gate (0.4437 / 0.7849). Adds R-precision as the field's
  "wasted reads" axis (rg 0.176 → hay 0.301) while publishing that it is r=0.905 with reciprocal
  rank and therefore not independent evidence. A markdown-heading signal was built, reversed the
  documentation deficit outright, and was deleted for circularity ([[13-heading-signal]]).
  A three-way review workflow found 20 real defects in the first two commits, including a `-o -v`
  that printed nothing and exited 0.

- **v0.2.0 RELEASED** (2026-08-28): `v0.2.0-beta1` (staging prerelease) then `v0.2.0`, both built
  by `release.yml` at commit `14ed268`, five platform archives each with sha256 and SLSA
  attestations; the arm64 macOS archive was downloaded back, checksum- and attestation-verified
  against the expected workflow/ref/commit, and smoke-tested including `--no-diversify`. CI green
  on all seven jobs. GitHub Release published (this cycle the owner asked for the prod deploy
  explicitly, unlike 0.1.3/0.1.4 which stayed drafts). gh-pages redeployed and live-verified: 200
  on all four pages, `v0.2.0` chip, new corpus bars, and the failed gate now stated on the landing
  page itself.
- **The public corpora need a case-sensitive filesystem** (2026-08-28): `~/haycorpora.sparsebundle`
  (case-sensitive APFS, mounted at `/Volumes/haycorpora`) holds linux/openclaw/ripgrep/alamofire;
  run the benchmark with `--corpora /Volumes/haycorpora`. The kernel cannot be checked out on
  macOS's default filesystem — `xt_MARK.h` beside `xt_mark.h` — and the old dirty clone under
  `~/.cache/hay/corpora/linux` was deleted so nothing silently measures it again.
- **0.2.0 — first ranking change since going public** (2026-08-27): file interleaving + a graded
  `word` signal; a filename signal built, ablated and deleted. One confirmation run on the frozen
  binary: paired MRR 0.258 → **0.458** (+0.1995 [0.1754, 0.2243]), top-10 44.9% → **77.1%**
  (+32.2 pts), nDCG@10 0.358 → 0.501, worse-than-rg queries 235 → **115** of 951, 0 repos worse.
  **GATE 0.4437 / 0.7849 — still FAIL** against 0.50 / 0.80, not moved; oracle ceiling on this
  corpus is 1.00, so the gap is ranking, not the corpus. SWE-Explore 0.242 → **0.551** (+0.3085
  [0.2321, 0.3878]) on 96 of 97 instances after fixing an archive reader that had been discarding
  21 of them. Also fixed: `hay` panicked on any non-ASCII query whose first hit sat inside a word.

- **0.1.4 BETA STAGED; PRODUCTION PENDING** (2026-08-26): no ranking or weight change. The release
  closes installer, archive, private-output, subprocess, benchmark-inference, provenance, site,
  accessibility, and film-integrity gaps while leaving the failed behavioural gate fixed. `main`
  CI run `33031310741` passed all seven jobs. Annotated `v0.1.4-beta1` and release run
  `33031510806` produced five checksummed, attested platform archives in an unpublished draft.
  The arm64 macOS archive was downloaded back, checksum- and SLSA-attestation-verified, versioned
  as `hay 0.1.4`, and smoke-tested. Live Pages, stable `v0.1.4`, and GitHub Release publication
  remain untouched pending their separate confirmations. Final independent review found no P0/P1
  code, methodology, installer, or security blocker; its pixel pass was incomplete because the
  local image viewer hung.

- **0.1.3 PRODUCTION TAGGED; GITHUB RELEASE DRAFT** (2026-08-25): ranking and weights stay frozen. The release makes
  candidate-cap truncation exit 2, restores JSON context offsets and zero-width submatches, and
  capability-scopes context re-reads to the anchored search root. The differential matrix expands
  from 10 to 17 cases; compile-time unsafe prohibition, tested ast-grep guards, archive
  attestations, and validation of remote SWE-Explore cache/archive/path coordinates harden the
  development, measurement, and release paths. Real-browser manual checks cover search/no-hit,
  theme, navigation, mobile/desktop overflow, runtime errors, and network failures. `v0.1.3-beta1`
  and annotated `v0.1.3` point to the same reviewed commit; both tag workflows passed all five
  platform builds plus draft creation, with ten checksummed assets each. The arm64 macOS artifacts
  were downloaded back, provenance-verified against the expected workflow/ref/commit, versioned,
  and smoke-tested. The user deliberately left the GitHub Release draft and unpublished. The
  pre-registered behavioural ranking gate still fails; this hardening tag does not claim otherwise.

- **P2′ refused by its own measurement** (2026-08-23): the corpus-side doc prior was
  pre-registered, implemented (stashed, not shipped), and measured — doc-answerable queries have
  prose match shares of 0.01–0.18, so the conditioning feature separates nothing. Both cycle-2
  discipline outcomes happened in one day: P1's counts blocked a signal pre-implementation,
  P2′'s grid refused one post-implementation. Next conditioning candidates live in ticket 11.
- **0.1.2 RELEASED** (2026-08-23, night): `v0.1.2-beta1` (prerelease) then `v0.1.2` — both built
  by `release.yml`'s first-ever executions, green on all five targets, 10 assets each with
  sha256s, drafted then human-published; arm-mac binary downloaded back and smoke-tested at each
  stage. gh-pages updated (v0.1.2 chip, docs-track benchmark section, agent-default manual) and
  live-verified. The Rosetta x86_64-mac version check worked as documented.
- **0.1.2** (2026-08-23, cycle 2 opens): ticket 11 pre-registers the route to done. P1 shipped —
  `benchmark.ts --docs-track`, a public dev set for the prose bucket; the published run (after
  review caught PascalCase classified as plainWord) quantifies the indictment: hay
  −0.440/−0.340 MRR vs rg on doc-answerable queries, both tests p ≈ 0.0001, and the dominant
  doc-answerable shape is **PascalCase type names documented in markdown** (27/30 alamofire) —
  which **blocks** the shape-conditional penalty, since that is also the code track's type-query
  shape. Recorded, not shipped. P7 shipped — `release.yml` (5 targets, draft-only) and the differential
  test now runs on Windows. No ranking change; hay source untouched.
- `hay` **0.1.1** (2026-08-23): repair release driven entirely by the first public CI run, which
  failed on two real defects — the committed lockfile's `globset`/`ignore` require rustc 1.88, so
  the MSRV 1.85 claim was false (now 1.88 in manifest, CI job, installer gate, docs, site chip);
  and `benchmark-feynman.html` was stale vs its generator, caught by the staleness gate's first
  execution. `install.sh` additionally fixed: pipe-to-`bash` not `sh` (pipefail), install dir
  derived from `CARGO_INSTALL_ROOT`/`CARGO_HOME`/`~/.cargo` not `dirname(cargo)` (found by codex
  P3 autoreview, verified end-to-end against live main). **CI is green on Linux/macOS/Windows for
  the first time** (run 32662935816) — former blocker #5 is closed. Tags: `v0.1.1-beta1`
  (pre-release, verified: tarball downloaded and smoke-tested, installer run live) then `v0.1.1`
  (Release with aarch64 tarball + sha256). gh-pages updated to the release editions of
  MANUAL/benchmark with the site's `.html` Feynman-link convention; live-verified 200 + content.
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
- The source repository is public at `mneves75/hay`; private behavioural corpora remain local and
  gitignored. Docs: `README.md` (negative result + product), `HOWTO.md` (commands),
  `DESIGN-hay.md` (design + reviews), `CHANGELOG.md`, `SECURITY.md`, and `docs/method/` (tickets).

## Blockers / open questions

0. **The gate fails by 0.056 MRR and 1.5 points of top-10** (2026-08-27, v0.2.0). Everything cheap
   and honest has now been spent: the layout fix, the pre-registered `word` signal, and the one
   signal that would have closed most of the distance was deleted because the public sets refused
   it. What remains in the failure population is dominated by broad greps (`test`, `timeout`,
   `catch`, `node_modules`) whose next-opened file is a function of the task, not the term.
   Stratifying the gate around them after seeing them fail is forbidden; measuring whether they
   are a retrieval problem at all is the open research question. A held-out behavioural corpus
   from a second developer would answer more than another signal would.
1. **The gate still fails, but the gap now has a theory** (issue 10): the two largest remaining
   buckets are answers in files hay's own path prior penalizes (31% — prose 78, tests 53) and
   answers both retrievers rank deep (31%, all rankable). The prose/test bucket is currently
   *unaddressable without violating the firewall* — the public benchmark had no prose ground
   truth to develop a query-conditional penalty on. **The dev set exists as of 0.1.2**
   (`--docs-track`), and its first counts *blocked* the shape-conditional design; the open
   question is now the conditioning feature, not the data (ticket 11).
2. **Weights are hand-set.** Fitting them on the same 12 repos would overfit the only evaluation
   set that exists. The public benchmark now covers c/ts/rust/swift and is the development set.
3. **External validity: one public result now exists** (SWE-Explore, above) for hay's ranking
   effect. The grep-hygiene *metric* findings (docs predict nothing, etc.) still have none.
4. **MRR is still a proxy.** The field's accepted outcome measures are tokens and tool calls per
   resolved task; nothing has been tested against those.
5. ~~Cross-platform CI remains unverified.~~ **Closed 2026-08-23**: run 32662935816 is green on
   all seven jobs (Linux/macOS/Windows matrix, MSRV, audits, selftests, film source). The first
   two public runs failed on real defects (false MSRV claim, stale generated page) — the gates
   earned their keep on execution one.

## The lesson this repo exists to remember

Nine instrument bugs produced numbers that looked entirely reasonable, and the headline moved three
separate times as they were fixed (~100× → ~29× spread; ρ −0.762 → −0.559 for repo size). Every one
was caught by checking the instrument against something already known, never by staring at the
output. **The correction history in the README is deliberate and should not be tidied away** — it
is more useful to whoever picks this up than the final table is.
