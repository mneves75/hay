# fsearch transfer acceptance record

Date: 2026-10-13. Branch: `feat/fsearch-transfer`; fixed review base: `bb271d3`.
Source version: 0.4.0, not a published release. Builder: Codex (GPT-6), local command tools.

## Local gates

Each gate was run as its own command; exit codes below are its own, not a following grep's.

| Gate | Result / exit |
|---|---|
| `cargo test --locked --manifest-path hay/Cargo.toml` | PASS / 0: 44 unit, 23 content CLI, 13 filename CLI, 7 actual MCP tests (87 on macOS) |
| `cargo clippy --locked --manifest-path hay/Cargo.toml --all-targets -- -D warnings` | PASS / 0 |
| `cargo fmt --manifest-path hay/Cargo.toml --check` | PASS / 0 |
| `cargo build --locked --release --manifest-path hay/Cargo.toml` | PASS / 0; Rust 1.99.0 |
| `./hay/differential-test.sh` | PASS / 0: identical 42, differing 0 |
| `rustup run 1.88.0 cargo check --locked --all-targets --manifest-path hay/Cargo.toml` | PASS / 0: declared MSRV |
| `cargo audit --file hay/Cargo.lock` | PASS / 0: 152 dependencies, refreshed RustSec DB, no vulnerabilities reported |
| Bun 1.4.0 frozen install, typecheck, audit | PASS / 0 each; audit checked 40 packages |
| Bun ast-grep scan/rule tests | PASS / 0 each; all 3 rule tests |
| All ten TypeScript `--selftest` commands from CI | PASS / 0 each |
| `bash install.sh --selftest`, `brew-formula.sh`, `release-policy.sh` | PASS / 0 each |
| Film: pnpm 11.22.0 frozen install | PASS / 0; unchanged direct dependencies |
| Film: `pnpm audit --json` | PASS / 0: 359 dependencies, zero reported vulnerabilities |
| Film: `pnpm lint`, `pnpm build` | PASS / 0 each; no film source changes |

The installed host Bun was 1.4.2; gates used a temporary official Bun 1.4.0 binary to match
`packageManager`. Initial sandbox install/audit failures were retried with scoped writable
temporary/cache paths or approved cache access; they are not counted as successful checks.

## Before / after controls

- Before filename implementation, real CLI rejected `--find` with exit 2; filename regressions
  now pass. Attached/combined options were separately red before the lexopt correction.
- Nested-root Git clean/tracked search returned no hits before `--full-name`; the real CLI
  regression now passes, including worktree and NUL-delimited path fixtures.
- Before framing bounds, a >1 MiB initialize frame was accepted; now the actual transport
  closes with a nonzero exit. Before structured bounds, an >8 MiB matching line produced a
  falsely complete oversized result; now it returns exit 2 / `complete:false` promptly.
- `--help --mcp` was exit 2 after initial mode routing; its early-exit regression now passes.
- MCP tests compare actual ordered JSON with CLI, distinguish complete empty searches from
  page truncation, exercise live rename/content updates, static scope rejection and independent
  batch regex errors. A positive valid call succeeds after invalid arguments.

## Public retrieval preservation

An early frozen feature binary ran `benchmark.ts --corpus NAME --sample 30 --skip-perf` on
three clean public checkouts. The final binary then reran the same sampled symbols with
`-F -n -m 0 -e QUERY .` and compared ordered stdout bytes and exit codes against installed 0.3.2.

| Corpus | Revision | Queries | Ordered-output/exit differences |
|---|---|---:|---:|
| ripgrep | `3fce3b5bb0236da2df6d99672afb8a719642eca7` | 23 | 0 |
| openclaw | `7c65d89e60495c1848ba02bc511881d247ec1e2e` | 30 | 0 |
| alamofire | `0455bfb650893e86ad07ace16e5f2d36dadf46f4` | 29 | 0 |

82 paired query outcomes, no changed rank/output. The retained aggregate is
[fsearch-transfer-public-parity.json](../../../evidence/fsearch-transfer-public-parity.json).
This is a public definition-finding workload,
whose ground truth favors hay's existing purpose. It does not validate the new filename ranking,
contextual relevance, task completion or speed. No arithmetic relative-improvement claim.

Baseline SHA-256: `7c6b2f2bb6874a07c0f120ed393970fe597adedb8650ddb8e6e6e875fea20ecc`.
Initial candidate SHA-256: `6a055c4b3a7e64b6dae2daff07ba13c46668c0509aebffa945953f816eab7e07`.
Corrected candidate SHA-256: `b60a64bfa56088dd9c5c59d6327447913ee5941585cd0bc52d94da4916f14f49`.
The installed baseline may use another compiler; no timings were compared or attributed.
The working-tree release executable is a byte-identical restored copy of the frozen corrected
candidate after the normal build directory disappeared. Its digest/version were rechecked;
this is not a new compilation or a system installation claim.

