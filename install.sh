#!/usr/bin/env bash
# hay installer — builds from source with cargo. Safe to re-run (upgrades in place).
#
#   curl -fsSL https://raw.githubusercontent.com/mneves75/hay/main/install.sh | bash
#   …or inspect first:
#   git clone https://github.com/mneves75/hay.git && hay/install.sh  # (run from repo root)
#
# Env overrides:
#   HAY_REPO    source repository (default: https://github.com/mneves75/hay.git)
#   HAY_REF     branch/tag/commit to build (default: main)
#   CARGO_TARGET_DIR  passed through to cargo if you set it
set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "hay installer: missing '$1' ($2)" >&2; exit 2; }; }
need git "https://git-scm.com"
need cargo "https://rustup.rs — Rust edition 2024 needs a current toolchain"

# MSRV gate: hay is edition 2024 and its ripgrep crates declare rust-version 1.88.
rustc_minor() { rustc --version | sed -E 's/^rustc ([0-9]+)\.([0-9]+).*/\2/' | head -1; }
rustc_major() { rustc --version | sed -E 's/^rustc ([0-9]+)\.([0-9]+).*/\1/' | head -1; }
if [ "$(rustc_major)" -lt 1 ] || { [ "$(rustc_major)" -eq 1 ] && [ "$(rustc_minor)" -lt 88 ]; }; then
  echo "hay installer: rustc >= 1.88 required, found $(rustc --version)" >&2
  exit 2
fi

REPO="${HAY_REPO:-https://github.com/mneves75/hay.git}"
REF="${HAY_REF:-main}"

dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT

echo "==> cloning $REPO @ $REF"
git clone --depth 1 --branch "$REF" "$REPO" "$dir" 2>/dev/null \
  || git clone --depth 1 "$REPO" "$dir"

echo "==> building release binary"
cargo build --release --manifest-path "$dir/hay/Cargo.toml"

# cargo install ignores where the cargo binary lives; it targets
# $CARGO_INSTALL_ROOT, else $CARGO_HOME, else ~/.cargo — always <root>/bin.
bin_dir="${CARGO_INSTALL_ROOT:-${CARGO_HOME:-$HOME/.cargo}}/bin"
echo "==> installing to $bin_dir"
cargo install --path "$dir/hay" --force

if command -v hay >/dev/null 2>&1; then
  echo "==> installed: $(hay --version)"
  hay -F hay . >/dev/null 2>&1 && echo "==> smoke test: search works." || true
  echo "Done. Try: hay -F validateSession src/"
else
  echo "==> installed, but 'hay' is not on PATH." >&2
  echo "    Add \"$bin_dir\" to your PATH." >&2
fi
