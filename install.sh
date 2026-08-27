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
#   CARGO_INSTALL_ROOT  install root (default: CARGO_HOME, then ~/.cargo)
#   CARGO_TARGET_DIR   passed through to cargo if you set it
set -euo pipefail

need() { command -v "$1" >/dev/null 2>&1 || { echo "hay installer: missing '$1' ($2)" >&2; exit 2; }; }
need git "https://git-scm.com"

# Fetch the requested object itself. `git clone --branch` accepts branches and tags, not arbitrary
# commits; the old fallback silently cloned the default branch when that failed, defeating HAY_REF.
checkout_source() {
  local repo="$1" ref="$2" destination="$3"
  git init -q "$destination"
  git -C "$destination" remote add origin "$repo"
  git -C "$destination" fetch --quiet --depth 1 origin -- "$ref"
  git -C "$destination" checkout --quiet --detach FETCH_HEAD
  [ "$(git -C "$destination" rev-parse HEAD)" = "$(git -C "$destination" rev-parse 'FETCH_HEAD^{commit}')" ]
}

resolved_install_root() {
  printf "%s\n" "${CARGO_INSTALL_ROOT:-${CARGO_HOME:-$HOME/.cargo}}"
}

cargo_install() {
  local source_path="$1" install_root="$2"
  cargo install --locked --path "$source_path" --force --root "$install_root"
}

installer_selftest() (
  local root source checkout first second
  local -a captured_args=()
  root="$(mktemp -d)"
  trap 'chmod -R u+w "$root"; rm -r "$root"' EXIT
  source="$root/source"
  mkdir "$source"
  git init -q "$source"
  git -C "$source" config user.email installer-test@example.invalid
  git -C "$source" config user.name installer-test
  printf 'first\n' > "$source/marker"
  git -C "$source" add marker
  git -C "$source" commit -qm first
  git -C "$source" branch -M main
  first="$(git -C "$source" rev-parse HEAD)"
  git -C "$source" tag -am "annotated installer test tag" test-tag
  git -C "$source" branch test-branch
  printf 'second\n' > "$source/marker"
  git -C "$source" commit -qam second
  second="$(git -C "$source" rev-parse HEAD)"

  checkout="$root/by-branch"
  checkout_source "$source" main "$checkout"
  [ "$(git -C "$checkout" rev-parse HEAD)" = "$second" ]
  checkout="$root/by-tag"
  checkout_source "$source" test-tag "$checkout"
  [ "$(git -C "$checkout" rev-parse HEAD)" = "$first" ]
  checkout="$root/by-commit"
  checkout_source "$source" "$first" "$checkout"
  [ "$(git -C "$checkout" rev-parse HEAD)" = "$first" ]
  if checkout_source "$source" does-not-exist "$root/bad-ref" 2>/dev/null; then
    echo "installer selftest: nonexistent ref unexpectedly succeeded" >&2
    return 1
  fi
  if checkout_source "$source" --depth=1 "$root/bad-option" 2>/dev/null; then
    echo "installer selftest: option-like ref unexpectedly succeeded" >&2
    return 1
  fi
  [ "$(CARGO_INSTALL_ROOT="$root/custom" CARGO_HOME="$root/cargo-home" HOME="$root/home" resolved_install_root)" = "$root/custom" ]
  [ "$(CARGO_INSTALL_ROOT="" CARGO_HOME="$root/cargo-home" HOME="$root/home" resolved_install_root)" = "$root/cargo-home" ]
  [ "$(CARGO_INSTALL_ROOT="" CARGO_HOME="" HOME="$root/home" resolved_install_root)" = "$root/home/.cargo" ]

  cargo() { captured_args=("$@"); }
  cargo_install "$root/package" "$root/install"
  [ "${#captured_args[@]}" -eq 7 ]
  [ "${captured_args[0]}" = install ]
  [ "${captured_args[1]}" = --locked ]
  [ "${captured_args[2]}" = --path ]
  [ "${captured_args[3]}" = "$root/package" ]
  [ "${captured_args[4]}" = --force ]
  [ "${captured_args[5]}" = --root ]
  [ "${captured_args[6]}" = "$root/install" ]

  echo "installer selftest ok"
)

if [ "${1:-}" = "--selftest" ]; then
  installer_selftest
  exit 0
fi

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
trap 'chmod -R u+w "$dir"; rm -r "$dir"' EXIT

echo "==> fetching $REPO @ $REF"
if ! checkout_source "$REPO" "$REF" "$dir"; then
  echo "hay installer: could not resolve requested ref '$REF'; nothing installed" >&2
  exit 2
fi
echo "==> source commit $(git -C "$dir" rev-parse HEAD)"

# Resolve the destination once and pass it back to Cargo explicitly. Cargo config can also set
# install.root; without --root, Cargo could install there while this script verified another path.
# Set CARGO_INSTALL_ROOT to customize the installer destination deterministically.
install_root="$(resolved_install_root)"
bin_dir="$install_root/bin"
echo "==> installing to $bin_dir"
cargo_install "$dir/hay" "$install_root"

installed="$bin_dir/hay"
if [ -x "$installed" ]; then
  echo "==> installed: $($installed --version)"
  if "$installed" -F 'name = "hay"' "$dir/hay/Cargo.toml" >/dev/null 2>&1; then
    echo "==> smoke test: newly installed binary searches successfully."
  else
    echo "hay installer: newly installed binary failed its smoke test" >&2
    exit 2
  fi
  echo "Done. Try: hay -F validateSession src/"
else
  echo "==> cargo install completed, but $installed is missing or not executable." >&2
  echo "    Add \"$bin_dir\" to your PATH." >&2
  exit 2
fi
