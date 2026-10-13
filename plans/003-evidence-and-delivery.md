# Finish frozen evidence, docs, version and branch delivery

Base: bb271d3, working feature. Dependencies: plans001/002. Goal: independently verified feature
and pushed working branch, without claiming an unauthorized release or a passed retrieval gate.

1. Freeze baseline/candidate binaries and public corpus revisions. Compare exact complete output
   with ABBA end-to-end timing; report absolute latency differences with paired 95% intervals,
   median/p95 and source/binary digests. A non-passing optimization is removed, not excused.
2. Inventory every upstream mechanism with adopted/already-satisfied/rejected/blocked disposition
   and SHA-pinned primary citations. No fabricated human endorsement; distinguish interpretation.
3. Run Rust tests, clippy/fmt, release build, differential, MSRV, dependency audit and affected Bun
   selftests/typecheck. Keep each exit code visible. Public evidence is not private confirmation.
4. Run independent Standards and Spec reviews from bb271d3; fix confirmed in-scope findings.
5. Run fresh-context mneves-verify against real CLI/MCP behavior and positive controls; correct
   findings and reverify. Report unavailable platform/private evidence as BLOCKED, never PASS.
6. Bump to 0.4.0, update relevant docs/manual/changelog/spec/glossary/ADR/agent instructions;
   remove completed ticket files and temporary artifacts owned by this session.
7. Stage explicit task-owned paths, Conventional Commits, push feat/fsearch-transfer and create
   a PR with actual evidence. Inspect CI. No merge, tag, production release or formula change.

Done: gates and independent verdict support the reported outcome, docs agree with behavior,
tracked work is pushed, and residual external evidence is stated precisely. Stop only at a real
protected-action/permission/access blocker; no generic approval pause.
