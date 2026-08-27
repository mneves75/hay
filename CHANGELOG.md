# Changelog

Versions track `hay`, the shipped binary. The measurement kit is versioned with the repository.
This changelog starts at 0.1.0: everything before was development under a different name, and its
history lives in git and `memory/`.

## [Unreleased]

## [0.2.0] — 2026-08-27

The first ranking change since 0.1.0, and the first release whose headline is the ranker rather
than its packaging. On the 951-query behavioural corpus, paired against `ripgrep --sort path`:
MRR **0.258 → 0.458** (+0.1995, 95% CI [0.1754, 0.2243], randomization p=0.0001), answer in the
top ten **44.9% → 77.1%** (+32.2 pts [28.9, 35.5]), nDCG@10 **0.358 → 0.501** (+0.1434). Queries
where `hay` is *worse* than ripgrep fall from 235 of 951 (25%) to 115 (12%); no repository is
worse than ripgrep. On the public SWE-Explore-Bench sample, MRR **0.242 → 0.551** (+0.3085
[0.2321, 0.3878]).

**The pre-registered gate still fails**, at median-repo MRR **0.4437** against 0.50 and top-10
**78.5%** against 80%, up from 0.3810 / 59.2%. It has not been moved. An oracle that ranks any
answer file first scores 1.00 on this corpus, so nothing about the corpus makes the threshold
unreachable — the remaining gap is ranking quality, not measurement.

### Ranking

- **Results are interleaved by file.** The first pass carries each file's strongest line, the
  second its next-strongest. Relevance judgments for code are per file and an agent opens files,
  so a first page of ten files is worth more than ten lines of one module. Nothing is re-scored
  and the sequence of distinct files is unchanged, so `-l` output is byte-identical; only the
  layout of the ranked list changes. Worth +0.0071 to +0.0355 MRR across the public corpora and
  +18.8 points of behavioural top-10 on its own. `--no-diversify` restores strict score order.
- **New `word` signal**, pre-registered in `DESIGN-hay.md` before any Rust was written and
  unimplemented until now: `+1.0` when the match is a whole identifier, `+0.5` when it starts one,
  nothing when it is buried inside a longer name (`auth` inside `oauthToken`). Measured
  contribution +0.0095 (openclaw), +0.0163 (ripgrep), +0.0217 (alamofire) MRR. `--no-word`.
- **A filename signal was implemented, ablated, and deleted.** A bonus for a file whose own name is
  the query is the highest-weighted field in every published lexical code retriever, and it scored
  +0.033 median MRR in a simulation on the private evaluation corpus. On the development sets it
  earned +0.008 (openclaw), +0.000 (ripgrep), −0.002 (alamofire) and **−0.0136 on SWE-Explore**,
  the one public agent-shaped benchmark. Deleted, per the design document's own rule: a signal
  that does not improve MRR in ablation does not ship, and the evaluation set does not get a vote.

### Fixed

- **`hay` crashed on a non-ASCII query.** Both identifier scans advanced one *byte* past a rejected
  occurrence, so a query whose first hit sat inside a word sliced into the middle of a multi-byte
  character: `hay -F -e 'éé'` over a line containing `aéé` exited 2 with "ranking thread panicked"
  on a search ripgrep answers normally. Found in review, reproduced from the command line first,
  and covered by a unit test and a CLI contract test.
- **The public external-validity benchmark was silently losing 22% of its sample.** A repository
  archive containing any symbolic link was rejected whole, so 21 of the 97 committed SWE-Explore
  instances (django, sympy and friends) never scored on a clean machine. Links are now dropped
  individually and counted — never written to disk, which is what the check was for — and
  ripgrep does not follow symlinks anyway, so the extracted tree is identical for the measurement.
  The run goes from 75 to 96 scored instances, the one remaining exclusion being an archive over
  the size budget.

### Measurement kit

