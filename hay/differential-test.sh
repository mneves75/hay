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
REPOS=("${@:-$(cd "$(dirname "$0")/.." && pwd)}")

pass=0; fail=0
for repo in "${REPOS[@]}"; do
  [ -d "$repo" ] || { echo "skip (not a directory): $repo" >&2; continue; }
  for q in "${QUERIES[@]}"; do
    # Identical traversal semantics on both sides: hidden included, VCS metadata excluded,
    # operator-local ignore sources disabled.
    a=$(cd "$repo" && rg --no-config --no-ignore-dot --no-ignore-global --no-ignore-exclude \
          --hidden -g '!.git/' -g '!.hg/' -g '!.svn/' -g '!.jj/' -i -F -n -e "$q" . 2>/dev/null \
        | sed 's|^\./||' | sort)
    b=$(cd "$repo" && "$HAY" --hidden -i -F -n -m 0 -e "$q" . 2>/dev/null | sed 's|^\./||' | sort)
    if [ "$a" = "$b" ]; then
      pass=$((pass+1))
    else
      fail=$((fail+1))
      echo "DIFFERS  $(basename "$repo")  '$q'  rg=$(printf '%s' "$a" | grep -c .) hay=$(printf '%s' "$b" | grep -c .)"
      diff <(printf '%s\n' "$a") <(printf '%s\n' "$b") | head -5
    fi
  done
done

echo "identical: $pass   differing: $fail"
[ "$fail" -eq 0 ]
