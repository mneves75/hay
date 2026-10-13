# fsearch transfer

## Review correction (2026-10-13)

The interview required useful, measured acceleration and removal of failed prototypes. Later
user steering requested an advisor review and implementation of the best alternative. The
inventory-only index had no search consumer; its new module, watcher, lifecycle commands and
tests were removed. No index timing was measured. Live filename discovery and MCP are selected;
index lifecycle/content acceleration are **not delivered**, history/proximity are evidence
blocked. This records the outcome rather than erasing the original seven-slice plan.
See [review.md](review.md) for alternatives and [interface.md](interface.md) for the contract.

## Problem Statement

Agents need filename discovery, reusable search interfaces, and lower repeated-search overhead
without losing hay's exact normalized-ripgrep match set or deterministic ranking.

## Solution

Review fsearch 0.2.1 at `88e63fdf850cf7749deae8198b187accd21f8ba5`, evaluate every mechanism, and
adopt only compatible, demonstrated benefits. Preserve ordinary hay and all three platforms.

## User Stories

1. As an agent, I can keep using ordinary hay with unchanged results and exit codes.
2. As an agent, I can find filenames with misspellings within an explicit scope.
3. As a user, I can filter names by glob, type, size, age, and Git status.
4. As a user, I see new, renamed, deleted, ignored, and worktree files accurately.
5. As a user, I explicitly build or watch an index for a repository, without autostart.
6. As an agent, I receive complete live results when a cache is stale, corrupt, or absent.
7. As an MCP client, I can call find_files, grep, and multi_grep without query rewriting.
8. As an agent, I can distinguish a limited page, no matches, and an incomplete search.
9. As a user, I can supply proximity or explicitly record opens only if independent evidence supports that signal.
10. As a maintainer, I can reproduce comparisons against frozen binaries and public corpora.
11. As a maintainer, I can see which upstream mechanisms were adopted, already satisfied, rejected, or blocked.

## Implementation Decisions

- Shared Rust search engine, thin CLI, existing ripgrep matching/traversal, unchanged ranking.
- Explicit flags; no positional subcommands or upstream inline query language.
- Live filename enumeration; exact/substring/typo ranking with deterministic ties.
- Future indexing is scoped to explicitly registered repositories and worktrees.
- No index, foreground watcher, login integration or state format ships in this implementation.
- Future cache keys/content candidates require current-content validation and live coverage.
- Optional content acceleration must pass the performance gate or its prototype is removed.
- Stdio MCP uses the official Rust SDK; only three search tools, explicit fields, per-query completeness.
- Local feedback and proximity remain disabled in ordinary searches; independent ablation is mandatory.
- No unsafe code, native walker replacement, upstream exclusions, or release-policy weakening.

## Testing Decisions

Test the real CLI and MCP boundaries. Red before green for each behavior. Preserve Rust unit tests
and the differential harness. Cover live mutation/ignore changes, malformed inputs, bytes paths,
worktrees and bounded resources. Event-loss/corruption/generation controls apply to a future index.
MCP roots are search scopes, not OS confinement against hostile concurrent filesystem mutation.
Performance candidates require >=20% lower median end-to-end repeated-query latency, a paired
95% interval supporting improvement, and <=5% worse p95. Freeze binaries/corpora/queries, use
ABBA, report cold/warm/index costs and memory separately. Ranking develops on independent public
evidence, confirms privately without tuning, and never moves the MRR 0.50/top-10 80% gate.

## Out of Scope

Whole-disk indexing, automatic history collection, query rewriting, tree-sitter/LSP integration,
production release, merging, and external/private-data publication.

## Further Notes

Confirmed in the grill-with-docs interview. Original seven slices: shared engine/baseline,
stateless optimization experiments, filename discovery, index lifecycle, content acceleration,
contextual ranking/history, MCP/delivery. The review combined useful live capabilities, removed
the unused index experiment and deferred evidence-blocked signals. Development stays on a
working branch; independent acceptance precedes PR delivery. Merging/publication are owner actions.

## Frozen delivered acceptance

1. Ordinary content search preserves normalized ripgrep matches, default ordering, exit
   semantics, context/JSON/bytes behavior and all 42 differential cases.
2. Filename discovery enumerates live regular files with separate exact/substring/typo/NFC
   ordering, deterministic byte-path ties, explicit filters and honest paging/errors.
3. MCP advertises exactly `grep`, `find_files`, `multi_grep`, requires registered repositories,
   preserves equivalent CLI ordering and independent per-query results, never rewrites queries
   or collects history, and distinguishes incomplete searches from complete empty pages.
4. Static out-of-scope roots fail, frames/arguments/structured output have explicit limits,
   cancellation preserves active-job ownership, and errors leave later valid calls usable.
5. Docs/version agree with real interfaces. Gates and independent actual-binary acceptance
   have evidence; unrun performance/private/platform criteria remain unverified.

These criteria cover the compatible transfer, not a claim that every original prototype shipped.
