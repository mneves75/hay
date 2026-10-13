# fsearch transfer: source review and decisions

## What the review changed

The chosen implementation is live filename discovery plus a bounded, explicitly started MCP
adapter over the existing content engine. An inventory-only index/watcher prototype was removed:
no search consumed it, yet it rehashed the repository on events and periodically. That is a
correctness/utility rejection, not a measured performance loss. No index candidate passed or
failed the numerical latency gate; no new speed result is claimed.

Independent advisory review also found a real nested-Git path bug, canonical-root ambiguity,
unbounded stdio lines, and cancellation that could release capacity before blocking work stopped.
The implementation fixes these and adds real CLI/MCP regressions. Private ranking weights and
the pre-registered retrieval gate stay unchanged. Final independent acceptance is recorded
separately in [evidence.md](evidence.md).

## First principles and primary advice

The user needs useful files with honest completeness. A retrieval index is useful only if it
avoids enough work without suppressing a live match. Checking only indexed candidates misses
new matches in formerly negative files; a content hash does not establish current coverage unless
those files are read again. A filename inventory needs live relisting for the same reason.

[Russ Cox's trigram design](https://swtch.com/~rsc/regexp/regexp4.html) and
[Zoekt](https://github.com/sourcegraph/zoekt) establish the value of conservative candidate
selection followed by exact matching for indexed snapshots. They do not prove that a mutable
checkout index meets hay's stronger live-match contract. This is our inference, not an endorsement
by their authors. [Andrew Gallant's ripgrep analysis](https://burntsushi.net/ripgrep/) supports
keeping the mature matching/walking engine and measuring costs instead of guessing.

[notify's documentation](https://docs.rs/notify/8.2.0/notify/) identifies missed-event and platform
limitations; events cannot establish completeness. The
[MCP specification](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
distinguishes tool errors from protocol errors and supports structured plus text results.
[MCP roots](https://modelcontextprotocol.io/docs/learn/client-concepts#roots) are informational;
registered scope checks are not OS confinement. The
[cap-std model](https://github.com/bytecodealliance/cap-std) explains why context reads already
anchor a capability. [Tokio documents](https://docs.rs/tokio/latest/tokio/task/fn.spawn_blocking.html)
that started blocking jobs cannot simply be aborted; cancellation must preserve ownership and
honest accounting until work stops. [Git's `--full-name`](https://git-scm.com/docs/git-ls-files)
is necessary when combining nested-root `ls-files` paths with repository-root status paths.

Research consulted the primary sources above and the pinned upstream code. The advisor used a
fresh read-only GPT-6 Astra context; it challenged the proposal and inspected the implementation.
Named domain authors were not contacted and have not reviewed this change.

## Complete mechanism inventory

Reviewed upstream: [fsearch 0.2.1, commit 88e63fdf850cf7749deae8198b187accd21f8ba5](https://github.com/noahdunnagan/fsearch/tree/88e63fdf850cf7749deae8198b187accd21f8ba5),
MIT licensed. Its product is a macOS whole-disk search daemon; hay remains a portable ranked grep.
These dispositions cover mechanism families, not a claim that upstream implementation code was copied.

| Upstream mechanism | Disposition in hay | Reason / evidence obligation |
|---|---|---|
| Common search implementation behind CLI/service | Adopted | One content engine; thin entry point; real JSON parity test. |
| Live fuzzy filename discovery, exact/substring priority, Unicode names | Adopted | Separate `--find`/`find_files`; typo/stem/NFC/tie/page tests. Does not affect content scoring. |
| Size, mtime and Git filters | Adopted | Explicit filters; nested roots, NUL paths and linked-worktree tests. |
| Persistent MCP with three search tools | Adopted | Official Rust SDK, stdio only, explicit roots, independent batch results. No automatic rewriting. |
| Bounded IO/parallel work/candidate retention | Already present and extended | Original bounded channel/20k heap preserved; filename top-K and structured-byte limits added. |
| Regex literal planning and fallback | Existing matcher retained | ripgrep crates already do matching optimizations. No second regex parser. |
| Definition/path/word boosts | Existing ranking retained | No upstream weights or new signal without independent public ablation. |
| Trigram postings, conservative regex candidate selection | Not shipped | Requires live coverage proof and performance gate; immutable snapshot success is insufficient. |
| Five-byte Bloom filters, compressed postings, bit-packed IDs/name arrays | Not shipped | No consumer demonstrating utility; compression adds format/maintenance costs. |
| mmap snapshots / unsafe native IO | Rejected | No `unsafe`; portability and explicit errors take priority. |
| Native bulk macOS walk / FSEvents whole-disk daemon | Rejected | macOS-only, broader scope, event loss, unsafe upstream code. Retain portable ignore walker. |
| Segment generations, live overlays, event coalescing, compaction | Prototype removed | Inventory was not a retriever. No watchers or state formats without a useful consumer. |
| Content-ID deduplication / unchecked hash reuse | Rejected as authority | Reuse must verify byte equality and preserve every distinct path/result. |
| Name/content indexes and symbol index | Evidence blocked | No compatible acceleration yet; AST/LSP integrations were explicitly out of scope. |
| Frecency/open history/proximity | Evidence blocked | No independent contextual development corpus; no automatic collection or private tuning. |
| Auto retry/regex broadening/spelling fallback/content regrouping | Rejected | Changes query or rank order; caller must choose explicit new query. Filename typo mode is explicit. |
| Excluding lockfiles, large JSON, minified files, linked worktrees | Rejected | Violates the normalized ripgrep match-set contract and explicit worktree scope. |
| PGO, codegen tuning, extra caching | Not shipped | Existing optimized/LTO/stripped release profile retained; no measured >=20% gain. |
| ABBA, frozen inputs/binaries, cold/warm and churn checks | Adopted as evaluation policy | Required before accepting any acceleration. Current public run used `--skip-perf`. |
| Upstream installation/autostart/release defaults | Rejected | Keep explicit manual service and the stronger attested protected release chain. |

## Alternatives and the choice

1. **Live search with thin persistent adapter — selected.** It adds useful filename/API behavior,
   avoids repeated process startup within a client session, and reads current files each call.
   No claimed latency gain. Small state, direct failures, portable dependencies.
2. **Bounded byte-validated query cache — strongest future alternative.** It could reuse matching
   or ranking after live relisting and reading every relevant file, including formerly negative
   files. This still pays IO and adds invalidation/privacy policy. Implement only after a frozen
   workload shows matching/ranking dominates and the unchanged gate passes.
3. **Authoritative watcher index — rejected.** Fast snapshot answers can silently miss edits,
   ignore changes and new matches. A full fallback preserves correctness but can erase its benefit.

## Five years later

The expensive mistakes would be a cache nobody uses, migrations for its format, locks and crash
recovery, platform-specific watchers, and an API implying stronger confinement than it provides.
Removing the unused prototype now avoids those obligations. Keeping one mature matcher and one
visibility policy makes future fixes reach both interfaces. Any future cache must have a measured
consumer, byte-validated reuse, explicit privacy/reset behavior and adversarial mutation controls
before it becomes part of this product.

## Satisfaction and what remains

The implementation is acceptable only with passing actual-interface tests, unchanged default
search behavior and independent acceptance. It does not close the retrieval quality gate or prove
acceleration. Better future work would start with an independent contextual dataset and measured
cost attribution; additional index machinery before either would be speculation.
