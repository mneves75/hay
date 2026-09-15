# 15 - One-shot behavioural confirmation for task hints

**Status:** corrected one-shot CONTRADICTORY — `--hint` deleted before release (2026-09-15)

Issue 14 fixed the public experiment before its result was known. That public result has now been
observed, but its ship rule also requires no contradictory one-shot result on the private
behavioural corpus. This file fixes that confirmation method before deriving private hints or
running either arm. Its purpose is confirmation, not another place to tune the signal.

## Observation and task context

The source is the same local Claude JSONL transcript set used by `harvest-queries.ts`. For each
concept-search tool call:

1. the primary query is recovered by the existing quote-aware command parser;
2. task context is only the most recent external user message whose content is a plain string and
   which occurred before that tool call;
3. assistant prose, tool results, tool inputs other than the search command, reads, edits, result
   lists, clicked files, and future messages are forbidden inputs;
4. hints use the already-frozen `hderive-v1` rule, excluding the primary query;
5. relevance remains the next three `Read`/`Edit` file opens before another search, and an answer
   file is usable only when it contains the primary query.

The observation unit is one distinct `(real repository path, lower-cased query, ordered hints)`
triple. Repeated identical triples combine their behavioural judgments rather than receiving extra
weight. Zero-hint observations stay in the evaluation as exact control/treatment ties.

The current `hay` checkout is excluded: it contains the feature and its evaluation documents, so
using searches made while developing the treatment would be direct development-set contamination.
No other repository is selected or excluded after seeing an effect. Repositories need at least 40
candidate observations, matching the measurement kit's existing default; after answer validation,
the confirmation is informative only with at least five repositories and 100 paired observations.

## Paired comparison

- control: the current release-built `hay`, with no hint flags;
- treatment: the same binary and primary query, with the observation's repeatable `--hint` values;
- metrics: reciprocal rank, answer-in-top-10, and nDCG@10;
- effects: absolute treatment-minus-control differences, paired by observation;
- uncertainty: 10,000-replicate paired bootstrap and Fisher sign randomization, both by observation
  and clustered by real repository path;
- diagnostics: better/worse/tied, zero-hint observations, candidate-cap counts, and first-page
  truncation counts for both arms.

Only aggregate output may leave `corpus/`; no query, path, hint, repository name, or transcript ID
is written to committed evidence or documentation.

## Decision rule

The public issue-14 gate must already pass. The hint signal is then retained only if this first
private run has at least five repositories and 100 pairs, and both primary point estimates are
non-negative: delta MRR >= 0 and delta nDCG@10 >= 0. A clustered interval wholly below zero, or a
clustered Fisher p < .05 for a negative effect, is also contradictory. Top-10 is reported but is
not an additional pass condition.

Any failure deletes the signal. The derivation rule, weight, exclusions, observation unit, minimum
sample, or decision rule do not move after the numbers are seen.

## Amendment — 2026-09-15, written before the corrected corpus was harvested or run

**Status change:** the frozen 2026-08-31 corpus is withdrawn as confirmation evidence.

A spec review found that the harvester's task-context filter (`type`, `userType`, `role`, string
content) admitted rows that have the shape of a user message but whose text no human typed. Counted
in the transcripts on disk at 2026-09-15, 1,348 files:

| row class that passed the old filter (classes overlap) | rows |
| --- | ---: |
| subagent prompts written by the parent assistant (`isSidechain`) | 1,015 |
| skill bodies and caveats (`isMeta`) | 533 |
| background-task notifications carrying agent results | 372 |
| captured command output (`<local-command-stdout>`, `<bash-stdout>`) | 298 |
| scripted or system prompts (`promptSource` sdk/system) | 34 |
| compaction summaries (assistant prose) | 24 |

Rule 3 above names assistant prose and tool results as forbidden inputs, so a corpus harvested with
that filter does not implement this protocol, and its historical non-contradictory result cannot
confirm anything. The corpus stores derived hints, not their source message, so it cannot be
repaired mechanically.

What changes, fixed now, before any corrected number exists:

1. **Task context** is the most recent row that `humanTaskText` accepts: a `user`/`external` row
   with plain-string content that is not `isSidechain`, `isMeta` or `isCompactSummary`, whose
   `origin.kind` is `human` when present, whose `promptSource` is neither `sdk` nor `system`, and
   whose text does not open with an injected tag (`task-notification`, `local-command-*`,
   `bash-stdout`/`bash-stderr`, `system-reminder`). A typed slash command stays task context.
   Subagent searches therefore carry zero hints and remain as exact ties, as rule "zero-hint
   observations stay" already requires.
2. **Corpus:** re-harvested once, with the corrected filter, into
   `corpus/hint-queries-2026-09-15.json`. Claude Code keeps 30 days of transcripts, so the window is
   2026-08-15 to 2026-09-15 and overlaps, but is not, the withdrawn corpus's window.
3. **Exclusion:** "the current hay checkout" becomes any checkout sharing this repository's root
   commit — a worktree or sibling clone contains the same feature and documents, which is the
   exclusion's stated reason. The report field is renamed `hayCheckoutObservations`.
4. **Reconciliation:** candidates dropped before pairing are now counted
   (`droppedBeforePairing.noValidAnswer`, `.noVisibleMatch`), so candidate observations equal paired
   plus dropped.

What does not change: `hderive-v1`, the +2.0 weight, the observation unit, the 40/5/100 minimums,
the metrics, both statistical tests at both clustering levels, the aggregate-only boundary, and the
decision rule — including that any failure deletes the signal. This rerun is not a second chance to
tune: the withdrawn run was non-contradictory, so replacing it can only remove a pass, never create
one. It runs exactly once.

