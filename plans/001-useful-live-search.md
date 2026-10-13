# Remove an index with no search consumer

Base: bb271d3, working feature. Goal: deliver useful live filename discovery/MCP without pretending
that inventories accelerate retrieval. Scope: new index module/test/dispatch only, feature spec,
ADR, user docs. Preserve ordinary CLI matching/scoring and existing release policies.

Verified current behavior: `hay/src/index.rs` returns `role: inventory-only`; its foreground
watcher hashes the whole repository after each event and every five seconds. No retriever consumes
the inventory. This does not satisfy the confirmed performance adoption gate.

1. Move repository-root validation needed by MCP to a small internal scope helper.
2. Remove the newly created inventory/watch module, its tests and dispatch; remove their exclusive
   dependencies. Do not remove existing owner files.
3. Keep the mechanism inventory/spec and document rejected/blocked capabilities precisely.
4. Run `cargo test --locked --manifest-path hay/Cargo.toml --test cli --test find_cli --test mcp`.
   Expected: pass; ordinary CLI stays unchanged; unsupported index flags fail exit2.

Done: no unused persistent format, watcher, cache writes, or index-as-speed claim. The retained
spec explains the evidence-based removal. Stop on overlapping edits, changed product scope, or
new evidence that a useful exact accelerator actually passes the preregistered gate.