- `swe-explore.ts --ablate <signals> --out <path>` runs the public agent-shaped benchmark with a
  ranking signal turned off. It refuses to write `evidence/swe-explore.json` and records the flags
  in the payload, so an ablation cannot be mistaken for the published run.

## [0.1.4] — 2026-08-27

No ranking change — this release closes integrity gaps in the installer, measurement kit, public
benchmark provenance, and generated web surfaces. The three ranking signals, weights, failed
pre-registered gate, and complete-search parity contract are unchanged.

### Security and release integrity

- `install.sh` now resolves the requested branch, tag, or commit exactly, refuses an invalid
  `HAY_REF` instead of falling back to `main`, installs with Cargo's lockfile, passes the resolved
  destination with `--root`, and verifies that exact binary rather than an older `PATH` entry. A
  Cargo `install.root` setting therefore cannot redirect the install away from the checked path.
- Transcript-derived corpora and paired-query dumps can only be written beneath the gitignored
  `corpus/` boundary, with 0700 directories and 0600 files; traversal and symlinked parents are
  rejected, and atomic replacement prevents a pre-planted hard link from being truncated.
- SWE-Explore repository archives now use the maintained `tar` parser and enforce compressed and
  expanded byte budgets, decompression ratio, member count, path depth, and regular-file/directory
  entry types before extraction, aborting both the input stream and decompressor on the first
  violation. The committed sample manifest is never rewritten after partial
  scoring and an unresolvable manifest fails closed.
- CI uses the active Node 24 LTS line for the benchmark film and runs the installer's exact-ref
  positive controls.
- The public-corpus helper rejects ambiguous clone names, sets an explicit network user agent, and removes
  only the exact clones created by that run.

### Measurement integrity

- Natural child-process failures now invalidate measurements while deliberate early rank stops
  remain distinct; generic commands such as `git` and `find` must exit zero.
- Bootstrap output distinguishes observations from resampling clusters. Public code and
  documentation benchmarks record generation time plus corpus commit/dirty state, and the
  renderer rejects dirty provenance, impossible ranges, missing reference tests, and aggregates
  that disagree with their rows.
- The public benchmark was rerun from clean, recorded corpus revisions. Inferential comparisons now
  require a stable-order contract: ripgrep uses `--sort path`, ugrep uses `--sort=name`, and
  unordered tools remain labeled snapshots without confidence intervals or p-values. `hay` clears
  both statistical tests against sorted ripgrep on all four usable code corpora; the separate
  documentation track detects regressions on ripgrep's repository and Alamofire, preventing the
  code result from being presented as a universal search improvement.
- Transcript harvesting recognizes attached `-ePATTERN`, `-pPATTERN`, `--regexp=...`, and
  `--pattern=...` forms. Document-authority analysis now subtracts only the actual target file
  from inbound-link counts and prefilters transcript parsing to the eligible repository cohort;
  its public aggregate was recomputed from the corrected instrument.

### Site and documentation

- `BENCHMARK_FEYNMAN.html` is the single canonical hosted explainer filename across its
  generator, CI, README, and manual; the page now carries description, canonical, and Open Graph
  metadata and refuses unsafe link schemes.
- The manual tolerates unavailable browser storage, supports clipboard fallback when opened
  locally, and announces copy failures without disabling its other controls.
- Benchmark, explainer, and manual auxiliary text, table headings, and chart captions now retain WCAG AA contrast in light and dark themes; mobile layouts no longer overflow, and horizontally scrollable tables and code blocks accept keyboard focus.
- Scroll-linked entrance motion no longer lowers text opacity.
- The benchmark film imports committed evidence instead of hand-copied scores, derives its
  installer version from that evidence, keeps ranking copy neutral until final scores settle, and
  refuses to render if the four-corpus layout, deterministic comparison, or release reference is
  unsupported. It derives the documentation counter-result from committed evidence and displays it
  beside the code result. Its render is explicitly muted, so the silent film ships without a phantom
  audio track.

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
