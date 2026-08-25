# Changelog

Versions track `hay`, the shipped binary. The measurement kit is versioned with the repository.
This changelog starts at 0.1.0: everything before was development under a different name, and its
history lives in git and `memory/`.

## [Unreleased]

## [0.1.3] — 2026-08-25

No ranking change — this release hardens incomplete-search reporting, JSON compatibility, and
release provenance without changing the three ranking signals or their weights.

### hay correctness

- Searches exceeding the 20,000-candidate retention cap now exit 2 instead of reporting success;
  the warning and docs say that retention is by prescore rather than claiming the final strongest
  matches survived.
- JSON context messages now carry the correct `absolute_offset`, and JSON submatches preserve
  valid zero-width regex spans such as `^` and `$`.
- Context re-read failures now fail closed with exit 2 instead of silently omitting requested
  context after a successful search. Re-reads are capability-scoped to the search root, so a
  file replaced with an outside-pointing symlink cannot expose files beyond the searched tree.

### Verification and release hardening

- The differential suite now exercises 17 traversal and matcher cases per repository, including
  regex, whole-word, glob, type, type exclusion, multiple patterns, and a bounded
  `--no-ignore` fixture.
- Rust forbids unsafe code at compile time. ast-grep structural rules run in CI and through the
  repository pre-commit hook, with positive-control rule tests for unsafe blocks and direct
  JavaScript/TypeScript `eval`.
- Tag builds now create GitHub artifact attestations for every release archive in addition to the
  existing SHA-256 checksums.
- The public SWE-Explore harness now validates remote instance IDs, GitHub repository slugs,
  commit SHAs, and gold-file paths before they can influence cache cleanup, archive URLs, or
  filesystem probes; traversal and absolute-path attempts are covered by self-tests.
- Browser E2E fixes the manual's false “Nothing matches” state, removes mobile page overflow from
  wide tables, and replaces the missing favicon request with a self-contained icon.

## [0.1.2] — 2026-08-23

No ranking change — hay's source is untouched; this release is the measurement kit and the
release engineering, versioned together with the binary as always.

### Measurement kit: the documentation track

- `benchmark.ts --docs-track`: a public, mechanical development set for documentation retrieval
  — identifier-like tokens from ATX headings that appear in exactly one markdown file's headings
  and in ≥ 3 parity-visible files; the answer is that file. Same rank unit, cap, tool argv, and
  paired bootstrap + randomization as the code track; per-query shape features; own evidence
  file (`evidence/docs-track.json`), validated fail-closed before rendering.
- First published run (ripgrep, alamofire, this repo, n=30 each): hay loses to rg by
  **−0.440 MRR** and **−0.340 MRR** on the two public corpora, both tests p ≈ 0.0001 — the
  error-taxonomy's prose bucket, now quantified in public. The dominant doc-answerable shape is
  **PascalCase type names documented in markdown** (27/30 on alamofire) — a fact only visible
  after review caught PascalCase being classified as `plainWord`. Since PascalCase is also the
  code track's type-query shape, the planned shape-conditional penalty is **not licensed** by
  these counts; recorded in `docs/method/issues/11-cycle-2-plan.md` instead of shipped.
- The docs evidence validator recomputes every deterministic aggregate (MRR, top-10,
  truncations, splits, the paired mean and n) from the per-query rows — finite-but-false
  summaries now refuse to render, not just non-finite ones.
- A corpus-side doc prior (damp the prose penalty when a query's own match stream is
  prose-dominated) was pre-registered, fully implemented, measured on the registered grid, and
  **refused**: doc-answerable queries have prose match shares of 0.01–0.18 — the doc answer is
  a needle in a code haystack, so no result-set threshold separates them from code queries.
  Negative result and probe counts in `docs/method/issues/11-cycle-2-plan.md`; the binary is
  unchanged.
- `BENCHMARK.md`/`benchmark.html` render the documentation-track section when its evidence
  exists; byte-identical without it. `--corpus` and `--seed` are now first-class benchmark flags
  (seed default unchanged).

### Manual

