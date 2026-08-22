# 08 — Does the score predict anything?

Type: prototype
Status: resolved
Blocked by: 01

## Question

The score has never been shown to predict an outcome. Build the retrieval test collection this
project should have started with, measure the standard metric (MRR) against it, and find out
whether `proseShare` and the addressability numbers explain how far an agent actually reads before
reaching its answer.

If they do not, the score does not measure what the README claims and the project must be re-aimed.

## Answer

**They do not. `proseShare` has essentially zero relationship with retrieval difficulty — and at
this sample size, nothing else reaches significance either.**

### The test collection

`harvest-queries.ts` mines 3,144 local agent transcripts. This agent searches with `Bash` + `rg`
rather than a structured search tool, so queries were recovered by tokenising shell commands; every
transcript line carries `cwd`, which gives the repository. Relevance comes from behaviour: the
files the agent opened in the next few tool calls, the same click-through logic search engines have
used for decades. Result (after the parser correction described below): **2,508 judged queries across 68
repositories**, in under five seconds.

One correction was needed before the judgments were usable. Measured on one repo, **57% of the
files an agent opened after a search did not contain the searched term at all** — they could never
appear in that query's results and were being silently scored as "unreachable" (which is why the
first run showed a false ~47% unreachable rate). A file that does not contain the term was not
reached by matching it. Restricting answers to files that contain the query dropped unreachable to
0-12% and is the version used below.

### The metric

`measure-mrr.ts` fixes the retriever (ripgrep, because that is what agents run) and varies the
corpus — CodeSearchNet inverted. RR = 1/rank of the first result line in an answering file.

`--sort path` is mandatory: **ripgrep's default output order is nondeterministic** under parallel
traversal (verified — three identical runs produced three different orderings). Without pinning it
a rank metric is not reproducible, and it means an agent genuinely gets a different first page on
each identical search.

### Results — 12 repos with >= 60 judged queries

| repo | MRR | answer in top 10 | proseShare | suspectShare | <3 words | code files |
|---|---|---|---|---|---|---|
| A | 0.375 | 62% | 13.6% | 1.3% | 37% | 62 |
| B | 0.365 | 60% | 12.3% | 5.3% | 68% | 50 |
| C | 0.364 | 58% | 16.8% | 7.6% | 28% | 157 |
| D | 0.338 | 55% | **40.8%** | **38.4%** | 32% | 645 |
| E | 0.281 | 49% | 13.6% | 8.4% | 19% | 200 |
| F | 0.270 | 47% | 17.5% | 10.2% | 35% | 1198 |
| G | 0.261 | 49% | 13.9% | 4.5% | 28% | 470 |
| H | 0.255 | 54% | **3.9%** | **0.6%** | 41% | 1165 |
| I | 0.254 | 41% | 15.9% | 5.2% | 38% | 165 |
| J | 0.221 | 40% | 28.7% | 18.6% | 39% | 402 |
| K | 0.218 | 35% | 11.5% | 8.3% | 31% | 553 |
| L | 0.183 | 34% | 17.5% | 14.4% | 27% | 701 |

Spearman rho against MRR, n=12. Significance needs |rho| > 0.587 (p<.05), or > 0.77 after
Bonferroni across six tests. Ranks are tie-corrected.

| variable | raw rho | partial rho (size controlled) |
|---|---|---|
| repo size (code files) | -0.559 | — |
| **proseShare** | **-0.035** | **+0.043** |
| suspectShare | -0.126 | +0.004 |
| shareUnder3Words | 0.053 | 0.317 |
| medianWords | -0.226 | -0.458 |
| p90Hits | -0.460 | -0.512 |

**Nothing reaches significance, including repository size.** `proseShare` — the headline number of
this project — sits at **-0.035**, indistinguishable from no relationship at all, and does not
improve when size is controlled. The least-bad candidate is `p90Hits`, the tail of the
addressability distribution (-0.512 partial): suggestive, not significant, worth a larger sample
rather than a claim.

The extreme cases make it concrete. Repo **H** has the cleanest `proseShare` in the set (3.9%) and
sits 8th of 12 on MRR. Repo **D** has by far the worst prose and suspect shares (40.8% / 38.4%) and
ranks **4th best**. `proseShare` varies **10.4x** across these repos; MRR varies **2.0x**.

### A correction, mid-ticket

The first version of this answer reported repo size at rho -0.762 and called it the one significant
predictor. That was measured on a corpus with a parser bug: command segments were split on `|` and
`;` *before* tokenising, so `rg "auth|session"` was harvested as the query `auth`. Fixing it removed
**1,147 of 3,307 entries (35%)** as truncated and added 348 correct ones. On the corrected corpus
size falls to -0.559, below significance. What survived both versions unchanged is the finding that
matters: `proseShare` explains nothing either way.

That is the third time in this project a conclusion moved after the instrument was fixed — and the
first time the check happened *before* the number was published rather than after.

### What this does not prove

- n=12, one author, one broad stack. Nothing clears p<.05, so this is an *absence of detected
  effect*, not a demonstrated null.
- MRR's range is narrow (0.184-0.375), which suppresses correlations by restriction of range.
- Behavioural relevance is still a proxy; a stricter judgment would be a human-labelled set.
- Absence of evidence at n=12 is not evidence of absence. The claim is that **the metric was
  published as if validated and it is not**, not that documentation load provably never matters.

### What follows

1. `proseShare` cannot be presented as a measure of reading cost. Corrected in the README.
2. A repo-level score is the wrong frame at this sample size. **Within-repo is better anyway**: you
   cannot change how big your codebase is, but you can find out which queries inside it are
   expensive — and ranks vary far more within a repo (3 to 116 in one spot check) than the repo
   averages vary between repos.
3. MRR is uniformly poor everywhere — median rank 5-28, answer in the top 10 only 34-62% of the
   time, in **every** repo regardless of hygiene. That points at the **retriever**, not the corpus,
   and matches ticket 01: plain grep is roughly uniformly mediocre, and adding priors is what buys
   the published ~10x. The wolf is closer to "grep is prior-free" than to "your codebase is bad".
4. If anything here deserves a bigger sample it is `p90Hits` — the tail of the name-ambiguity
   distribution — not `proseShare`.
