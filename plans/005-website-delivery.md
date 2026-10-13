# Verified website staging and production

Completed 2026-10-13: beta3 and the approved production website serve frozen source
`268e41834a0a66d922102edc70a97f5ca82aca8e`. Source/Pages CI and independent live acceptance
passed; the final website tag is `site-v0.4.0`. See the
[production record](../docs/specs/editorial-landing/production-evidence.md). The plan below
is retained as the implementation and release contract.

Base: `13cb6c5`; depends on plan 004. Existing target: https://mneves75.github.io/hay/.
Publishing source is gh-pages `/`, legacy GitHub Pages. The owner's current task requests
working-branch delivery, merge, staging, version tags, production deployment and task cleanup.
The selected deployment skill's exact-candidate approval boundary is checked after preparing
the concrete staging evidence; any required confirmation is that final packet, not another
generic planning permission.

## Scope and identity

The deployment is the website. Cargo.toml's source version 0.4.0 is the version source;
use distinct website tags `site-v0.4.0-beta1` and `site-v0.4.0`. This avoids claiming a published
Rust binary or an updated Homebrew formula. Supported Homebrew 0.3.2 and source 0.4.0 remain
explicit in the page. The protected binary-release workflow is not invoked by website tags.

## Implementation and gates

1. Merge existing PR #16 only after final independent acceptance and complete branch CI.
   Merge is authorized; main does not publish this site automatically. Return to main and
   require push CI for the immutable source commit.
2. Freeze that commit and build two allowlisted bundles with identical UI/assets except the
   tested phase label, website tag, robots/canonical preview metadata and release.json. Use
   relative local links so beta targets the frozen beta manual. Record file digests. Never build releases from dirty
   working files, include private corpus, or recursively copy the repository.
3. Inspect worktrees, fetch gh-pages, and use one temporary worktree under task scratch.
   This is a public beta preview on shared publishing infrastructure, not isolation. Capture
   hashes for all seven incumbent files (including media). Require the deployment diff to change
   only beta/**, with no root/config changes, and verify all incumbent bytes/links after publish.
   Deploy `/hay/beta/` with noindex and a visible preview label; it remains publicly accessible.
4. Wait for the Pages build, then prove the live beta manifest/source identity and exact file
   hashes, positive homepage/manual/media responses, expected refusal of a missing asset, and
   actual desktop/mobile interaction. Tag the verified main commit with the next beta count.
5. Prepare the concrete production packet: source commit, website version/tag, destination,
   staging evidence, caveats and rollback to the saved gh-pages production files. Follow the
   selected mneves-ship-deploy approval boundary before changing the production root.
6. Refuse promotion if gh-pages advanced since preparation; refresh the scoped patch and repeat
   preservation checks rather than overwrite concurrent publication. Promote the frozen
   production bundle, preserve existing legacy media/doc URLs, wait for
   Pages and repeat live identity/hash/browser proof. Create the clean website tag only after
   actual destination proof. Record deployment SHA separately from source SHA.
7. Update release evidence/status docs with observed results, commit/push those records and
   verify CI. Keep main visible. Remove the merged feature branch and all task worktrees,
   owned scratch and browser/server processes. Do not delete gh-pages or unrelated artifacts.

## Done / stop

Staging and production are distinct gates; a build receipt, local preview, HTTP 200 or tag alone
does not prove a deployment. Report PASS/FAIL/BLOCKED independently. Never force-push, move a
tag, weaken release/audit policy, silently overwrite concurrent changes, or treat absent private
confirmation as success. Stop only at the named production approval or a real access/gate blocker.
