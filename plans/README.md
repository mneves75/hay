# fsearch-transfer correction plans

Base: `bb271d3`, feature branch `feat/fsearch-transfer`. The source review and
confirmed feature spec are in `docs/specs/fsearch-transfer/spec.md`.

## What the review changed

The inventory/watch prototype does not accelerate any search and is removed. Keep live filename
discovery and the shared MCP search engine. Correct Git path bases, bound protocol/resource use,
and distinguish registered search scopes from an OS sandbox. Independent public history data
and a passing portable live-index acceleration experiment are missing: do not ship guessed boosts.

| Plan | Dependency | Status |
|---|---|---|
| 001: Useful scope and explicit limitations | None | implemented |
| 002: MCP/resource and Git correctness | 001 | implemented; actual CLI/MCP tests pass |
| 003: Frozen evidence and delivery | 002 | local gates pass; independent review/delivery in progress |

Chosen alternative: minimal live search. A bounded byte-validated result cache could save repeated
matching CPU, but must still read every eligible file; it is not adopted without the frozen 20%
median/p95 gate. A persistent authoritative trigram daemon conflicts with the agreed live
completeness guarantee without trustworthy snapshots/change tracking, and adds storage and
lifecycle costs. Five years later, a smaller API with measured additions is easier to maintain
than an unused cache format or platform-specific event correctness assumptions.
