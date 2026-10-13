# Keep live search authoritative

Status: accepted, 2026-10-13. Ordinary hay remains stateless ranked grep. Live discovery and MCP
use explicit flags and shared visibility policy. No new scoring weights or exclusions.

Selected: live enumeration/matching, thin SDK adapter, structured-byte limits and explicit
completeness. Removed: the new inventory-only index/watcher, which had no retriever consumer.
This was a utility rejection, not a speed measurement. No persistence ships.

Strongest alternative: a bounded query cache with live relisting and byte validation, including
formerly negative files. Reading all bytes may erase its benefit; accept only after the unchanged
>=20% median / <=5% p95 performance gate and correctness controls pass.

Rejected: authoritative whole-disk watcher indexing. Events/metadata cannot prove current
negative coverage; missed events and same-size edits can silently omit answers. Registering MCP
roots controls requested scope, not OS confinement against hostile concurrent mutation.

Consequences: no formats, cache locks or daemon lifecycle to maintain; no index/history speed
claim. Retain mature portable walking/matching. See the [review](../specs/fsearch-transfer/review.md).
