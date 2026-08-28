# hay

**A ranked grep for coding agents, built from a negative result.** `hay` uses ripgrep's search
engine and reorders the complete result set from an equivalently configured ripgrep search:
likely declarations first, stale prose and buried files later, and one line per file before any
file's second line. Broad searches that hit the bounded candidate cap exit 2 instead of claiming
completeness. It is stateless, deterministic, and still fails its pre-registered ship gate — by
1.5 points on one of its two criteria as of 0.2.0, against 20 points at 0.1.4. See the
[manual](https://mneves75.github.io/hay/MANUAL.html) for the command surface and
[HOWTO.md](HOWTO.md) for setup.

```bash
git clone https://github.com/mneves75/hay.git
cd hay
cargo install --locked --path hay
```

> **Version-history note:** the research record numbered internal development cycles 0.1.0–0.7.0
> before public tags restarted at v0.1.0. Those unprefixed labels in method and lesson documents
> name development cycles, not published tags. Cargo metadata and the changelog are authoritative.

## The negative result that produced `hay`

This project set out to score repositories on how well they answer a coding agent's searches. The
score was built, published, and then tested against real agent behaviour. It does not work. What
follows is what was measured, what it says instead, and the tools that produced it, kept because
the measurement apparatus turned out to be worth more than the metric.

Ground truth throughout: **3,144 local coding-agent transcripts**, yielding 2,508 searches paired
with the files the agent opened next, across 71 repositories. That is a retrieval test collection
built from behaviour rather than assumption, and it is the thing this project should have started
with.

---

## Finding 1 — Counting documentation predicts nothing

The original metric, `proseShare`, measures what fraction of a concept search's results land in
`.md` files rather than code. It was presented as a measure of an agent's reading cost.

Tested against Mean Reciprocal Rank — how far down the results the answer actually sits — across 12
repositories with ≥60 judged queries each:

| variable | Spearman ρ vs MRR | partial ρ (repo size controlled) |
|---|---|---|
| **proseShare** | **−0.035** | **+0.043** |
| suspectShare | −0.126 | +0.004 |
| names under 3 words | 0.053 | 0.317 |
| median words per name | −0.226 | −0.458 |
| p90 hits per name | −0.460 | −0.512 |
| repo size (code files) | −0.559 | — |

At n=12, significance needs |ρ| > 0.587. **Nothing reaches it, including repository size.**
`proseShare` sits at −0.035, indistinguishable from no relationship whatsoever.

It is not that the number is weak — it is that it is loud about nothing. `proseShare` varies
**10.4×** across these repos while the outcome varies **2.0×**. The repo with the cleanest prose
share in the set (3.9%) ranks 8th of 12 on retrieval; the repo with by far the worst (40.8% prose,
38.4% "suspect") ranks **4th best**.

Doc-to-code *file ratio* fares no better: one repo has more prose files than code files and scores
mid-table, while another with a smaller majority scores worst.

## Finding 2 — More than three quarters of documentation is never read at all

In the 2026-08-26 snapshot, **1,248 of 1,604 prose files (78%) were never opened by any agent in
2,256 matching transcript sessions.** Per repo the rate runs from 8% to 91%.

That reframes the problem. The original plan was to build a clever heuristic for spotting dead
documents. Tested against revealed preference, every candidate signal is close to worthless — not
because the signals are bad, but because almost everything is dead, so flagging at random already
looks accurate:

| signal | precision | lift over base rate |
|---|---|---|
| suspect path / filename (`archive/`, `plan-v3-FINAL.md`) | 88% | **1.13** |
| no inbound links from any other file | 85% | **1.09** |
| both | 87% | **1.12** |

A lift of 1.13 means the heuristic is 13% better than guessing. **The base rate is the finding, and
the base rate is directly measurable** — you do not need a heuristic to tell you which documents are
dead when you can simply observe that nothing ever opened them.

*Caveat that matters:* "never opened by an agent" is not "worthless". Humans read documentation too,
and these transcripts cover one developer's agent sessions. It measures agent-relevance specifically
— which is the only thing this project ever claimed to be about.

## Finding 3 — Plain grep is uniformly mediocre, whatever the repo

MRR across all twelve repositories: **0.184 to 0.375**. Median rank of the answer: **5 to 28**. The
answer appears in the top ten results **34–62%** of the time — in *every* repo, clean or filthy.

This is the result that undoes the project's premise. If retrieval is roughly equally poor
regardless of hygiene, the constraint is the retriever, not the corpus. Published work agrees: a
tree-sitter knowledge graph exposed over MCP reports [~10× fewer tokens and 2.1× fewer tool
calls](https://anthonywest.co.uk/research/code-intelligence-indexing-2026-openai) across 31
repositories. Adding priors buys an order of magnitude; tidying the repo buys what we could not
detect at n=12.

There is a popular framing that inside every codebase are two wolves — *grep is bad* or *your
codebase is bad* — and you must pick one. On this evidence the first wolf is much larger than the
second. `grep` is not bad, it is **prior-free**: it ranks a dead `plan-v3-FINAL.md` exactly like the
function definition, because nothing tells it otherwise. That is a fixable property of the
retriever, and fixing it is where the measured gains are.

## An incidental result worth knowing

**ripgrep's default output order is nondeterministic.** Three identical runs over the same repo
produced three different orderings. Any rank-based measurement must pass `--sort path` — and it
means an agent issuing the same search twice genuinely gets a different first page.

---

## What came out of it — `hay`, a ranked grep

If the constraint is the retriever, fix the retriever. [`hay`](HOWTO.md#3-hay) is ripgrep's engine
and walk with the priors ripgrep deliberately lacks: every complete search returns **exactly**
the matches from the corresponding normalized `rg` invocation, reordered so the likely
declaration comes first and so the first page is ten files rather than ten lines of one file.
Above 20,000 candidates it exits 2 and identifies the incomplete
prescore-retained set on stderr. No index, no daemon, no state — you type `hay` instead of `rg`.
Every flag, output format, traversal difference, and exit code is documented in the
[manual](https://mneves75.github.io/hay/MANUAL.html) — an offline, self-contained page with
search.

```bash
cargo install --locked --path hay
hay classify_path            # same flags, same path:line:text output, different order
```

Measured against the same corpus, **paired at the query level** — 951 queries across 12
repositories where both retrievers return something (0.2.0, both retrievers rerun together):

| | ripgrep | hay | difference (95% CI) | randomization p |
|---|---|---|---|---|
| MRR | 0.258 | **0.458** | **+0.200** [0.175, 0.224] | 0.0001 |
| answer in top 10 | 44.9% | **77.1%** | **+32.2 pts** [28.9, 35.5] | 0.0001 |
| nDCG@10 | 0.358 | **0.501** | **+0.143** [0.122, 0.165] | 0.0001 |

Paired bootstrap over per-query values, 10,000 replicates, fixed seed, absolute differences.
Clustering the resampling by repository instead of by query barely moves it (MRR +0.200
[0.168, 0.228], nDCG +0.143 [0.103, 0.180]), so the effect is not an artifact of a few queries in
one project. Every interval excludes zero, and the p-values are at the resolution of a
10,000-replicate simulation rather than a claim that the probability is smaller. The ripgrep
column is not copied from an earlier report: these repositories are live working trees, so the
baseline is recomputed in the same run as the number it is compared against (0.1.4 measured
0.266 → 0.404 on the trees as they stood on 2026-08-20).

**Most of that came from a layout decision, not a cleverer score.** Results are now interleaved by
file — the first pass carries each file's strongest line, the second its next-strongest — because
relevance for code is judged per *file* and an agent's next move is to open one. Forty matching
lines in one module used to push the file that actually declares the symbol to line-rank
forty-one. Nothing is re-scored, the sequence of distinct files is unchanged, and the
answer-in-top-10 rate moved 18.8 points on its own. The second change is a `word` signal that
was written into the design document before any Rust existed and never implemented: a match that
is a whole identifier beats one buried inside a longer name.

**nDCG@10 is there because MRR only looks at the first hit.** These judgments are not
single-positive: **57% of the 2,508 corpus entries name more than one answer file**, mean 2.27,
because an agent typically opens several files after one search. MRR is blind to whether those
other answers landed on the first page or the fortieth. nDCG@10 over distinct files, with binary
relevance, is the measure that sees them. It moves the same way and by the same amount, which is
the useful outcome: the gain is not an artifact of one lucky top hit per query.

**And hay is still worse on 115 of those 951 queries — 12%.** Better on 695, tied on 141. At 0.1.4
it was worse on 235 (25%), and the version of this section before that said "improved in 12 of 12,
none made worse", which was true of repository *medians* and hid that nearly a quarter of
individual searches regressed. Four of seven hand-designed ranking signals earned nothing in
ablation and were deleted; removing one *improved* the score.

**The one deleted in 0.2.0 is the most instructive.** A bonus for a file whose own name is the
query — `session_store.ts` for `sessionStore` — is the highest-weighted field in every published
lexical code retriever, and it scored **+0.033 median MRR when simulated against the private
evaluation corpus**. On the development sets it earned +0.008, +0.000, −0.002, and **−0.014 on
SWE-Explore**, the one public agent-shaped benchmark. It was deleted. The evaluation set is not
allowed to vote on what ships, and this is the first time that rule cost something it wanted.

**Every miss and regression now has a counted category.** The error taxonomy
([issue 10](docs/method/issues/10-error-taxonomy.md), counts in
[`evidence/error-taxonomy.json`](evidence/error-taxonomy.json)) put the 466-query failure
population into seven buckets before any signal was touched: the two largest are answers living
in files hay's own path prior penalizes (31% — mostly docs and tests the agent genuinely opened)
and answers ripgrep also missed (31% — all of them still rankable). A 40-query manual pass with
`hay --explain` found two mechanical defects — the definition signal fired on calls
(`const body = await readOptionalJsonBody(...)`) and missed TypeScript optional properties
(`FOO?: string`) — both fixed, developed and checked on the public benchmark only. It also found
a confound worth naming: on several "regressions" hay ranks the true definition first and is
scored worse because the agent opened a usage site. Behavioural ground truth measures what the
agent opened next, not what defines the thing; on those queries the two goals disagree.

**It still fails its own ship gate**, now at **0.4437 and 78.5%** against 0.50 and 80%, up from
0.3810 and 59.2% at 0.1.4. The gate — median MRR across repositories ≥ 0.50, answer in the top 10
≥ 80% — was written into [DESIGN-hay.md](DESIGN-hay.md) before a line of Rust existed, precisely
so it could not be moved afterwards. It has not been moved, and the second criterion is now
missing by 1.5 points.

**And the excuse is not available.** An oracle that ranks any answer file first scores **1.00** on
this corpus: every judged answer file is reachable in the results of both retrievers, so nothing
about the corpus or the metric makes 0.50 unattainable. The shortfall is ranking quality. The
first-position rate is 31.7% — a third of searches put a file the agent opened at the very top,
and the rest of the distance is made of queries like `test`, `timeout` and `catch`, where what an
agent opened next is not a function of the term it searched for. `hay` is a large, consistent
improvement that is still not good enough by the standard it set itself, and saying so is cheaper
than the alternative.

## Measured against every other tool

[BENCHMARK.md](https://mneves75.github.io/hay/benchmark.html) compares `hay` with `ripgrep`, `ugrep`, `ag`, BSD `grep`,
`git grep`, `ast-grep` and `codespelunker` over the Linux kernel, openclaw, ripgrep's own source,
Alamofire (Swift) and this repository — ground truth from a parser, absolute differences with
bootstrap intervals, and a capability matrix for the things speed does not capture. Regenerate it
with `bun benchmark.ts`. Two of those entrants are recent admissions against interest:
`codespelunker` is the closest prior art — a ranked, index-free code-search CLI — and earlier
reports claimed "first on all corpora" without it; the Swift corpus exists because the error
taxonomy showed the behavioural misses concentrating in a language no public corpus covered.

[BENCHMARK_FEYNMAN.md](https://mneves75.github.io/hay/BENCHMARK_FEYNMAN.html) explains the whole thing from nothing — what MRR is
and why it's a reciprocal, what a bootstrap interval actually does, why "the interval spans zero"
is the only reading skill you need, and where the benchmark is wrong. Written for someone who
knows nothing about information retrieval and would rather keep it that way.

It carries its own warning, which belongs here too: the benchmark's task is *definition finding*,
and that is exactly what `hay` is built for, so a win there is weaker evidence than the
behavioural result above, whose ground truth was not designed around the tool. Both are reported
because neither is sufficient alone.

**The clean-revision v0.2.0 run detects the win on all four usable code corpora, by both tests.**
`hay` ranks first on every corpus: Linux 0.933, openclaw 0.928, ripgrep 0.877, Alamofire 0.776
(0.1.4: 0.907, 0.911, 0.800, 0.691, on the same pinned query samples). Against deterministic
`ripgrep --sort path`, the paired MRR effects are Linux +0.392 [0.247, 0.544] (randomization
p<0.001), openclaw +0.109 [0.035, 0.200] (p=0.017), ripgrep +0.458 [0.304, 0.613] (p<0.001), and
Alamofire +0.343 [0.235, 0.459] (p<0.001). The report records the exact clean commit for each
corpus.

*Where those corpora live now matters, which is instrument error 14.* The Linux kernel contains
paths that differ only in case — `xt_MARK.h` beside `xt_mark.h` — so it **cannot be checked out
on a case-insensitive filesystem**, and macOS is one. The 0.1.4 run nonetheless recorded
`dirty: false` for it, because `git status` answers from a stat cache rather than by comparing
content, and a fresh clone's cache says every entry is current. Thirteen files did not match the
commit the report named. The corpora now live on a case-sensitive volume, the provenance check
refuses the run rather than the reader having to notice, and the kernel's ripgrep baseline moved
0.508 → 0.541 once the tree actually matched its revision. **"Clean" from a tool is a claim about
a cache until you make it compare bytes.**

The history still matters: on the pre-public 0.5.0 development run the two tests disagreed on
openclaw (bootstrap interval excluding zero, randomization p=0.058), so the report demoted the
claim. The current run uses a stable-order baseline and newer recorded corpus revisions as well as
a newer tool, so it is a fresh cross-sectional estimate, not a causal before/after result. The
decision rule stayed fixed: both tests must agree. Unordered tools remain visible only as
descriptive snapshots, without intervals or p-values.

**Do not generalize the code result to documentation.** On the separate public documentation
track, `hay` is detectably worse than `ripgrep --sort path` on Alamofire
(−0.194 [−0.276, −0.118], randomization p<0.001), ripgrep's repository
(−0.087 [−0.148, −0.033], p=0.003) and now openclaw too (−0.072 [−0.135, −0.009], p=0.026,
where 0.1.4 showed no detected difference). Linux (−0.010 [−0.037, 0.008]) and this repository
(−0.017 [−0.080, 0.042]) show no detected difference. The Alamofire deficit roughly halved
(−0.370 → −0.194), which is the interleaving helping where the path prior hurts. Read the
before/after loosely: this track now samples 60 queries per corpus rather than 30, and two corpus
revisions moved. The direction of the whole track is unchanged: this is the strongest public warning against treating
a definition ranker as a universal search improvement. If your searches are mostly prose,
`rg --sort path` is the better tool and this README will keep saying so.

Building it found the largest defect in the project so far. `hay`'s definition signal was **inert
on C** — a kernel function definition contains no declaration keyword, so on the Linux kernel
turning the signal off changed the score by nothing at all. Fixed in the pre-public 0.4.0 cycle (+0.081 MRR on the
kernel, 95% CI [0.018, 0.148]), and the only reason it was ever found is that the benchmark used a
language the tests did not.

## Measured on a benchmark nobody here built

Everything above rests on either one developer's transcripts or a task `hay` was designed for.
The third leg is [SWE-Explore-Bench](https://arxiv.org/abs/2606.07297) — a public localization
benchmark built from SWE-bench: real GitHub issues, and gold files distilled from the code
regions that independent, *successful* agent trajectories actually consulted. Nobody involved in
this repository chose its repositories, its issues, or its ground truth.

`swe-explore.ts` samples 100 instances (seeded, ≤20 per language; the exact instance list is
committed in [`evidence/`](evidence/swe-explore-instances.json)), derives queries from each issue
by a fixed mechanical rule — backticked tokens, then identifier-shaped words, first five, no
tuning — and feeds the **identical queries** to `rg --sort path` and `hay` over the repository at
the issue's base commit. On 96 scored instances across eight languages:

| | ripgrep | hay | difference (95% CI) | randomization p |
|---|---|---|---|---|
| MRR (best query per instance) | 0.242 | **0.551** | **+0.309** [0.232, 0.388] | 0.0001 |
| gold file in top 10 | 40.6% | **68.8%** | **+28.1 pts** [19.8, 37.5] | 0.0001 |
| nDCG@10 | 0.225 | **0.375** | **+0.150** [0.108, 0.195] | 0.0001 |

Read the claim precisely, because the payload states it verbatim: given the same queries, hay's
reordering surfaces the files a successful agent needed earlier than ripgrep's path order. It is
**not** a claim that hay localizes issues — deriving good queries is the agent's job, and the
derivation rule here is deliberately dumb so that nothing per-instance can be tuned. The effect
is *larger* than on the private corpus, which is worth exactly one sentence of caution: these
gold files come from trajectories that solved the issue, a friendlier notion of relevance than
"whatever file one developer's agent opened next". Exclusions are counted in the payload: 215
`pro`-split instances lack public issue text; the fixed manifest contains 97 instances, and the
current run lost one, to a repository archive over the size budget. The payload also counts the
206 symlink members dropped from the extracted trees across those 96 repositories — ripgrep does
not follow symlinks, so the measured trees are unaffected, but the omission is stated rather than
assumed harmless.

*It nearly lost twenty-two.* The archive reader rejected any repository tarball containing a
symbolic link — the right instinct, wrong action: 21 of the 97 instances (django, sympy and
friends) silently stopped scoring on a clean machine, which is 22% of the only external evidence
this project has, disappearing over a member nothing here would have read. Links are now dropped
individually instead of failing the archive, still never written to disk, and ripgrep does not
follow symlinks anyway, so the extracted tree is identical for the measurement. It is instrument
error 13, and the only reason it was caught is that the numbers had to be regenerated.

## What is also useful here

Not a repo score. Two things:

```bash
bun harvest-queries.ts                       # build a test collection from your own agent transcripts
bun measure-mrr.ts --min-queries 60          # MRR per repo, scored against real behaviour
bun measure-mrr.ts ../some-repo              # the useful one: which searches are expensive HERE
bun doc-authority.ts ../some-repo            # which documents nothing has ever opened
```

The **within-repo diagnostic** is the frame that survived. Cross-repo scores compare badly and are
confounded by size, but within a single repository the rank of the answer varies enormously — 3 to
116 in one spot check — and each expensive query names a concrete thing to rename or to make
findable:

```text
  >1000   config
  >1000   export
    989   insert
```

That is actionable in a way a repo-level percentage never was.

The original scorer, `grep-hygiene.ts`, is kept for reproducibility. Its numbers should not be used
to judge a repository.

The measurement kit requires `bun` and `rg`; its sole runtime dependency is the maintained
`tar` parser at the untrusted SWE archive boundary. `hay` itself requires only Rust.
`corpus/` is gitignored — it contains real queries and paths from private repositories, and
[SECURITY.md](SECURITY.md) says what each tool reads. Changes are in
[CHANGELOG.md](CHANGELOG.md); contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md); the
license is MIT.

## How this number is reported, and why

The first version of the line above read **"+47%"**. That is a relative improvement of an
arithmetic mean, which is [the third of Fuhr's ten common mistakes in IR
evaluation](http://sigir.org/wp-content/uploads/2018/01/p032.pdf), and it came with no interval at
all — his seventh. It also compared twelve repository-level medians when the design is *paired* at
the query level with roughly a thousand observations, throwing away most of the available power.
For a project whose entire finding is that a metric was published as though validated and was not,
that was the same mistake one level up.

So the claim is now an absolute difference with a bootstrap interval, per [Smucker et al. (CIKM
2007)](https://dl.acm.org/doi/10.1145/1321440.1321528), who compared the tests IR actually uses and
found the randomization, bootstrap and t tests behave alike — while the Wilcoxon and sign tests
detect poorly enough that they recommend discontinuing them. Reproduce it with
`bun measure-mrr.ts --min-queries 60 --compare`.

**And the randomization test is now actually run, not just cited.** What Smucker et al. do is treat
Fisher's paired randomization test as the *reference* and validate the bootstrap and the t-test
against it. Citing that paper to justify shipping only the approximation it was used to check is
having the argument both ways — particularly since [their follow-up (SIGIR
2009)](https://dl.acm.org/doi/10.1145/1571941.1572085) finds the bootstrap systematically biased
toward smaller p-values than the t-test at smaller samples, which makes the one number this project
was reporting alone the one most likely to flatter it. Both are now reported at both levels of
clustering, and they agree.

MRR itself is contested: Fuhr argues reciprocal rank is an ordinal scale and averaging it is
invalid; [Sakai (2020)](http://www.sigir.org/wp-content/uploads/2020/06/p14.pdf) rebuts that the
argument leans on a taxonomy of measurement scales that is itself disputed. The table therefore
reports the answer-in-top-10 rate beside it, which is a proportion and immune to the objection, and
nDCG@10, which is graded by position and uses every judgment rather than the first. All three move
together.

nDCG is reported here and deliberately *not* in [BENCHMARK.md](https://mneves75.github.io/hay/benchmark.html), because the two
evaluations differ in exactly the way that decides it. The benchmark's ground truth is one
declaring file per symbol — single-positive and binary — where nDCG and MRR degenerate into the
same hit-or-miss signal, the standing criticism of code-retrieval benchmarks built that way.
The behavioural corpus averages 2.27 relevant files per query, so there the two measures genuinely
differ and both are worth having.

## Method, limits, and everything that went wrong

Full record: [the map](docs/method/map.md) and its tickets, especially
[01 — does this already exist?](docs/method/issues/01-prior-art-survey.md) and
[08 — does the score predict anything?](docs/method/issues/08-validate-the-metric.md).

**Limits, stated plainly.** n=12 repositories, one developer, one broad stack. Nothing clears
p<0.05, so this is an *absence of detected effect*, not a demonstrated null — the honest claim is
that the metric was published as though validated and was not. MRR's range is narrow (0.184–0.375),
which suppresses correlations. Behavioural relevance judgments are a proxy for real ones. MRR is
itself a proxy for the field's accepted outcome measures, tokens and tool calls per resolved task,
which nothing here has been tested against. The SWE-Explore result above is the first evidence
from data no one here collected — it removes the "one developer chose everything" objection for
`hay`'s ranking effect specifically, and none of the other findings inherit that cover.

**Instrument errors caught, in order.** Every one produced numbers that looked entirely reasonable:

1. `rg -r` does not rewrite match text in `--json` output — the first run "measured" names like
   `"class max"`.
2. The name sample was sorted alphabetically, so it only ever measured names beginning with `a`.
3. Occurrences were counted where ripgrep counts result lines (rg said 2, the code said 4).
4. All queries went into one ripgrep invocation; leftmost-first matching made `createClient` report
   **zero** whenever `create` was also present.
5. `percentile` was off by one — and the test asserted the wrong value, guarding the bug.
6. ripgrep skips hidden directories without `--hidden`, so `.scratch/` — the tool's own top
   suspect-prose location — was invisible. Fixing it moved the headline spread from ~100× to ~29×.
7. Inherited `RIPGREP_CONFIG_PATH` and local ignore files made the same commit score differently on
   different machines.
8. 57% of "answer" files did not contain the searched term, inflating a false ~47% unreachable rate.
9. Command segments were split on `|` before tokenising, so `rg "auth|session"` was harvested as the
   query `auth` — 35% of the test collection was truncated. Fixing this reduced repo size from
   ρ −0.762 to −0.559 and retracted a conclusion already written into these files.
10. **The two retrievers were not walking the same files.** Error 6 gave ripgrep `--hidden` in this
    harness and `hay` never got the matching flag, so for four versions the A/B compared a
    retriever that searched hidden directories against one that did not. Reproduced directly: with
    a definition inside a hidden directory, `rg --hidden` returns it and `hay` returns nothing. The
    published effect barely moved once fixed (+0.1318 against +0.131), but "it turned out not to
    matter" is a result you are only entitled to state *after* measuring it.
11. nDCG was capped by the wrong unit. The new metric counts distinct *files* while the scan
    stopped at 1,000 result *lines*, so a query whose first file carried a thousand matches would
    have scored nDCG 0 with the answer sitting at file-rank 2. Caught in review before publication;
    it fired on **0 of 953** queries, and the fix is still in because the next corpus is not this one.
12. **The same asymmetry again, in the other harness** — found by applying 10 as a rule instead of
    treating it as a patch. `benchmark.ts` let ripgrep honour the global gitignore and `.ignore`
    files that `hay` disables by design, so the "Δ MRR vs ripgrep" column was partly measuring which
    files got searched: **231 files against 225** on the ripgrep corpus. `differential-test.sh` had
    the correct symmetric invocation on both sides the entire time — the harness that proves
    correctness was rigorous, and the two that publish numbers were not.

13. **A safety check deleted 22% of the external evidence.** The SWE-Explore archive reader
    refused any repository tarball containing a symbolic link, so 21 of the 97 committed instances
    stopped scoring on a clean machine — a published sample quietly shrinking to 75 while the
    payload's own exclusion counter said so and nobody read it. Links are now dropped
    individually, still never written to disk. Every safety limit is a potential silent sampler,
    and this repo's own invariant 7 — count the truncations — is the thing that recorded it.

14. **A corpus that could not exist was reported as clean.** The Linux kernel has case-colliding
    paths, so a macOS checkout of it is altered by the filesystem itself — yet the benchmark
    recorded `dirty: false` for four releases, because `git status` answers from a stat cache and
    a fresh clone's cache says every entry is current. Thirteen files differed from the commit the
    report named, and ripgrep's kernel baseline was 0.508 instead of 0.541. Found because the
    provenance gate finally fired on a re-run — a gate that only fires once the cache goes stale
    is a gate you get to keep believing for a while.

Numbers 8, 9, 11, 12, 13 and 14 were caught before publication. The other eight were not. The correction
history is kept deliberately: it is more useful to anyone picking this up than the final table is.

## Prior art, which should have been read first

- [CodeSearchNet](https://arxiv.org/pdf/1909.09436) — the standard: 4,026 expert relevance
  judgments, MRR and NDCG@k. Retrieval measurement is a solved, named problem; there was no reason
  to invent a metric. It also shows independently that normalising identifier names collapses
  retrieval from MRR 0.809 to 0.419 — the naming argument, quantified, by someone else.
- [DOCER](https://arxiv.org/abs/2212.01479) — detects outdated *code-element references* in
  documentation across 3,000+ projects. Document-level authority is explicitly out of its scope,
  and remains the one genuinely unoccupied gap found in this survey.
- [Code-graph indexing for agents](https://anthonywest.co.uk/research/code-intelligence-indexing-2026-openai)
  — the ~10× result that makes the retriever, not the repo, the place to spend effort.
- Agent exclusion conventions (`.cursorignore`, `.aiexclude`, `.codeiumignore`) are
  [fragmented and non-standard](https://cursor.com/docs/reference/ignore-file); `.agentignore` is a
  proposal. Cursor states plainly they are not security boundaries.

### What ripgrep's author says about this exact idea

Worth reading before adopting `hay`, because it is the strongest available argument against it —
and it comes from the person whose engine `hay` runs on. Asked for relevance ordering, BurntSushi
answered that ripgrep [does not have a notion of relevance and "very explicitly does not rank
results and never will"](https://github.com/BurntSushi/ripgrep/discussions/2796); if you want
ranked results, you want an information retrieval system. In the
[ngram-indexing RFC](https://github.com/BurntSushi/ripgrep/issues/1497) he goes further and calls
it hubris to have thought he could do code-aware relevance ranking alone, judging it to need a paid
team, and rules ranking out of even an indexed ripgrep by design.

Both halves of that are load-bearing here. The first says the gap is real and permanent — it will
not be closed upstream, which is why a wrapper is the right shape. The second is a warning this
project has already partly earned: four of seven hand-designed signals were worth nothing or
worse, the definition signal was inert on C for four versions, the tool crashed on any non-ASCII
query for five, and it still fails its own ship gate. `hay` is not code-aware relevance ranking.
It is four structural priors, a tie-break and a layout rule, measured, with the ones that earned
nothing deleted — and the honest reading of the RFC is that this is the ceiling of what one person
should claim, not a step toward the thing he said needs a team. Note where the largest single gain
in 0.2.0 came from: not from understanding code better, but from noticing that the unit of an
answer is a file.

Two more recent results point the same way about *lexical* ranking specifically. Sourcegraph
removed embeddings from Cody in favour of an adapted BM25F over its code graph, on cost and scaling
grounds rather than quality ones; and the CoREB benchmark reports that short keyword queries — the
format agents actually emit — collapse nearly every semantic model tested to near-zero nDCG@10.
If that holds, the thing to improve for agent search is the ranking of a lexical retriever, which
is what this is.
