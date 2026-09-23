#!/usr/bin/env bash
# Fail-closed policy for main-dispatched releases.
#
# The maintainer creates a lightweight `v*` tag at a main commit whose push CI succeeded, then
# dispatches release-dispatch.yml FROM main. The workflow is therefore always loaded from main, never from
# the tag: a tag aimed at older history cannot run an older copy of this policy, and the build,
# attestation and draft all bind to the dispatch SHA, which the tag must name exactly.
set -euo pipefail

die() {
  echo "release-policy: $*" >&2
  exit 2
}

# Whole-string matches: `printf | grep -E '^...$'` is line-based and admitted a value with an
# embedded newline whenever one of its lines matched.
valid_release_tag() {
  [[ "$1" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-beta[1-9][0-9]*)?$ ]]
}

valid_commit_sha() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]]
}

package_version_from_manifest() {
  local package_id version

  package_id="$(cargo pkgid --manifest-path hay/Cargo.toml 2>/dev/null)" ||
    die "could not resolve the hay package version"
  version="${package_id##*#}"
  version="${version##*@}"
  if [ -z "$version" ] || [ "$version" = "$package_id" ]; then
    die "cargo returned an unrecognized package ID"
  fi
  printf '%s\n' "$version"
}

release_tag_matches_package_version() {
  local tag_version="${1#v}" package_version="$2"

  tag_version="${tag_version%%-beta*}"
  [ "$tag_version" = "$package_version" ]
}

# A beta stages a version that has not shipped yet. Once the stable tag exists, a later beta of the
# same version would build a different commit that also reports itself as that stable version.
beta_allowed_given_stable_count() {
  local tag="$1" count="$2"
  case "$count" in
    ''|*[!0-9]*) return 2 ;;
  esac
  [[ "$tag" != *-beta* ]] || [ "$count" -eq 0 ]
}

require_successful_ci_count() {
  local count="$1"
  case "$count" in
    ''|*[!0-9]*) return 2 ;;
  esac
  [ "$count" -ge 1 ]
}

# An annotated tag's ref names a tag object, not the commit, and would need a second dereference
# that brew-formula.sh deliberately does not perform; only a lightweight tag at the exact commit
# is accepted, so every consumer resolves the same SHA with one API call.
require_existing_tag_matches() {
  local object_type="$1" existing_sha="$2" target_sha="$3"
  [ "$object_type" = commit ] && valid_commit_sha "$existing_sha" &&
    [ "$existing_sha" = "$target_sha" ]
}

check_tag() {
  local tag="${RELEASE_TAG:-}" repository="${GITHUB_REPOSITORY:-}"
  local target_sha="${RELEASE_SHA:-}" existing object_type existing_sha

  valid_release_tag "$tag" || die "invalid release tag '$tag'"
  [ -n "$repository" ] || die "GITHUB_REPOSITORY is required"
  valid_commit_sha "$target_sha" || die "RELEASE_SHA must be a lowercase 40-character commit SHA"

  existing="$(gh api "repos/${repository}/git/ref/tags/${tag}" \
    --jq '[.object.type, .object.sha] | @tsv')" ||
    die "tag $tag does not exist; create it at $target_sha before dispatching"
  IFS=$'\t' read -r object_type existing_sha <<<"$existing"
  require_existing_tag_matches "$object_type" "$existing_sha" "$target_sha" ||
    die "tag $tag is not a lightweight tag at the dispatch commit $target_sha"
  echo "release-policy: $tag is a lightweight tag at $target_sha"
}

# A draft may only be refreshed when every asset it already holds is one this run built. The asset
# list is captured on its own: inside a process substitution a failed query would read as an empty
# draft and wave the upload through.
check_draft_assets() {
  local tag="${RELEASE_TAG:-}" repository="${GITHUB_REPOSITORY:-}" dist="${DIST_DIR:-dist}"
  local assets built foreign

  valid_release_tag "$tag" || die "invalid release tag '$tag'"
  [ -n "$repository" ] || die "GITHUB_REPOSITORY is required"
  [ -d "$dist" ] || die "build output directory $dist is missing"
  assets="$(gh release view "$tag" -R "$repository" --json assets -q '.assets[].name')" ||
    die "could not list the assets of draft $tag"
  built="$(find "$dist" -maxdepth 1 -type f -exec basename {} \; | LC_ALL=C sort)"
  foreign="$(LC_ALL=C comm -13 <(printf '%s\n' "$built") <(printf '%s\n' "$assets" | LC_ALL=C sort) | sed '/^$/d')"
  [ -z "$foreign" ] || die "draft $tag holds assets this run did not build: $(printf '%s' "$foreign" | tr '\n' ' ')"
  echo "release-policy: every asset on draft $tag was built by this run"
}

