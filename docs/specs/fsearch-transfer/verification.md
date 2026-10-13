# Independent actual-binary acceptance

Corrected binary SHA-256: `b60a64bfa56088dd9c5c59d6327447913ee5941585cd0bc52d94da4916f14f49`.
A new fresh context rechecked every criterion after the single correction round. It read no
source, tests, diff, repository notes or other agents' reports. All fixture processes exited;
linked worktrees were removed/pruned. Nested synthetic repositories were later moved recoverably
to Trash because the scratch guard refuses their permanent deletion.

```text
Verdict: PASS
Builder: Codex GPT-6 / repository implementation tools / separate builder context
Verifier: GPT-6 Astra / actual executable, subprocess CLI/MCP probes, synthetic fixtures / fresh source-blind context
Different model required: yes
Different model used: yes
Criterion 1 — Ordinary content compatibility: PASS — Frozen SHA matched; normalized ripgrep match sets, repeated ranked baseline/context output, JSON, invalid-byte content, newline paths and exits checked. Candidate overflow and malformed-ignore streaming searches returned exit 2.
Criterion 2 — Live filename discovery: PASS — Exact/substring/typo thresholds, transposition, NFC, case-insensitive comparison, deterministic ties, regular-file selection, filters, pagination/totals/completeness and all seven Git filters checked with precomposeUnicode true/false, Unicode parent/root, nested scopes and worktrees.
Criterion 3 — MCP contracts: PASS — Real protocol negotiation and exactly three tools; repeated roots, root-relative globs, canonical CLI-event parity, text/structured agreement, independent batches of 1/32, empty/page distinction and immediate live changes checked.
Criterion 4 — Errors, budgets and concurrency: PASS — Scope escapes and seventeen invalid inputs rejected with recovery; request limits, exact frame LF boundary, candidate/line/output and 4096/4097 submatches exercised. Controlled blocking Git operations proved busy rejection, capacity retention after cancellation, later release and EOF waiting for active work.
Criterion 5 — Routing and absence of persistence: PASS — Version/help, ordinary find/mcp patterns, -e flag-like patterns and -- literals checked. Fixture inventories showed no persistent additions or modifications.
Remaining uncertainty: APFS refused invalid-UTF8 filename creation; Linux byte-distinct names and Windows execution were unavailable to this verifier. No universal RSS/time ceiling or hostile concurrent-filesystem sandbox was claimed.
```

Separate platform evidence: [CI run 38343636130](https://github.com/mneves75/hay/actions/runs/38343636130)
passed Rust/build/differential gates on Linux, macOS and Windows, plus MSRV and Cargo audit.
Linux logs explicitly show the distinct-Unicode-path and invalid-UTF8 filename tests passing,
with 42 identical / 0 differing. This CI evidence supplements rather than rewrites the local
verifier's stated platform limitation. Its separate benchmark-film audit failed; that dependency
correction and final CI outcome are recorded in [evidence.md](evidence.md).

## Independent film dependency correction acceptance

This was a separate fresh Security/Code route against the existing CI contract, with source/diff
inspection allowed. The verifier changed no tracked files. YAML/lockfiles have no applicable
`cccc` coverage. Original vulnerable versions were independently submitted to the registry's
advisory endpoint; installed package manifests and `pnpm why` confirmed the patched graph.

```text
Verdict: PASS
Builder: Codex GPT-6 / command tools / implementation context
Verifier: GPT-6 Astra / independent command execution, diff inspection, npm registry and upstream advisory APIs / fresh context
Different model required: yes
Different model used: yes
Criterion 1 — Pinned pnpm accepts frozen lockfile: PASS — pnpm 11.22.0 and the real frozen install exited 0.
Criterion 2 — Audit passes without weakening controls: PASS — pnpm audit --audit-level high exited 0 with no known vulnerabilities; no suppression, CI-policy, direct dependency, source or allowBuilds change.
Criterion 3 — Lint and build pass: PASS — pnpm lint and pnpm build each exited 0; generated build/index.html is nonempty.
Criterion 4 — Six advisories remediated and overrides justified: PASS — the registry reproduced all six original findings. Installed manifests and pnpm why confirm fast-uri 3.1.8, brace-expansion 5.0.12, postcss-selector-parser 7.1.6 and source-map-js 1.2.2. All findings fixed, no unresolved findings; source-map-js remains within its caller's ^1.2.1 range.
Remaining uncertainty: macOS/Node 26.10.0 local proof; Ubuntu/Node 24.19.0 CI is separate. No exploit-resilience or rendered-video claim.
```

Artifact SHA-256: workspace `8262e809eeadb5e67878462ec8ad115214a024884cb471c187fe3c50cce23e19`;
lockfile `b74614f9733500e95837b6a33b112c0c2a4ca81e40fba316ac67220bc181d5d1`.
The PostCSS advisory's range metadata says `>=0` while explicitly naming 7.1.6 as patched;
the [maintainer's 7.1.6 security-fix release](https://github.com/postcss/postcss-selector-parser/releases/tag/7.1.6)
and registry confirm the correction. The inconsistent range is not taken as proof that patched
versions are vulnerable. [source-map-js's fix release](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)
independently supports 1.2.2. All six advisory links are in [evidence.md](evidence.md).
