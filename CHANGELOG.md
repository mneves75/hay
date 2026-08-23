# Changelog

Versions track `hay`, the shipped binary. The measurement kit is versioned with the repository.
This changelog starts at 0.1.0: everything before was development under a different name, and its
history lives in git and `memory/`.

## [Unreleased]

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
