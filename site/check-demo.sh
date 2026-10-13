#!/usr/bin/env bash
set -euo pipefail

site_repo_root="$(cd "$(dirname "$0")/.." && pwd)"
site_hay_binary="${HAY_BINARY:-$site_repo_root/hay/target/release/hay}"
if [ ! -f "$site_hay_binary" ] && [ -f "$site_hay_binary.exe" ]; then
  site_hay_binary="$site_hay_binary.exe"
fi
site_normalize() { tr '\134' '/' | tr -d '\r'; }
cd "$site_repo_root/site/demo/fixture"
if ! site_hay_output="$("$site_hay_binary" --hidden -g '!.git' -g '!.git/**' -n -F -e validateSession .)"; then
  echo 'FAIL: hay fixture search did not complete' >&2
  exit 1
fi
if ! site_rg_output="$(rg --hidden --no-ignore-global --no-ignore-exclude --no-ignore-dot -g '!.git' -g '!.git/**' --sort path -n -F -e validateSession .)"; then
  echo 'FAIL: ripgrep fixture search did not complete' >&2
  exit 1
fi
diff -u <(site_normalize < ../expected-hay.txt) <(printf '%s\n' "$site_hay_output" | site_normalize)
diff -u <(site_normalize < ../expected-rg.txt) <(printf '%s\n' "$site_rg_output" | site_normalize)
diff -u <(printf '%s\n' "$site_hay_output" | site_normalize | LC_ALL=C sort) <(printf '%s\n' "$site_rg_output" | site_normalize | LC_ALL=C sort)
echo 'PASS: illustrative fixture, 6 matches / 4 files, both orders and match set verified'