verify_release() {
  local tag="${RELEASE_TAG:-}" repository="${GITHUB_REPOSITORY:-}"
  local source_ref="${GITHUB_REF:-}" source_sha="${GITHUB_SHA:-}" ci_count package_version
  local stable_count

  valid_release_tag "$tag" || die "invalid release tag '$tag'"
  package_version="$(package_version_from_manifest)"
  release_tag_matches_package_version "$tag" "$package_version" ||
    die "release tag $tag does not match hay package version $package_version"
  [ -n "$repository" ] || die "GITHUB_REPOSITORY is required"
  if [[ "$tag" == *-beta* ]]; then
    # matching-refs is a PREFIX match (v0.3.1 also matches v0.3.10), so the jq keeps the exact ref.
    stable_count="$(gh api "repos/${repository}/git/matching-refs/tags/${tag%%-beta*}" \
      --jq "map(select(.ref == \"refs/tags/${tag%%-beta*}\")) | length")" ||
      die "could not check whether ${tag%%-beta*} is already released"
    beta_allowed_given_stable_count "$tag" "$stable_count" ||
      die "${tag%%-beta*} is already tagged; bump the version instead of staging a beta of it"
  fi
  [ "$source_ref" = refs/heads/main ] || die "release must be dispatched from refs/heads/main"
  valid_commit_sha "$source_sha" || die "GITHUB_SHA must be a lowercase 40-character commit SHA"

  # The event SHA must still be on main if main advances after dispatch. A force-pushed-away SHA
  # is never releaseable; the main ruleset forbids force pushes as defence in depth.
  git fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
  git merge-base --is-ancestor "$source_sha" refs/remotes/origin/main ||
    die "dispatch commit $source_sha is not contained in origin/main"

  # The API filters are repeated in the jq predicate so a changed or partial server-side filter
  # cannot turn an unrelated successful run into release authorization.
  ci_count="$(
    gh run list -R "$repository" --workflow ci.yml --branch main --commit "$source_sha" \
      --event push --status success --limit 100 \
      --json conclusion,event,headBranch,headSha,status \
      --jq "map(select(.conclusion == \"success\" and .event == \"push\" and .headBranch == \"main\" and .headSha == \"${source_sha}\" and .status == \"completed\")) | length"
  )" || die "could not query CI runs for $source_sha"
  require_successful_ci_count "$ci_count" ||
    die "no successful completed CI push run on main exists for $source_sha"

  RELEASE_SHA="$source_sha" check_tag

  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'tag=%s\nsha=%s\n' "$tag" "$source_sha" >>"$GITHUB_OUTPUT"
  fi
  echo "release-policy: $tag is authorized for main@$source_sha by exact-SHA CI"
}

