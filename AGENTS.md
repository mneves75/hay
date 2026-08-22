# AGENTS.md

Instructions for a coding agent working in this repository. Read this before changing anything.

## What is here

Two things, and it matters which one you are touching.

- **`hay/`** — a ranked grep in Rust. Drop-in for `rg`, reorders results so the definition comes
  first. This is the shipped product.
- **The measurement kit** (`harvest-queries.ts`, `measure-mrr.ts`, `doc-authority.ts`) — turns
  local agent transcripts into a retrieval test collection with behavioural relevance judgments.
  This is the instrument, and it is what falsified the project's original metric.
- `grep-hygiene.ts` is that falsified metric, kept only so the negative result is reproducible.
  **Do not use its numbers to judge a codebase**, and do not extend it.

`README.md` has the findings, `HOWTO.md` the commands, `DESIGN-hay.md` the design and every
review, `BENCHMARK.md` the tool comparison with `BENCHMARK_FEYNMAN.md` explaining its method from
first principles, `docs/method/` the tickets, `MEMORY.md` and `memory/` the running state.

## Searching

Use `hay` instead of `rg` for concept searches in this repo — it is the tool, and dogfooding it is
how its gaps get found. Same flags, same `path:line:text`. Use `rg` when you need every match, an
exact count, `-v`, or ordering by path.

Structural queries use `ast-grep`, not text search, unless plain text is the point — here it
sometimes genuinely is, because the subject under study is what plain text does.

## Commands

```bash
cargo build --release --manifest-path hay/Cargo.toml
cargo test --manifest-path hay/Cargo.toml          # unit + tests/cli.rs contract tests
cargo clippy --manifest-path hay/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path hay/Cargo.toml --check
./hay/differential-test.sh                          # hay returns exactly rg's matches
bun measure-mrr.ts --selftest                       # each TS tool has a selftest
bun measure-mrr.ts --min-queries 60 --compare       # paired A/B with bootstrap intervals
./benchmark-corpora.sh                              # clone missing corpora, run, render, clean up
bun benchmark.ts --sample 30                        # public-corpus comparison, all tools
bun benchmark-report.ts                             # renders BENCHMARK.md + benchmark.html
bun install --frozen-lockfile && bun run typecheck
bun audit
```

There are two evaluations and they answer different questions. `measure-mrr --compare` is
**behavioural** — real agent searches against the files the agent opened next — and its ground
truth was not designed around the tool, which makes it the stronger evidence and also the one
nobody else can reproduce, because the transcripts are private. `benchmark.ts` is **public and
reproducible** — anyone can clone the corpora — but its task is definition-finding, which is
exactly what `hay` optimises for, so a win there is weaker than it looks. Report both, and say
which is which.

Run the differential test on any change to walking, matching or output. It has caught three
defects that no unit test could, because each changed *which files got searched* rather than how
a line scored.

## Invariants — do not break these

1. **`hay` returns exactly ripgrep's matches, only reordered.** `differential-test.sh` must stay
   at 0 differing. If a change makes it impossible, the change is wrong.
2. **Rank order is the product.** Nothing may reorder results — not context windows, not block
   grouping, not deduplication. A fix that reorders is worse than the bug it replaces.
3. **The pre-registered ship gate does not move.** Median MRR >= 0.50 and answer-in-top-10 >= 80%,
   fixed in `DESIGN-hay.md` before implementation. It currently fails. Failing a gate you wrote
   down is the point of writing it down first.
4. **`corpus/` is never committed.** It holds real queries and paths from private repositories.
   Publish only aggregates, with `path=label` and `--redact-names`.
5. **Never weaken an error into silence.** Exit 1 means "searched fine, found nothing"; exit 2
   means the answer is incomplete. Every serious defect in this repo's history was a quiet wrong
   answer, never a crash.
6. **Both retrievers see the same files, in every harness.** Every filtering flag given to `rg`
   must have an exact counterpart in `hay`'s invocation or inside `hay` itself, and vice versa.
   Violated in *both* measurement harnesses at once: `measure-mrr.ts` gave `rg` `--hidden` and not
   `hay` (four versions), and `benchmark.ts` let `rg` honour the global gitignore and `.ignore`
   files that `hay` deliberately disables (231 files vs 225 on the ripgrep corpus). Meanwhile
   `differential-test.sh` had it right on both sides the whole time — **copy its invocation**, and
   when you touch `retrieverArgv` or `TOOLS`, name the counterpart for every flag on both sides.
7. **A metric's cap must be in the metric's own unit.** MRR counts result lines; nDCG counts
   distinct files. Sharing one budget silently scored nDCG 0 for queries whose first file was
   noisy. If you add a measure, give it its own stopping condition and *count* the truncations.

## How to make a claim here

This repository exists because a number was published as though validated and was not. So:

- **No relative improvements of arithmetic means.** "+47%" is not a result. Report the absolute
  difference with a 95% interval — `measure-mrr.ts --compare` computes a paired bootstrap over
  per-query reciprocal ranks, both by query and clustered by repository.
- **Pair the comparison.** The design is paired at the query level; comparing per-repo marginals
  at n=12 throws the power away.
- **Ablate every ranking signal and delete the ones that earn nothing.** Three of six original
  signals contributed <= 0 and were removed; removing one *improved* the score.
- **Do not fit the weights on the behavioural corpus.** Develop against the public benchmark and
  confirm on the behavioural one; never tune the numbers you publish on the set you tuned against.
  A held-out corpus from *another developer's* transcripts is still missing and would be better
  than either.
- **Measure which thing to build, do not guess.** The largest gap in the CLI was combined short
  flags (`-in`), 3,562 real occurrences; `--smart-case`, the obvious thing to add on instinct, was
  not in the top 28. The same applies to ranking signals: when a rule regressed Rust, counting what
  actually preceded each false positive fixed it, and imagining what might have would not have.
- MRR is contested — Fuhr (SIGIR Forum 2018) argues reciprocal rank is ordinal and should not be
  averaged; Sakai (2020) rebuts. Report the top-10 rate, a proportion, and nDCG@10, graded by
  position, beside it. All three are computed by `--compare`.
- **Run the reference test, do not just cite it.** Smucker et al. treat Fisher's randomization test
  as the standard and validate the bootstrap against it; their 2009 follow-up finds the bootstrap
  biased toward smaller p at small samples. `--compare` reports both, at both clustering levels.
  Citing a paper for the approximation it was used to *check* is having the argument both ways.
- **Use every judgment you have.** The corpus averages 2.27 answer files per query, so a first-hit
  measure discards most of it. Add nDCG only where relevance is genuinely multi-positive: in
  `benchmark.ts` the ground truth is one declaring file per symbol, where nDCG and MRR degenerate
  into the same hit-or-miss signal and reporting both would be padding.

## Before hand-rolling anything

Two of the worst defects in 0.2.0 were hand-rolled versions of something a dependency already did
correctly: `-w` as `\b...\b` (cannot match a punctuation-edged pattern, returned nothing with exit
1) and a bespoke UTF-8 contract that discarded every match in a Latin-1 file. `hay` uses ripgrep's
own crates and `lexopt` deliberately. Check what they already implement before writing the code.

## Style

Rust edition 2024, MSRV 1.85, no `unsafe`, clippy clean under `-D warnings`. Comments explain why
a non-obvious thing is the way it is — several encode a defect that already happened, so do not
delete them as noise. TypeScript tools are dependency-free and run under `bun`.

Conventional Commits. Update `CHANGELOG.md` for anything user-visible.
