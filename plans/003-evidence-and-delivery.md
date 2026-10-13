# Finish frozen evidence, docs, version and branch delivery

Base: bb271d3, working feature. Dependencies: plans001/002. Goal: independently verified feature
and pushed working branch, without claiming an unauthorized release or a passed retrieval gate.

1. Freeze baseline/candidate binaries and public corpus revisions. Compare exact complete output
   and retain source/binary digests. If an acceleration consumer is adopted, run ABBA end-to-end
   timing and report absolute latency differences with paired 95% intervals and median/p95.
   The unused inventory prototype has been removed, so no timing or acceleration claim applies.
   A non-passing optimization is removed, not excused; the latency gate remains frozen.
2. Inventory every upstream mechanism with adopted/already-satisfied/rejected/blocked disposition
   and SHA-pinned primary citations. No fabricated human endorsement; distinguish interpretation.
3. Run Rust tests, clippy/fmt, release build, differential, MSRV, dependency audit, affected Bun
   selftests/typecheck and the existing film dependency gates. Keep each exit code visible.
   Public evidence is not private confirmation.
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

## Completion evidence (2026-10-13)

The useful live interfaces are implemented at source version 0.4.0. Both independent code-review
axes report zero unresolved findings after correction. Fresh source-blind CLI/MCP acceptance
passes all five criteria; the separately reviewed film security correction passes all four.
All seven CI jobs pass at code/dependency commit `6f909be`, including three-platform search,
MSRV, both dependency audits, measurement selftests and the film bundle. Public ordered-output
parity is 82/82 unchanged; differential is 42 identical / 0 differing. No latency experiment or
private confirmation was run. The unused index prototype and completed ticket files were
removed, not presented as delivered acceleration. Detailed evidence and limitations live in
[the acceptance record](../docs/specs/fsearch-transfer/evidence.md).

Delivery is the working branch and [PR #16](https://github.com/mneves75/hay/pull/16), with the
spec and implementation decisions retained. No merge, release tag, formula update or deployment.