selftest() {
  local good_sha="0123456789abcdef0123456789abcdef01234567"
  local upper_sha="0123456789ABCDEF0123456789ABCDEF01234567"
  local workflow=.github/workflows/release-dispatch.yml
  local bad manifest_version

  valid_release_tag v1.2.3 || { echo "selftest: stable tag rejected" >&2; exit 1; }
  valid_release_tag v1.2.3-beta12 || { echo "selftest: beta tag rejected" >&2; exit 1; }
  for bad in v1 v1.2 v1.2.3-beta v1.2.3-beta0 v1.2.3-rc1 'v1.2.3";id' $'v1.2.3\nsha=evil' $'x\nv1.2.3'; do
    if valid_release_tag "$bad"; then
      echo "selftest: invalid tag admitted: $bad" >&2
      exit 1
    fi
  done

  manifest_version="$(package_version_from_manifest)"
  valid_release_tag "v$manifest_version" ||
    { echo "selftest: Cargo package version cannot form a release tag" >&2; exit 1; }

  release_tag_matches_package_version v1.2.3 1.2.3 ||
    { echo "selftest: matching stable package version rejected" >&2; exit 1; }
  release_tag_matches_package_version v1.2.3-beta12 1.2.3 ||
    { echo "selftest: matching beta package version rejected" >&2; exit 1; }
  for bad in v1.2.4 v1.3.3 v2.2.3; do
    if release_tag_matches_package_version "$bad" 1.2.3; then
      echo "selftest: mismatched package version admitted: $bad" >&2
      exit 1
    fi
  done

  valid_commit_sha "$good_sha" || { echo "selftest: valid SHA rejected" >&2; exit 1; }
  for bad in "${good_sha}0" "${good_sha%?}" "$upper_sha" refs/heads/main $'x\n'"$good_sha"; do
    if valid_commit_sha "$bad"; then
      echo "selftest: invalid SHA admitted: $bad" >&2
      exit 1
    fi
  done

  require_successful_ci_count 1 || { echo "selftest: successful CI count rejected" >&2; exit 1; }
  for bad in 0 '' nope -1; do
    if require_successful_ci_count "$bad"; then
      echo "selftest: missing or malformed CI evidence admitted: '$bad'" >&2
      exit 1
    fi
  done

  beta_allowed_given_stable_count v1.2.3-beta1 0 ||
    { echo "selftest: beta of an unreleased version rejected" >&2; exit 1; }
  beta_allowed_given_stable_count v1.2.3 1 ||
    { echo "selftest: stable tag rejected by the beta rule" >&2; exit 1; }
  if beta_allowed_given_stable_count v1.2.3-beta2 1 || beta_allowed_given_stable_count v1.2.3-beta2 ""; then
    echo "selftest: beta of an already-tagged version accepted" >&2; exit 1
  fi
  require_existing_tag_matches commit "$good_sha" "$good_sha" ||
    { echo "selftest: matching lightweight tag rejected" >&2; exit 1; }
  if require_existing_tag_matches tag "$good_sha" "$good_sha" ||
    require_existing_tag_matches commit "$upper_sha" "$good_sha" ||
    require_existing_tag_matches commit "$good_sha" "${good_sha%?}0"; then
    echo "selftest: mismatched or annotated tag admitted" >&2
    exit 1
  fi

  # Prove a missing tag and a tag at another commit both stop the release rather than falling
  # through, and that each fails for its own reason.
  local out
  # shellcheck disable=SC2317  # invoked indirectly by check_tag
  gh() { return 1; }
  if out="$(RELEASE_TAG=v1.2.3 RELEASE_SHA="$good_sha" GITHUB_REPOSITORY=o/r check_tag 2>&1)"; then
    echo "selftest: missing tag admitted" >&2; exit 1
  fi
  printf '%s' "$out" | grep -Fq 'does not exist' ||
    { echo "selftest: missing tag failed for the wrong reason: $out" >&2; exit 1; }
  # shellcheck disable=SC2317
  gh() { printf 'commit\t%s\n' "${good_sha%?}0"; }
  if out="$(RELEASE_TAG=v1.2.3 RELEASE_SHA="$good_sha" GITHUB_REPOSITORY=o/r check_tag 2>&1)"; then
    echo "selftest: tag at another commit admitted" >&2; exit 1
  fi
  printf '%s' "$out" | grep -Fq 'not a lightweight tag at the dispatch commit' ||
    { echo "selftest: moved tag failed for the wrong reason: $out" >&2; exit 1; }
  # shellcheck disable=SC2317
  gh() { printf 'commit\t%s\n' "$good_sha"; }
  RELEASE_TAG=v1.2.3 RELEASE_SHA="$good_sha" GITHUB_REPOSITORY=o/r check_tag >/dev/null ||
    { echo "selftest: tag at the dispatch commit rejected" >&2; exit 1; }
  unset -f gh

  # Draft refresh: a failed asset query, and a draft holding a foreign asset, must each stop.
  local dist
  dist="$(mktemp -d "${TMPDIR:-/tmp}/hay-release-policy.XXXXXX")"
  touch "$dist/hay-v1.2.3-x.tar.gz" "$dist/hay-v1.2.3-x.tar.gz.sha256"
  # shellcheck disable=SC2317  # invoked indirectly by check_draft_assets
  gh() { return 1; }
  if out="$(RELEASE_TAG=v1.2.3 GITHUB_REPOSITORY=o/r DIST_DIR="$dist" check_draft_assets 2>&1)"; then
    echo "selftest: failed asset query admitted the upload" >&2; exit 1
  fi
  printf '%s' "$out" | grep -Fq 'could not list the assets' ||
    { echo "selftest: failed asset query stopped for the wrong reason: $out" >&2; exit 1; }
  # shellcheck disable=SC2317
  gh() { printf 'hay-v1.2.3-x.tar.gz\nhand-uploaded.tar.gz\n'; }
  if out="$(RELEASE_TAG=v1.2.3 GITHUB_REPOSITORY=o/r DIST_DIR="$dist" check_draft_assets 2>&1)"; then
    echo "selftest: foreign draft asset admitted" >&2; exit 1
  fi
  printf '%s' "$out" | grep -Fq 'hand-uploaded.tar.gz' ||
    { echo "selftest: foreign asset not named: $out" >&2; exit 1; }
  # shellcheck disable=SC2317
  gh() { printf 'hay-v1.2.3-x.tar.gz\n'; }
  RELEASE_TAG=v1.2.3 GITHUB_REPOSITORY=o/r DIST_DIR="$dist" check_draft_assets >/dev/null ||
    { echo "selftest: draft holding only built assets rejected" >&2; exit 1; }
  # shellcheck disable=SC2317
  gh() { return 0; }
  RELEASE_TAG=v1.2.3 GITHUB_REPOSITORY=o/r DIST_DIR="$dist" check_draft_assets >/dev/null ||
    { echo "selftest: empty draft rejected" >&2; exit 1; }
  unset -f gh
  rm -r "$dist"

  # The retired path must stay present (GitHub can only keep a workflow disabled while its file
  # exists on the default branch) and inert: no trigger but manual dispatch, no permissions, and a
  # job that only refuses.
  local retired=.github/workflows/release.yml
  [ -f "$retired" ] ||
    { echo "selftest: $retired was deleted; historical tag-triggered copies can run again" >&2; exit 1; }
  if grep -Eq '^  (push|pull_request|pull_request_target|release|schedule|workflow_run|create):' "$retired" ||
    grep -Eq '^[[:space:]]+tags:' "$retired"; then
    echo "selftest: $retired regained an automatic trigger" >&2
    exit 1
  fi
  grep -Fxq 'permissions: {}' "$retired" ||
    { echo "selftest: $retired must grant no permissions" >&2; exit 1; }
  if grep -Eq 'uses:|cargo|gh release|attest' "$retired"; then
    echo "selftest: $retired does real work again" >&2
    exit 1
  fi

  # Workflow wiring is part of the security boundary. A tag trigger loads policy from the tag's
  # own commit, so its absence is a negative security invariant, not a style preference.
  grep -Eq '^  workflow_dispatch:$' "$workflow" ||
    { echo "selftest: release is not manually dispatched" >&2; exit 1; }
  if grep -Eq '^  push:|^[[:space:]]+tags:' "$workflow"; then
    echo "selftest: tag-triggered release reintroduced" >&2
    exit 1
  fi
  awk '/^defaults:$/ { d = 1; next } d && /^  run:$/ { r = 1; next } r && /^    shell: bash$/ { ok = 1 }
       /^[a-z]/ && !/^defaults:$/ { d = 0; r = 0 } END { exit !ok }' "$workflow" ||
    { echo "selftest: workflow-wide bash default missing; \"\$VAR\" is empty under PowerShell" >&2; exit 1; }
  grep -Eq '^  verify-release:$' "$workflow" ||
    { echo "selftest: verify-release job missing" >&2; exit 1; }
  grep -Fq 'needs: verify-release' "$workflow" ||
    { echo "selftest: build does not depend on the release policy" >&2; exit 1; }
  grep -Fq './release-policy.sh verify' "$workflow" ||
    { echo "selftest: workflow does not invoke verifier" >&2; exit 1; }
  grep -Fq './release-policy.sh check-tag' "$workflow" ||
    { echo "selftest: draft does not re-check the tag before publishing assets" >&2; exit 1; }
  grep -Fq './release-policy.sh check-draft-assets' "$workflow" ||
    { echo "selftest: draft refresh no longer refuses foreign assets" >&2; exit 1; }
  [ "$(grep -c -- '--prerelease' "$workflow")" -ge 2 ] ||
    { echo "selftest: beta drafts are not marked prerelease on both create and refresh" >&2; exit 1; }
  grep -Fq -- '--json isDraft -q .isDraft' "$workflow" ||
    { echo "selftest: published release overwrite guard missing" >&2; exit 1; }
  grep -Fq "release tag \$tag does not match hay package version \$package_version" "$0" ||
    { echo "selftest: release tag is not bound to the package version" >&2; exit 1; }
  # shellcheck disable=SC2016  # the workflow must contain this literal runtime variable
  grep -Fq -- '--source-ref refs/heads/main --source-digest "$SOURCE_SHA"' "$workflow" ||
    { echo "selftest: pre-draft provenance policy is incomplete" >&2; exit 1; }
  # Exactly one job may write repository contents, and it must be the environment-gated draft job,
  # which builds nothing: it runs only this policy script from the verified commit. Top-level
  # permissions stay read-only.
  local writes write_job
  writes="$(grep -c 'contents: write' "$workflow" || true)"
  [ "$writes" = 1 ] ||
    { echo "selftest: expected exactly one contents: write grant, found $writes" >&2; exit 1; }
  write_job="$(awk '/^  [a-z-]+:$/ { job = $1 } /contents: write/ { print job }' "$workflow")"
  [ "$write_job" = "draft-release:" ] ||
    { echo "selftest: contents: write granted outside draft-release ($write_job)" >&2; exit 1; }
  awk '/^  draft-release:$/ { in_job = 1; next } /^  [a-z-]+:$/ { in_job = 0 }
       in_job && /environment: release$/ { found = 1 } END { exit !found }' "$workflow" ||
    { echo "selftest: draft-release is not gated by the release environment" >&2; exit 1; }
  echo "release-policy selftest ok"
}

case "${1:-}" in
  verify) verify_release ;;
  check-tag) check_tag ;;
  check-draft-assets) check_draft_assets ;;
  --selftest) selftest ;;
  *) echo "usage: $0 verify | check-tag | check-draft-assets | --selftest" >&2; exit 2 ;;
esac