- New "Make hay the default, not just available" recipe: instruction-level defaults per agent
  (Claude Code permissions syntax, Codex global `AGENTS.md`, pi native, Aider `--read`, Cursor
  `.mdc` with `alwaysApply`), a verify-it-took check, and a loud warning against shimming
  `rg` → `hay` — a shim silently turns exhaustive searches into ranked capped ones, the exact
  quiet-wrong-answer class hay's exit codes exist to prevent.
- Corrected a 0.1.0-era error the review caught: Claude Code does **not** read `AGENTS.md`
  (unshipped as of Aug 2026); the manual now shows Anthropic's documented `@AGENTS.md`-import
  and symlink patterns instead of listing the files as interchangeable.

### Release engineering

- `release.yml`: tag-triggered builds for macOS (arm64/x86_64), Linux (x86_64/arm64) and
  Windows, sha256s, binary-version-matches-tag guard, assets attached to a **draft** release —
  publishing stays a human act.
- CI now runs the differential test on Windows too (Git Bash + choco ripgrep): the parity
  property had never executed there.

## [0.1.1] — 2026-08-23

Repair release: the first public CI run on `main` failed, and everything here follows from
reading that failure instead of re-running it.

- MSRV is now **1.88**: ripgrep's own `globset`/`ignore` crates declare `rust-version = "1.88"`,
  so the previous 1.85 claim was false with the committed lockfile. Bumped in `Cargo.toml`, the
  CI MSRV job, the installer gate, and the docs.
- `install.sh`: the advertised one-liner now pipes to `bash` (the script uses `pipefail`, which
  `sh` on Debian-family systems rejects), and the "installing to" message no longer appends a
  second `/bin` to cargo's bin directory. CI shellcheck now covers `install.sh` too.
- `benchmark-feynman.html` regenerated — the committed copy was missing the live-companions
  paragraph `explainer-html.ts` emits, which CI's staleness gate caught on its first execution.

## [0.1.0] — 2026-08-22

First numbered release of **hay** — a ranked grep for coding agents — and the measurement kit
around it.

### hay (the binary)

- Drop-in for ripgrep's matches, guaranteed: a differential test proves hay returns exactly rg's
  matches on every change to walking, matching, or output. Only the order differs.
- Three ranking signals — definition (+6.0), path prior, damped term frequency — each with an
  ablation switch (`--no-definition`, `--no-path`, `--no-tf`) because a contribution you cannot
  switch off is a belief.
- Ripgrep-shaped JSON Lines (`match`/`context` messages), `-l` files-with-matches ranked best
  first, context windows that never reorder results, `--explain` per-signal score breakdowns,
  combined short flags via lexopt, loud exit codes (0 found / 1 nothing / 2 incomplete).
- Declined flags say why (`-v`, `-c`, `-o` name their ripgrep equivalents); the 20,000-candidate
  cap announces itself on stderr.

### Measurement kit

- Behavioural evaluation: agent transcripts → queries paired with the files agents opened next;
  paired bootstrap intervals cross-checked by Fisher randomization (`measure-mrr.ts --compare`).
- Public-corpus benchmark (`benchmark.ts`) with parser ground truth (ast-grep), seeded sampling,
  recorded query symbols for paired reruns (`--queries-from`), capability matrix, and honest
  limits. hay ranks first on all five corpora; margins confirmed by both tests on all four usable
  ones.
- `benchmark-corpora.sh`: clones missing corpora from the list in `benchmark.ts`, runs the full
  comparison, renders the report, deletes only what it cloned; refuses partial corpora.
- `benchmark-report.ts`: renders `BENCHMARK.md` plus a publishable `benchmark.html` — inline-SVG
  charts (Δ-MRR intervals where filled = both tests agree, top-10 shares, time ratios vs
  ripgrep) and a Feynman-style explanation from zero. The evidence file is a validated trust
  boundary: tampered numerics fail closed before rendering.
- Six dependency-free TS tools, each with a selftest.

### Site & docs

- GitHub Pages landing page with animated charts and a Remotion-rendered benchmark film.
- `MANUAL.html`: every flag, output format, exit code, AI-agent integration recipes
  (Claude Code, Codex CLI, pi, Cursor/Aider), installer.
- `install.sh`: toolchain-gated build-from-source installer.
