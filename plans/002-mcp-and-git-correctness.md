# Correct Git roots and bound MCP resources

Base: bb271d3, working feature. Goal: preserve explicit live search semantics under nested roots,
malformed input, cancellation and large requests. Scope: finder/Git, structured engine, MCP, CLI
and their E2E tests. Use existing lexopt, ripgrep crates, cap-std and official rmcp SDK.

1. Write an E2E failing test for clean/tracked/untracked Git filters from a nested directory.
   `git ls-files -z` emits cwd-relative names; use `--full-name` to match status/root-relative keys.
2. Write failures for out-of-root/static symlink roots, oversized NDJSON input, and incomplete
   oversized matching output. Add direct find_files/multi_grep and page/completeness checks.
3. Cap inbound frames before the SDK allocates an unbounded line. Keep SDK framing/protocol
   semantics; use a safe AsyncRead wrapper, not a custom JSON-RPC server.
4. Reject busy searches explicitly. Move an owned capacity permit into the blocking job, so a
   dropped/cancelled request does not release capacity while computation still runs.
5. Bound structured candidate/output bytes. Return exit2/completefalse and diagnostics on budget
   failure; preserve valid partial rows and ordinary CLI behavior.
6. Canonicalize registered/query scopes and test static symlink rejection. Explain that scopes
   are not an OS sandbox; do not claim protection for concurrent hostile traversal/ignore/Git
   mutation. Do not add a second filesystem walker merely to hide that distinction.

Commands: `cargo test --locked --manifest-path hay/Cargo.toml --test find_cli --test mcp`, then
clippy with `--all-targets -- -D warnings`, fmt check, and the differential harness. Expected:
all pass, differential zero differing. New tests must fail before each corresponding fix.

Done: no silent Git misclassification, query rewriting, unbounded input frame, leaked capacity
on cancellation, or falsely complete output. Record exact boundary limitations in API docs.
