# Ablation artifacts

Payloads from ablation runs — measurements that decided whether a signal ships. They live here
because a deletion decision with no artifact is an assertion, and this project's whole complaint
about itself is assertions presented as measurements.

## `hint-signal` — built, measured, deleted (v0.3.1)

Opt-in `--hint <LITERAL>` task context: up to eight literals, +2.0 for full coverage in the matched
line or display path, never adding a match. Fixed in `docs/method/issues/14-task-aware-ranking-hints.md`
before measuring; its private confirmation protocol and the amendment that withdrew the first
private corpus are in `docs/method/issues/15-private-hint-confirmation.md`.

| set | control | hints | clustered Δ (95% CI) |
|---|---|---|---|
| SWE-Explore, 412 complete pairs (public) | MRR 0.2150 | MRR 0.2336 | **+0.0187** [+0.0063, +0.0325] |
| private one-shot, 494 complete pairs, 11 repositories | MRR 0.3819 | MRR 0.3799 | **−0.0020** [−0.0041, +0.0005] |
| private one-shot, nDCG@10 | 0.4159 | 0.4148 | **−0.0011** [−0.0045, +0.0004] |

The public payload is `evidence/swe-explore-hints.json`. The private run's aggregates are recorded
in issue 15 only; its corpus holds real queries and paths and never leaves `corpus/`.

`hint-signal.patch` applies to the tree that shipped v0.3.1 and restores the four files the signal
touched (`hay/src/main.rs`, `hay/src/score.rs`, `hay/tests/cli.rs`, `hay/differential-test.sh`)
byte-for-byte as measured. It has been applied and reverse-applied to prove the round trip. The
instrument (`swe-explore.ts --compare-hints`, `harvest-queries.ts --with-hints`,
`measure-mrr.ts --confirm-hints`) stays in the tree and refuses a binary without the flag:

```bash
git apply evidence/ablations/hint-signal.patch
cargo build --release --manifest-path hay/Cargo.toml
bun swe-explore.ts --compare-hints --out /tmp/hints.json
git apply -R evidence/ablations/hint-signal.patch
```

## `heading-signal` — built, measured, deleted (v0.3.0)

A markdown-heading signal: `## Foo` declares the section about `Foo` as `function foo` declares
`foo`. Aimed at the only row of the README's decision table where `hay` is measurably worse than
`rg --sort path`.

| set | heading OFF | heading ON | what it means |
|---|---|---|---|
| docs track, linux | −0.010 | **+0.190** | Δ MRR vs `rg --sort path` |
| docs track, openclaw | −0.072 | **+0.109** | |
| docs track, ripgrep | −0.087 | **+0.302** | |
| docs track, alamofire | −0.194 | **+0.151** | |
| docs track, hay | −0.054 | **+0.454** | |
| code track (ripgrep, alamofire, openclaw) | — | **+0.0000** | contribution to MRR; the signal never fires on a source file |
| SWE-Explore, 96 instances | hay MRR 0.5505 | hay MRR 0.5451 | **−0.0054**, a point estimate with no interval |

It did not ship. The docs track's ground truth *is* "this token appears in exactly one markdown
file's headings", so a heading detector wins there by construction rather than by working; that
circularity was written down before the numbers were taken (`docs/method/issues/13-heading-signal.md`).
SWE-Explore, the one public agent-shaped set nobody here designed, did not support it.

### Reproducing the "ON" measurements

The measured binary was never committed: the signal was implemented, measured and deleted inside
one session, so the "ON" state corresponds to no SHA. That is a reproducibility hole, and
`heading-signal.patch` is the repair — it applies to the tree that shipped v0.3.0 and rebuilds the
exact binary those payloads came from:

```bash
git apply evidence/ablations/heading-signal.patch
cargo build --release --manifest-path hay/Cargo.toml
bun benchmark.ts --docs-track --corpora <dir> --ablate no-heading --out /tmp/off.json   # OFF
bun benchmark.ts --docs-track --corpora <dir> --out /tmp/on.json                        # ON
git apply -R evidence/ablations/heading-signal.patch
```

The patch has been applied, built, and reverse-applied to prove it round-trips to a byte-identical
tree. It has *not* been used to re-derive the numbers above; those are from the original run.

### What these payloads cannot tell you

- **The docs-track "hay" row is not paired with the committed `evidence/docs-track.json`.** That
  corpus is this repository, which changed between runs, so its OFF baseline reads −0.054 here and
  −0.017 there. Compare the two columns in this table with each other and nothing else.
- **The SWE-Explore difference has no interval.** `swe-explore.ts` reports intervals against
  ripgrep, not between two hay variants, and it emits no per-instance rows to compute one from. On
  n=96 a difference of 0.0054 is not distinguishable from zero, and the deletion does not rest on
  it — it rests on the circularity.
- **`hayAblation` is absent from these four payloads.** They predate the field that records which
  signals a run turned off; every payload written after v0.3.0 carries it.
