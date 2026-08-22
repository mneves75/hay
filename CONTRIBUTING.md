# Contributing to `hay`

Thank you for helping improve `hay`. Keep changes small, measurable, and compatible with ripgrep's match set.

## Before opening an issue or pull request

- Remove personal data, secrets, private repository names, absolute paths, and transcript excerpts
- Put private measurement output only in the gitignored `corpus/` directory
- Use anonymized labels and `--redact-names` for any shared measurement output
- Report exploitable security issues through **Security → Report a vulnerability**, not a public issue

## Validate a change

Run the checks relevant to your files:

```bash
cargo fmt --manifest-path hay/Cargo.toml --check
cargo clippy --manifest-path hay/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path hay/Cargo.toml
./hay/differential-test.sh
bun install --frozen-lockfile
bun audit
bun run typecheck
cd site/video-src
pnpm install --frozen-lockfile
pnpm audit --audit-level high
pnpm lint
pnpm build
```

Run the TypeScript tool's `--selftest` when you change it. Changes to walking, matching, or output must pass `./hay/differential-test.sh` with zero differences.

## Pull requests

Explain the behavior changed, the smallest check that proves it, and any residual risk. Update `CHANGELOG.md` for user-visible changes. Do not commit generated evidence from private data.
