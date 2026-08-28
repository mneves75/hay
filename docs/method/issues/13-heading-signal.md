# 13 — The heading signal, and a benchmark that cannot judge it

**Status:** closed, signal deleted (v0.3.0, 2026-08-28)

## The question

The README's decision table sends readers to `rg --sort path` for documentation search, because
`hay` is measurably worse there: on the public documentation track it loses on three of five
corpora, by −0.07 to −0.19 MRR. That is the only row where the tool is not merely different but
*worse*, and it is the row that decides whether "one tool for agent search" is even arguable.

The cause is structural rather than accidental. The path prior charges prose −1.5 and the
definition signal never fires in prose, so any source file with a declaration-shaped line outranks
the document that actually documents the term. Prose has structure of its own that the ranker
cannot see.

## The proposal

A markdown ATX heading (`## Foo`) declares the section about `Foo` exactly as `function foo`
declares `foo`. Score it: below a real declaration, above a bare mention.

## Pre-registration, written before any number was taken

**The documentation track cannot validate this signal.** Its ground truth is constructed as
"identifier-like tokens from ATX headings that occur in exactly one markdown file's headings" — so
a detector of tokens in ATX headings is an oracle for the benchmark's own construction rule. A win
there measures agreement with the generator, not retrieval quality.

Therefore, fixed in advance:

1. The docs track may only show the signal does not *break* anything. Its magnitude there is not
   evidence.
2. Validation must come from **SWE-Explore** (public, agent-shaped, ground truth from independent
   successful agent trajectories) and from the code track (must not regress).
3. **If it wins only where it is circular, it does not ship** — the rule that deleted the filename
   signal in v0.2.0, applied to a signal whose circularity is known in advance rather than
   discovered afterwards.

## What happened

| set | result |
|---|---|
| docs track, all five corpora | deficit reversed: −0.010/−0.072/−0.087/−0.194/−0.054 → **+0.190/+0.109/+0.302/+0.151/+0.454** |
| code track, three corpora | **+0.0000** contribution |
| SWE-Explore, 96 instances | **−0.0054** MRR (0.5505 → 0.5451) |

Payloads and a patch that rebuilds the measured binary: `evidence/ablations/`.

## The decision, and the part that is easy to get wrong

Deleted. Not because −0.0054 is a loss — on n=96 that is not distinguishable from zero, and the
harness computes no interval between two hay variants, so treating it as a measured regression
would be its own overclaim. Deleted because **the only benchmark that supports it is the one it
reverse-engineers**, and neither non-circular set supports it.

The code track's +0.0000 is worth stating precisely too. It is a *null measurement*, not a proof of
safety. What makes the signal unable to hurt code ranking is structural — it is gated on prose file
extensions — and the measurement is consistent with that, which is a weaker claim than "measured
safe".

## What would change the answer

A prose-retrieval evaluation whose ground truth is not "the token is in a heading". Candidates:

- doc-answerable queries from the behavioural corpus, judged by which prose file an agent actually
  opened — non-circular, but it is the evaluation set, and the firewall gives it no vote on what
  ships;
- a public set built from documentation *links* rather than headings, where the answer is the file
  a link points at;
- a second developer's transcripts, which would also close the standing external-validity gap.

Until one exists, the README keeps sending prose search to `rg --sort path`, and says why.
