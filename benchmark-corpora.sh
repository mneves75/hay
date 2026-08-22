#!/usr/bin/env bash
# Full public benchmark on a clean machine: clone the corpora benchmark.ts wants, run it, render
# the report, then delete only the clones we made.
#
# The clone list is read FROM benchmark.ts, not duplicated here — one source of truth, so a new
# corpus in CORPORA is picked up with no edit here. Existing corpus dirs are left alone, both when
# cloning and when cleaning up.
#
# Usage: ./benchmark-corpora.sh [benchmark.ts args...]
#        BENCH_CORPORA=/some/dir ./benchmark-corpora.sh --sample 10
set -uo pipefail
cd "$(dirname "$0")" || exit 2

CORPORA_DIR="${BENCH_CORPORA:-${XDG_CACHE_HOME:-$HOME/.cache}/hay/corpora}"
case "$CORPORA_DIR" in ""|/) echo "refusing unsafe corpus root: $CORPORA_DIR" >&2; exit 2;; esac
mkdir -p "$CORPORA_DIR" || { echo "cannot create $CORPORA_DIR" >&2; exit 2; }

for arg in "$@"; do
  case "$arg" in --corpora|--corpora=*) echo "set BENCH_CORPORA instead of passing --corpora" >&2; exit 2;; esac
done

# The corpus list is read from benchmark.ts ONCE: if bun fails or prints nothing, the loops
# below must not run on empty input — a vacuous pass here would silently benchmark whatever
# happens to be on disk.
list="$(bun -e 'import {CORPORA} from "./benchmark.ts";
for (const c of CORPORA) if (c.clone) console.log(c.dir, c.clone);')" \
  || { echo "cannot read corpus list from benchmark.ts (is bun installed?)" >&2; exit 2; }
[ -n "$list" ] || { echo "corpus list came back empty" >&2; exit 2; }

cloned=()
cleanup() {
  for d in "${cloned[@]:-}"; do
    [ -n "$d" ] || continue
    echo "== removing $d (cloned for this run)" >&2
    rm -rf "${CORPORA_DIR:?}/$d"
  done
}
trap cleanup EXIT

while read -r dir url; do
  [ -n "$dir" ] || continue
  # dir/url come from committed source, but this script performs the repo's only destructive bulk
  # operation — validate before they touch rm -rf or git.
  case "$dir" in *[!A-Za-z0-9._-]*|"") echo "rejecting unsafe corpus dir: $dir" >&2; exit 2;; esac
  case "$url" in https://*[[:space:]]*|https://) echo "rejecting clone url with whitespace or no host: $url" >&2; exit 2;; esac
  if [ -d "$CORPORA_DIR/$dir" ]; then
    echo "== $dir already present, reusing (and leaving in place)"
    continue
  fi
  echo "== cloning $dir"
  # Abort when the transfer stalls: github's smart-HTTP path can hang mid-handshake (seen here:
  # web endpoints fine, /info/refs silent), and a hung clone must not block the run forever.
  if ! git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=60 clone --depth 1 "$url" "$CORPORA_DIR/$dir"; then
    rm -rf "${CORPORA_DIR:?}/$dir"   # a partial clone must not look "present" to the next run
    echo "clone failed: $url" >&2
    exit 2
  fi
  cloned+=("$dir")
done <<<"$list"

# Never benchmark against a partial corpus: benchmark.ts skips absent dirs and would happily
# write partial tables. Exit 2 means incomplete, per the repo's error discipline.
while read -r dir _; do
  [ -d "$CORPORA_DIR/$dir" ] || { echo "corpus still missing: $dir — not benchmarking" >&2; exit 2; }
done <<<"$list"

# --corpora must match the directory we just verified, or a custom BENCH_CORPORA would verify one
# tree and measure another. User args go FIRST: benchmark.ts's flag() takes the first occurrence,
# so a caller's --sample must precede our default.
bun benchmark.ts "$@" --corpora "$CORPORA_DIR" --sample 30 && bun benchmark-report.ts
