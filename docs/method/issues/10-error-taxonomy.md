# 10 — Error taxonomy: where the remaining 42% actually goes

**Status:** counted. **Population:** every miss (answer not in hay's top 10) and every regression
(hay's RR below ripgrep's) from the 952-pair 2026-08-20 run — 466 queries, one primary category
each, assigned by `categorize-misses.ts` in priority order so the counts sum to the population.
Aggregate counts are published in `evidence/error-taxonomy.json`; the labeled records stay in
`corpus/` (invariant 4).

## The counts

| category | n | share | meaning |
|---|---|---|---|
| answer-penalized-class | 146 | 31.3% | every answer file is a class hay's path prior pushes down |
| both-lose | 145 | 31.1% | ripgrep also missed the top 10 |
| definition-lang-gap | 98 | 21.0% | every answer file is a language the definition signal was never tested on |
| reordering-regression | 41 | 8.8% | hay alone made it worse |
| generic-flood | 36 | 7.7% | ≥1,000 result lines under ripgrep |
| truncated | 0 | 0% | hay's candidate cap never fired on this corpus |
| invisible-asymmetric | 0 | 0% | no one-sided blindness — the parity fixes hold |

Sub-counts that matter:

- **answer-penalized-class is mostly prose (78) and tests (53).** Agents genuinely open `.md`
  files and tests after a search; hay penalizes both by design. See "what was NOT changed" below.
- **definition-lang-gap is Swift: 106 of the answer-file extensions.** Not Python, not Go — the
  corpus is one developer's, and that developer ships iOS apps. The public benchmark gets a Swift
  corpus before any Swift-motivated change.
- **All 145 both-lose answers are rankable** — every one was inside hay's result stream, just past
  rank 10. "Ripgrep also failed" is not a ceiling for a reranker; the initial framing of this
  category as unwinnable was wrong and the manual pass killed it.

## The manual pass (40 inspections, seeded, `--explain`-assisted)

Two defects and one honest confound, each observed repeatedly, none imagined:

1. **The keyword scan fires on calls and type positions.** `const body = await
   readOptionalJsonBody(...)` scores `def +6.0` for the query `readoptionaljsonbody` because
   `const` is within the 4-token window — but `const` declares `body`, not the match. The same
   shape in Swift (`let semantic = SemanticFingerprint(...)`) drives the Swift bucket, and in type
   position (`const results: Array<FeedSource>`) the keyword declares nothing the query names.
   Thirteen identical call-site "definitions" outranked the real answer in one inspected query.
   Fix shipped: the segment between the declaration keyword and the match must not contain `=` or
   `:` — if it does, the keyword declares something else.

2. **TS optional properties are declarations the `name:` rule missed.** `APPLE_CLIENT_ID?:
   string;` scored `def +0.0` while test-fixture object keys (`APPLE_CLIENT_ID: "..."`) scored
   `def +6.0` — the declaration lost to its own fixtures on a one-character technicality (`?`).
   Fix shipped: `name?:` counts like `name:`.

3. **The confound: sometimes the agent wanted a usage, and hay found the definition.** In several
   inspected regressions, hay ranks the true definition first and is scored *worse* because the agent
   opened a registration/import/usage site. Behavioural ground truth measures "what this agent
   opened next", not "what defines this"; on those queries the two goals disagree and hay loses
   points for succeeding at its stated one. This is a property of the metric worth this paragraph,
   not a defect to fix — reranking toward usage sites would surrender the product.

## What was NOT changed, and why

- **Path-class weights stay put this cycle.** The 78 prose-answer and 53 test-answer queries could
  only be improved by re-fitting penalties on the behavioural corpus — the corpus the gate is
  checked on. The public benchmark has no prose ground truth, so there is no legitimate
  development set for that change yet. Recorded as the largest known *unaddressable* bucket rather
  than quietly fitted.
- **generic-flood (36) is deferred** — smallest actionable bucket; filename/path-token boosts are
  the candidate when its turn comes.

## Stopping condition

Pre-stated: hand-labeling stopped at 40 of the planned 80 because the same two mechanisms
recurred by inspection 30 with no new mechanism after; categories under 5% of the population are
not acted on this cycle. Signals built from these counts are developed and ablated on the public
benchmark only, then confirmed on the behavioural corpus in one run (issue 08's rule).
