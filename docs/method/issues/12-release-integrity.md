# 12 — Release integrity and public-evidence closure

**Status:** in progress (2026-08-25). This ticket is the repository-native fallback for the
requested to-spec/to-tickets workflow; those named skills were not installed in this environment.

## Objective

Ship the smallest release that makes the public evidence, installer, measurement boundaries,
manual, website, and film internally consistent without changing ranking or moving the failed
pre-registered gate.

The audience is a skeptical maintainer or researcher deciding whether the release can be trusted.
Success means the source gates pass, private transcript data cannot escape its boundary, untrusted
archives are bounded, generated claims are tied to clean corpus revisions, and staging is verified
before the separate production confirmation. Publication of a GitHub Release remains a separate
explicit action.

Constraints: return exactly ripgrep's matches for complete searches; preserve rank order; keep
the behavioural gate fixed; never commit `corpus/`; fail incomplete work closed; use the current
public benchmark as development evidence, not the private behavioural corpus for tuning.

Assumptions: this is a web/Rust/TypeScript release, not an Apple-platform build; GitHub Pages has no
separate staging branch, so local browser E2E plus the beta tag/draft artifacts are the staging
surface; corpus revisions can be recorded now even though the clone helper does not yet fetch those
revisions automatically.

## Alternatives considered

Weights: evidence/security 30%, regression safety 20%, release coherence 15%, public value 15%,
maintainability 10%, effort 10%. Scores are 1 (poor) to 5 (strong).

| approach | role | evidence/security | regression | coherence | public value | maintainability | effort | weighted |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Publish the existing 0.1.3 state unchanged | conservative | 1 | 5 | 2 | 1 | 4 | 5 | 2.65 |
| Correct only docs and the Pages version | simple/minimal | 2 | 5 | 4 | 2 | 4 | 5 | 3.40 |
| Targeted 0.1.4 integrity patch, no ranking change | long-term quality | 5 | 4 | 5 | 4 | 5 | 3 | **4.45** |
| Tune or redesign ranking until the gate passes | ambitious | 2 | 1 | 2 | 4 | 2 | 1 | 2.00 |
| Ship a hermetic benchmark appliance with pinned corpora | unconventional | 5 | 3 | 4 | 4 | 3 | 1 | 3.70 |
| Do not release while the pre-registered gate fails | challenges the request | 5 | 5 | 2 | 1 | 5 | 4 | 3.85 |

The selected patch takes the integrity benefits of the hermetic approach that fit this release
(clean revision provenance and fail-closed rendering) without adding a container/distribution
system. The strongest contrary position is to stop shipping because the behavioural gate fails.
It is rejected for this release because 0.1.x is explicitly experimental, the failure remains the
headline, and the release fixes evidence integrity rather than presenting the product as validated.

## Implementation contract

- Installer fetches the requested branch, tag, or commit exactly, installs with the lockfile, and
  verifies the newly installed binary rather than an older `PATH` entry.
- Transcript-derived outputs stay beneath a real `corpus/` directory with 0700 directories and
  0600 files; atomic replacement cannot truncate a planted hard link, and no override writes
  private pairs elsewhere.
- Remote SWE archives use a maintained parser and reject unsafe paths, links, special entries,
  excessive members/depth, expanded bytes, compressed bytes, and decompression ratio; the first
  violation aborts both compressed input and decompression.
- Natural child-process failures invalidate measurements; deliberate early rank stops remain
  distinguishable. Bootstrap output names observations and resampling clusters separately.
- Public benchmark payloads record generation time and clean corpus revisions; renderers reject
  dirty provenance and internally inconsistent statistics.
- The canonical hosted explainer is `BENCHMARK_FEYNMAN.html`; CI, manual, README, and generator
  agree. The film imports the evidence payload and refuses unsupported claims.
- Public version is 0.1.4. Historical 0.1–0.7 labels are explicitly identified as internal
  development cycles rather than public tags.

## Pre-mortem and five-year test

Likely failure modes are an early-killed child being confused with a natural error, mutable corpora
silently changing a benchmark, archive expansion exhausting disk, private paths landing in a
tracked directory, generated pages naming the wrong version, and beta/prod tags being treated as
the same release. The mitigations are positive-control subprocess tests, revision/dirty-state
provenance, independent archive caps, one private writer, generated-artifact drift gates, and
separate beta and production confirmations.

Five years out, hand-copied benchmark values, permissive private-output overrides, mutable
`main` fallbacks, and a website assembled outside the source of truth would look naïve. This
cycle removes those debts. It deliberately does not add speculative ranking abstractions or a
new deployment platform. The remaining reproducibility limitation is explicit: corpus SHAs are
recorded but `benchmark-corpora.sh` does not yet check them out automatically.

## Acceptance

- Focused positive controls reproduce every fixed finding.
- Rust format, clippy, tests, release build, and differential parity pass.
- Bun frozen install, audit, typecheck, ast-grep, every tool selftest, shellcheck, and generated
  artifact drift pass.
- Video frozen install, audit, lint/typecheck, bundle, render, and visual inspection pass.
- Local desktop and mobile browser E2E cover the landing artifacts, manual search/theme/copy, links,
  console, and responsive overflow.
- Security audit and secret/risky-pattern scans have no verified release blocker.
- Autoreview runs at P3; verified findings are fixed once and focused proof reruns.
- Version, changelog, docs, memory, evidence, site, and film agree.
- Main is committed and pushed; `v0.1.4-beta1` is tagged and its staging artifacts verified.
- Production tag and Pages push occur only after explicit production confirmation.
