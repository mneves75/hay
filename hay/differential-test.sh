#!/usr/bin/env bash
# Differential test: hay must return EXACTLY the matches ripgrep returns, only reordered.
#
# This is hay's core correctness property and the one that is easiest to break silently — three
# separate defects (missing binary detection, unexcluded .git/, hidden-file handling) all showed up
# first as a set difference here, not as a failing unit test.
#
# Usage: ./differential-test.sh <repo>...   (defaults to the repo containing this script)
set -uo pipefail

HAY="$(cd "$(dirname "$0")" && pwd)/target/release/hay"
[ -x "$HAY" ] || { echo "build first: cargo build --release" >&2; exit 2; }

QUERIES=(config auth handler validate client error session request update create)
if [ "$#" -gt 0 ]; then
  REPOS=("$@")
else
  REPOS=("$(cd "$(dirname "$0")/.." && pwd)")
fi

# These are exact traversal counterparts. Keep every change symmetric: a comparison over
# different file sets is not a ranking comparison.
RG_BASE=(--no-config --no-ignore-dot --no-ignore-global --no-ignore-exclude --hidden
  -g '!.git/' -g '!.hg/' -g '!.svn/' -g '!.jj/')
HAY_BASE=(--hidden -m 0)

pass=0; fail=0

compare_case() {
  local repo=$1 label=$2
  shift 2
  local a b
  a=$(cd "$repo" && rg "${RG_BASE[@]}" -n "$@" . 2>/dev/null | sed 's|^\./||' | sort)
  b=$(cd "$repo" && "$HAY" "${HAY_BASE[@]}" -n "$@" . 2>/dev/null | sed 's|^\./||' | sort)
  if [ "$a" = "$b" ]; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
    echo "DIFFERS  $(basename "$repo")  $label  rg=$(printf '%s' "$a" | grep -c .) hay=$(printf '%s' "$b" | grep -c .)"
    diff <(printf '%s\n' "$a") <(printf '%s\n' "$b") | head -5
  fi
}

for repo in "${REPOS[@]}"; do
  [ -d "$repo" ] || { echo "skip (not a directory): $repo" >&2; continue; }
  for q in "${QUERIES[@]}"; do
    compare_case "$repo" "literal:$q" -i -F -e "$q"
  done

  # Small mode matrix for surfaces that fixed-literal tests cannot exercise. Empty result sets
  # still count as parity; the purpose is to catch a one-sided matcher or walker change.
  compare_case "$repo" regex-definitions -e '(fn|function|class)[[:space:]]+[A-Za-z_]'
  compare_case "$repo" whole-word -i -w -F -e config
  compare_case "$repo" rust-glob -F -g '*.rs' -e fn
  compare_case "$repo" rust-type -F -t rust -e fn
  compare_case "$repo" no-markdown -i -F -T md -e config
  compare_case "$repo" multiple-patterns -i -F -e config -e auth
done


# Exercise `--no-ignore` on a bounded fixture. A real repository can legitimately exceed hay's
# candidate cap under this flag, which would test truncation rather than traversal parity.
fixture=$(mktemp -d "${TMPDIR:-/tmp}/hay-differential.XXXXXX") || exit 2
trap 'rm -r "$fixture"' EXIT
git -C "$fixture" init -q
printf 'ignored.txt\n' > "$fixture/.gitignore"
printf 'hidden_by_ignore\n' > "$fixture/ignored.txt"
printf 'hidden_by_ignore\n' > "$fixture/visible.txt"
compare_case "$fixture" no-ignore --no-ignore -F -e hidden_by_ignore
echo "identical: $pass   differing: $fail"
[ "$fail" -eq 0 ]