## Result

### Corrected one-shot — 2026-09-15, authoritative

Run once, after the amendment above was written, on `corpus/hint-queries-2026-09-15.json` (1,381
observations, 565 with hints, 41 repositories) with the release-built candidate binary and the
root-normalized, human-only runner.

| | control | hints | clustered difference (95% CI) | clustered Fisher p |
| --- | ---: | ---: | --- | ---: |
| MRR | 0.3819 | 0.3799 | **−0.0020** [−0.0041, +0.0005] | 0.3408 |
| nDCG@10 | 0.4159 | 0.4148 | **−0.0011** [−0.0045, +0.0004] | 0.3452 |
| top-10 | 0.6640 | 0.6660 | +0.0020 [−0.0088, +0.0071] | 1.0000 |

By observation: MRR −0.0020 [−0.0060, +0.0008], p=0.3628; nDCG@10 −0.0011 [−0.0047, +0.0020],
p=0.5178. Better/worse/tied by MRR: 25/15/454. Zero-hint pairs: 267 of 494.

Reconciliation: 11 repositories met the 40-candidate minimum with 1,037 candidate observations;
527 had no valid answer and 1 had no visible match, leaving 509 observed pairs, of which 15 hit the
candidate cap in both arms and were excluded, leaving **494 validated pairs**. Excluded before that:
5 observations from checkouts of this repository, 26 from repositories no longer on disk, and 313
from 25 repositories below the minimum. Page truncation: 0/0.

**Decision: contradictory.** The run is informative (11 ≥ 5 repositories, 494 ≥ 100 pairs), and
both primary point estimates are negative (`negative-mrr-point-estimate`,
`negative-ndcg10-point-estimate`). No interval is wholly below zero and no Fisher p is below .05;
the rule does not require either, and it does not move now that the numbers are known. The signal
is deleted.

What this does and does not show: the private effect is indistinguishable from zero and slightly
negative, against a public effect of +0.0187 [+0.0063, +0.0325]. Hints derived from what a human
actually typed did not help real agent searches, while hints derived from SWE-Explore issue text
did. The public set's issue text is written to describe a bug precisely; a developer's message to
an agent often is not. That explanation is a hypothesis, not a finding, and nothing here tests it.

### Historical pre-root-normalization aggregate (withdrawn: harvested with the non-human filter)

This aggregate is no longer authoritative. A 2026-08-31 review found that the runner canonicalized
symlink aliases with `realpath` but treated each transcript CWD as a repository. Searches from
`/repo` and `/repo/src` therefore formed separate observation units and bootstrap clusters, and
their answer paths were relative to different roots. That violates the pre-registered “real
repository path” unit and can change eligibility, pair counts, and intervals.

The runner and harvester now resolve the nearest real Git root and rebase judgments before
combining observations. The exact frozen `corpus/hint-queries.json` is not present in this
checkout, so the correction cannot be recomputed here. The original corpus must be rerun without
re-harvesting transcripts or changing hints, thresholds, exclusions, or the decision rule.
Until then the private gate is pending and `--hint` is not release-authorized.

The same frozen historical corpus was rerun after the post-run instrument audit described below;
no transcript was re-harvested, no hint was re-derived, and no threshold or decision rule moved.
The runner observed 713 paired observations across 12 repositories and excluded 11
candidate-capped pairs from inference, leaving 702 complete pairs. One additional historical pair
was removed before pairing because its only valid judgment was a symlink that neither retriever
follows.

The corrected point estimates remain non-negative: MRR **0.4338 -> 0.4414** and nDCG@10 **0.4763
-> 0.4837**. The repository-clustered dMRR is **+0.0076** [−0.0004, 0.0174], Fisher p=0.1587;
clustered dNDCG@10 is **+0.0074** [0.0006, 0.0157], p=0.0821. Top-10 moves **0.7393 ->
0.7450**. Better/worse/tied by MRR: 49/41/612. Zero-hint pairs: 265. Candidate-cap counts are
11/11; first-page truncation remains 0/0. This historical runner returned
**non-contradictory**, but that decision does not satisfy the corrected instrument.

This remains confirmation, not public evidence. Only these aggregates leave `corpus/`; no query,
path, hint, repository name, or transcript ID is committed.

### Original record and post-run instrument audit

The first run reported 714 pairs across 12 repositories, MRR **0.4272 -> 0.4340**, nDCG@10
**0.4709 -> 0.4777**, and 49/42/623 better/worse/tied by MRR. Those values are retained here as
the historical first-run record, not as the current estimate.

A P3 review found that the original inference included candidate-capped pairs even though hints
participate in prescore and can therefore change which candidates survive. The corrected runner
keeps cap and page-truncation counts visible but excludes the union of incomplete pairs from every
effect, interval, randomization test, direction count, and zero-hint denominator.

The rerun also closed three earlier instrumentation deviations without changing the observation
source:

- The raw historical array was wrapped with `hderive-v1`; no observation was added or re-derived.
  Its single empty repo-root judgment was removed mechanically, matching the original
  `validAnswers` behavior that discarded it before pairing.
- One query whose only usable answer was a symlink was dropped. The old validator read through the
  link even though ripgrep and hay do not follow it, so it could never be a reachable judgment.
- The current checkout is excluded by canonical root and descendant path. Progress output reports
  repository indices only; the original internal session had printed names, but none entered a
  committed artifact or left the machine.

The correction changes the authoritative counts and estimates, but not the retention conclusion.
It is a transparent repair of the instrument after the one-shot, not a second opportunity to tune
the signal.