## Manual and advisory evidence

Local `MANUAL.html` rendered in an isolated agent-browser session at 1440×1000 and 390×844.
Screenshots were visually inspected; mobile document width equals viewport width, and searching
`0.4.0` returns the new section. The owned browser session was closed. No site deployment.

Independent read-only Astra advisor challenged index utility, live-negative coverage, root
confinement claims, Git path bases, resource bounds and blocking-job cancellation ownership.
The source inventory/research/alternatives and resulting corrections are in [review.md](review.md).

`cccc` 1.8.0, original config/exclusions, `--no-cache --min 0`, all nine Rust source files:
exit 0, 9/9 analyzed, 0 parse-error files, empty stderr; 315 functions after correction, cognitive maximum 30,
p95 9. Metrics are review navigation, not acceptance. Dependency mapping was partial because
macros/conditional Rust edges and one pre-existing video import are unresolved; no zero-coverage claim.

## Independent finishing gates

Initial Standards/Spec reviews found two P2 correctness defects and one nonblocking duplication
judgment. Both defects were independently reproduced against the initial binary; verification
returned FAIL. Corrections include ignore-error propagation, configured macOS Git Unicode keys,
Linux byte-key preservation and a shared MCP job lifecycle. See [code-review.md](code-review.md).

Final corrected-source reviews of `cbd2cc5` report zero unresolved Standards/Spec findings.
A new full source-blind, different-model `mneves-verify` context returned **PASS on all five
criteria**; its actual-binary probes and uncertainty are in [verification.md](verification.md).
The initial verifier accidentally saw reviewer summaries through agent listing and disclosed that
two probe ideas came from those reports; it reproduced outcomes without opening source. Final
verification used another fresh context without access to those reports or builder notes.

## Cross-platform CI and film audit correction

[CI run 38343636130](https://github.com/mneves75/hay/actions/runs/38343636130), at `cbd2cc5`,
passed the three-platform Rust/build/differential matrix, MSRV, Cargo audit and measurement kit.
Linux explicitly ran the distinct-Unicode-path and invalid-UTF8 filename controls, and all
platforms retained 42 identical / 0 differing in the differential harness. This supplements the
local verifier's APFS filename limitation; it does not change that verifier's evidence scope.

The separate film audit failed on six existing advisories (three high, three moderate).
The correction refreshes only four transitive patch versions: fast-uri 3.1.8,
brace-expansion 5.0.12, postcss-selector-parser 7.1.6 and source-map-js 1.2.2. Existing fast-uri
pinning is advanced, and source-map-js is pinned because a normal refresh retained its vulnerable
version. Direct dependency versions, allowed build scripts, film source and audit policy are
unchanged. The overrides document when to remove them. Primary advisory evidence:
[fast-uri](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj),
[brace-expansion 1](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr),
[brace-expansion 2](https://github.com/advisories/GHSA-qhr7-859c-m2p7),
[brace-expansion 3](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p),
[postcss-selector-parser](https://github.com/advisories/GHSA-rj75-hqrm-r3gf), and
[source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

Pinned pnpm 11.22.0 frozen install, audit, lint and bundle each passed locally. Local Node
26.10.0 meets the declared engine; the final CI uses pinned Node 24.19.0. A fresh different-model
security verifier independently repeated the real gates, inspected installed manifests and
queried the original vulnerable versions: **PASS on all four criteria**, no unresolved findings.
See [verification.md](verification.md).

[CI run 38346367434](https://github.com/mneves75/hay/actions/runs/38346367434), at code/dependency
commit `6f909be728a6ff64726e7b0cefef5b91a85786c1`, is **PASS on all seven jobs**: Linux, macOS,
Windows, MSRV, Cargo audit, measurement kit and benchmark film. The film's pinned Ubuntu/Node
24.19.0 frozen install, audit, lint and build all passed. Subsequent finishing changes contain
only documentation/aggregate evidence; the [PR checks](https://github.com/mneves75/hay/pull/16/checks)
show the latest branch-head CI result.

## Unverified / not shipped

- No latency/index/cache/PGO adoption gate was run. The unused inventory prototype was removed
  for lack of a search consumer; the >=20% median / <=5% p95 gate was not relaxed.
- Private behavioral confirmation was not rerun. Historical gate remains FAIL at median-repo
  MRR 0.4328 / top-10 0.7721 against 0.50 / 0.80. No private corpus was opened or published here.
- History/proximity ranking remains blocked on independent contextual development evidence.
- Local source-blind behavior proof is macOS only; separate CI supplies Linux/Windows execution.
- No merge, tag, attested release, formula bump, system installation or production/site deployment.
