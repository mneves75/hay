# 11 — Cycle 2: the plan to done

**Status:** P1 and P7 done (2026-08-23); **P2 is blocked by P1's own counts** — see the result
below. **Pre-registered before any cycle-2 code was written**, per this repo's habit of fixing
the target before shooting.

> **P1 result (2026-08-23, `evidence/docs-track.json`, after review corrections):** the
> indictment is now public and quantified — on doc-answerable queries hay loses to ripgrep by
> **−0.440 MRR [−0.586, −0.298]** on the ripgrep corpus and **−0.340 [−0.471, −0.217]** on
> alamofire, both tests p ≈ 0.0001. On this repo as corpus (mostly markdown) the delta is ~0.
> The shape story only emerged after autoreview caught PascalCase classified as `plainWord`
> (`AuthenticationInterceptor` — the first cut published "30/30 plain words" on a
> misclassification): **the dominant doc-answerable shape is PascalCase type names whose
> canonical description lives in markdown** (27/30 on alamofire, Δ −0.365; n=8 on ripgrep,
> Δ −0.783), with plain words second. That still blocks P2 as pre-registered: PascalCase is
> also the shape of the code track's type queries, so a shape-keyed damp would fire exactly
> where hay's definition signal earns its living. The next candidate conditioning feature is
> **corpus-side evidence at ranking time** (e.g. what share of a token's matches land in
> prose), which is a different signal design and needs its own pre-registration.

"Done" here does not mean the ship gate passes. It means **nothing is unverified, nothing is
unmeasured, and every remaining gap is either closed or explicitly bounded** — the state where a
skeptical reviewer finds decisions and counts, not hand-waving. The gate (median MRR ≥ 0.50,
top-10 ≥ 80%) stays where issue 05 fixed it; whether cycle 2 passes it is an outcome, not a
requirement.

## Where the loss actually is (issue 10's counts, n=466)

| bucket | share | status |
|---|---|---|
| answer-penalized-class (prose 78, tests 53) | 31.3% | unaddressable without a prose dev set — **P1 builds it** |
| both-lose, all rankable | 31.1% | needs new signals — P3 |
| definition-lang-gap (Swift) | 21.0% | dev corpus exists (alamofire) since 0.1.0 |
| reordering-regression | 8.8% | shrinks or grows with every signal change; watched, not targeted |
| generic-flood | 7.7% | filename/path-token boost is the named candidate — P3 |

## Phases

### P1 — Docs-track development set (this cycle)

The prose bucket cannot be worked on because the public benchmark has no prose ground truth and
fitting on the behavioural corpus would contaminate the only evaluation set (issue 08's rule).
Build the missing instrument: a **mechanical, public** doc-answerable query set.

**Derivation rule** (fixed here, before implementation): a query is an identifier-like token that
appears in an ATX heading of **exactly one** markdown file in the corpus and in **≥ 3 files**
overall (so ranking is non-trivial); the answer is that markdown file. This is the tutorial-title
pattern from the literature (titles as queries, the titled document as ground truth) with the
LLM-phrasing bias removed — queries are identifier tokens, not prose, so neither retriever gets a
phrasing advantage. Each query records its shape features (flag-shaped `--x`, hyphenated,
snake_case, UPPER_CASE, camelCase, plain word): **the per-feature deltas are the counts that
decide whether P2's signal exists and what conditions it** — counted, not imagined, per issue 10.

Mechanics: same rank unit as the code track (result lines, same cap, truncations counted — its
own stopping condition per invariant 7), identical tool invocations (invariant 6, verbatim
`TOOLS` argv), seeded sampling, paired bootstrap + Fisher randomization at the same thresholds,
own evidence file (`evidence/docs-track.json`), selftest that pins the derivation rule on a
fixture tree with no network. Report renderers add a docs-track section only when that evidence
exists; with no docs evidence their output stays byte-identical (CI staleness gate).

**Acceptance:** selftests + typecheck green; a real run on ≥ 2 public corpora published to
evidence with per-feature splits; the expected indictment quantified (hay should *lose* to rg
here today — that number is the target P2 must move without breaking the code track).

### P2 — Query-conditional path prior (gated on P1's counts)

Only if P1 shows a query shape whose doc-answer share makes the penalty a measured cost. A signal
in `score.rs` behind an ablation switch (a contribution you cannot switch off is a belief),
developed on the docs track, **required not to regress the code track** beyond its intervals,
then confirmed on the behavioural corpus in **one** run. Differential test must stay 0 differing
(ranking-only change). Gate re-computed and reported wherever it lands.

### P3 — The rankable-but-deep 62%: filename/path-token boost, then further signals

Same discipline per signal: enumerate what actually precedes the false positives, ablate, delete
what earns ≤ 0. Filename boost first — it is the named candidate for generic-flood and plausibly
helps both-lose. Later cycle.

### P4 — Weight fitting without contamination

Hand-set weights → coordinate search on the public tracks only, spec pre-registered in
`DESIGN-hay.md` (search space, objective, seed) before running; frozen result confirmed once
behaviourally. Never fit on the corpus the gate is checked on.

### P5 — External validity for the behavioural claims

A second developer's transcripts through `harvest-queries.ts` on *their* machine, aggregates
only. Requires a collaborator — outside this repo's unilateral control; the instrument is ready.

### P6 — The outcome measure

MRR is a proxy. The field's accepted outcome is tokens and tool calls per resolved task: a
pre-registered A/B (agent + hay vs agent + rg, same tasks, fixed harness). Largest missing piece
of the whole argument; needs harness design and budget. After P2-P4.

### P7 — Engineering closure (this cycle)

- **Release binaries for the platforms CI already proves**: a tag-triggered workflow building
  macOS (arm64/x86_64), Linux (x86_64/arm64), Windows; sha256s; assets attached to a **draft**
  release — publishing stays a human act.
- **Differential test on Windows**: CI tests Windows but the parity property — the claim the
  tool lives by — has never run there. Run it under Git Bash with a choco-installed ripgrep.
- Out of scope until explicitly asked: crates.io publication, Homebrew tap.

## Satisfaction ledger

100% satisfied = P1-P4 done under the discipline above, P7 shipped, P5/P6 either done or
honestly bounded with their instruments ready and their absence stated wherever results are
published. The gate's pass/fail is reported, never engineered.
