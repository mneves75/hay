# 02 — What exactly did modem.dev measure, and is it reproducible?

Type: research
Status: open
Blocked by: —

## Question

The map leans on modem.dev's "How Coding Agents Read Code" for its only hard numbers. Before the
metric is built on top of them, extract the **methodology**, not the headline:

- How was the 3-word threshold derived from 7,922 exported TypeScript names? Is it a distribution
  cutoff, a hit-count elbow, or a judgement call? Can we recompute it on a different corpus?
- What was measured in the two experiments — token counts of what, across which 14 reader
  configurations, with what task set? What is the control?
- The `create` / `createClient` / `createStripeClient` hit counts: over which repo, at what size?
  Is hit-count-per-name a stable enough signal to build a score on, or does it collapse on
  monorepos, non-TS languages, and generated code?
- Do they publish a skill, dataset, or code we can run rather than re-derive?
- What do they say (or not say) about **docs and non-code files**? Their thesis is about naming;
  our sludge axis has no equivalent published evidence and we need to know that gap is ours.

## Done when

A note stating which claims are reproducible, which are anecdotal, and what would have to be
re-measured for our score to be defensible rather than borrowed.

## Context

Already extracted at chart time (unverified, from a single fetch of the article): `create` → 1,585
hits / 459 files; `createClient` → 466 / 23; `createStripeClient` → 43 / 19; median 32% token
reduction (Haiku 4.5-authored) and 12% (GPT-5.6 Sol-authored); 4,943-line monolith refactor moved
bug detection 3/8 → 8/8. Verify these against the source before any of them ships in a public doc.
