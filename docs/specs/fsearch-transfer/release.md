# Binary 0.4.0 and Homebrew delivery

Owner approval: "yes to all" for binary `v0.4.0` at
`660221a0aa712480fa03613fc35496c3e9e06771` in `mneves75/hay` and the attestation-verified
formula in `mneves75/homebrew-tap`. This is separate from website `site-v0.4.0`.

## Identity and publication

- Lightweight `v0.4.0` points at the approved source SHA; source CI [38459009424](https://github.com/mneves75/hay/actions/runs/38459009424) passed all seven jobs.
- Protected `release-dispatch.yml` dispatched from `main`: [38495763757](https://github.com/mneves75/hay/actions/runs/38495763757), all seven jobs passed, including five platform builds and draft provenance verification.
- [Stable release](https://github.com/mneves75/hay/releases/tag/v0.4.0) published 2026-10-14 01:35:08 UTC (October 13 in America/Sao_Paulo); ten assets, five archives and their checksums. Neither draft nor prerelease.
- Generated Homebrew formula: [de9da2a](https://github.com/mneves75/homebrew-tap/commit/de9da2a), pushed to tap `main`. URLs/checksums were generated, not hand-edited.

## Actual release acceptance

Fresh source-blind verifier dispatched as `gpt-6-astra`, different from builder GPT-6;
no source, tests, diffs or builder notes read. Actual archive execution used a network-denied,
filesystem-restricted sandbox and synthetic fixtures. Provider runtime identity telemetry is
not exposed; the native dispatch selection is the model evidence.

| Frozen criterion | Result | Observed evidence |
|---|---|---|
| Identity, assets, checksum and provenance | PASS | Lightweight exact-SHA tag; all five archive/checksum pairs present. Mac ARM SHA-256 `8309b08e3490e48836ffadfa8b8be013077461f83aaf2ac31eb78925f6fe7d5b` matches checksum. Attestation verifies `release-dispatch.yml`, `refs/heads/main`, exact source/signer digest, and denies self-hosted runners. |
| Real CLI | PASS | Version 0.4.0; all four synthetic ranked matches retained with declaration ahead of archived prose. Missing query exit 1; invalid regex exit 2. |
| Live filenames and MCP | PASS | Create/rename immediately visible. Real MCP initializes and exposes exactly `grep`, `find_files`, `multi_grep`; all three succeed. Empty search is complete/exit 1/non-error; invalid regex and oversized structured candidate are incomplete/exit 2/error. Pagination distinguishes complete search from truncated page. Processes exit after stdin closes. |

Integrator gates: `release-policy.sh --selftest` and `brew-formula.sh --selftest` each exit 0.
`brew-formula.sh v0.4.0` downloaded the four public Homebrew archives and verified checksums
and attestations against the exact main source SHA, exit 0. Verification needed task-local
`XDG_CACHE_HOME` because the default cache was sandbox-blocked; checks were not weakened.
`brew audit --strict mneves75/tap/hay` exit 0. Current Homebrew refuses audit by filesystem
path, so the generated formula was staged in the installed tap and audited by name.

`brew upgrade mneves75/tap/hay` installed 0.4.0 with auto-update and cleanup disabled;
`brew test mneves75/tap/hay` exercises version, ranked declaration order, complete match count
and no-match exit 1, standalone exit 0. Installed `/opt/homebrew/bin/hay --version` reports `hay 0.4.0`.
Installed Mac ARM executable SHA-256: `49329a5e26aad1cc982d3c875fe87e63ba3383ffdbd29bc9306f5c35ab3e1920`.
`cmp` against the independently tested extracted archive executable exits 0: identical bytes.

## Limits and cleanup

Other-platform binaries were built and inventoried, not executed by the Mac verifier. The
historical private retrieval gate remains failed; no private corpus was rerun and no ranking
weights or performance claims changed. The frozen website/film retains its earlier source-only
labels and source SHA; this Homebrew delivery does not redeploy that website snapshot.

The previous installed 0.3.2 keg is preserved; no shared cache or pre-existing build output was
cleaned. Task-local downloads, attestation caches and synthetic fixtures are temporary and
removed after verification. No task process remains.
