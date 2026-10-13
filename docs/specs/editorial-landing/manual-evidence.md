# Editorial manual verification

2026-10-13. The owner approved beta2 and identified `beta/MANUAL.html` as missed.
The [frozen correction brief](manual.md) preserves its content and behavior while applying the
approved Archivo/white/charcoal/green design. The approved landing styles, script and 36-second
film are unchanged. Source 0.4.0 and supported Homebrew 0.3.2 remain distinct.

## Review and reproduced fixes

Fresh read-only code-review Standards and Spec axes found incremental search text fragmentation,
unmarked command matches, and missing persistent copy feedback/pending state. Browser probes
failed before correction, then passed: `d` followed by `de` marks the contiguous word,
`sesison` marks its command occurrence, and delayed copying disables/fades the action without
duplicate writes. Clipboard failure leaves selectable text and persistent recovery guidance.
The original suffix-highlighting defect was also reproduced in live beta2 before replacement.

The Spec correction review found no remaining issue in the reviewed changes. The Standards
follow-up could not run because model capacity was unavailable; it is not a second PASS.
Independent actual-interface acceptance below exercised both search and copy corrections.

## Builder checks actually run

- Bun 1.4.0: `bun test site/build.test.ts`, 16 PASS; new packaging tests failed first.
- `bun run typecheck`, `bun run lint:ast-grep`, `bun run test:ast-grep`: exit 0; all three
  AST rule tests passed. The known AST postinstall fallback warning remains disclosed.
- `bash site/check-demo.sh`: exit 0, six matches across four files, complete match set retained.
- Real browser assertions reproduced search/copy failures before their fixes and passed after.
- Advisory `cccc 1.8.0 --no-cache --min 0` analyzed all three requested source files
  (`site/manual.js`, `site/build.ts`, `site/build.test.ts`), exit 0, 55 functions, zero parse
  errors. Existing configuration discovery/exclusions were retained; no repository cccc.toml
  was present. Highest cognitive complexity was 48 in the existing builder and 28 in the
  extracted search handler. These are advisory measures, not acceptance thresholds.
- A clean local beta3 bundle from `4720039ff70461ddcce5ea72c00cf1d9c04f725d` contains 15
  allowlisted payload files plus `release.json`; aggregate SHA-256
  `3f072d872b7d89e2d98793be43b68e437161ee976114b207e3bdbf23e2cd8da6`.

## Visual review

The single Impeccable detector pass reported four static details-wrapper padding warnings;
rendered summaries have 18px padding. Its em-dash count includes literal CLI double-hyphen flags.
Manual typography roles are intentionally recorded in DESIGN.md and the design sidecar.
Detector exit 2 is advisory evidence, not a clean scan.

Native full-page captures were malformed despite a single DOM document. Replacement complete
captures concatenate actual settled viewport screenshots at measured scroll positions, trimming
only overlap; first-viewport captures remain separate. Smooth scrolling was temporarily disabled
in the QA browser and restored afterward. No production styling or content was changed to capture.
The required full fresh finish review returned `disposition: ship`, with no material fixes.
Persistence, editorial fidelity, responsive adaptation and the reference-reading quality bar
passed. It examined complete/first-view captures and sampled HTML/shared CSS, the script,
product/direction/spec/design documents and the single detector result. No raster comp was
claimed or required by the confirmed code-led path.

## Independent local acceptance

Verdict: PASS — all seven frozen criteria, after one correction and a fresh full reverify.
Builder: GPT-6 / repository editing tools / main context.
Verifier: GPT-6 Astra / isolated browser, rendered DOM, HTTP, SHA-256 and ffprobe /
independent source-blind context. Different model required: yes; used: yes.

1. Actual 320/390/1440 renders and 200% enlargement: no document overflow; editorial typography,
   Home navigation, desktop contents rail and mobile stacking present.
2. All 13 anchors, 22 flags and 18 examples remain. Native disclosure and skip-to-main keyboard
   focus passed.
3. `json` has 17 highlights with unchanged section text; incremental `d`/`de`, command `sesison`,
   no results, Escape, slash focus and reset-before-contents-navigation passed.
4. Native write resolved with the exact displayed command; no clipboard reading. Persistent
   polite success, disabled/faded pending state, overlap prevention and denied-copy recovery passed.
5. Blocking scripts before navigation retains all content, labels, navigation and disclosures;
   optional search/copy controls are hidden. No Cargo.toml request.
6. All 15 payload hashes and aggregate match; clean identity, canonical, adjacent versions and
   six refused source/private path probes passed.
7. Landing CSS/JS match live beta2. Movie digest remains
   `2e0bcae2385f02e24d2c729c65012cad944b75baf811cbe7af9592436961e84b`;
   36 seconds, 1080p, 30 fps, video only. Native playback decoded eight frames without error.

Remaining uncertainty: this verdict covers the local packaged candidate. Live beta3, publishing
identity, merged-source CI and production preservation still require actual destination checks.
Native browser zoom and OS clipboard paste/readback are unclaimed. No private evaluation rerun.

## Frozen delivery identity

PR #18 merged after all seven final-head CI jobs passed in run `38422192878`.
The checkout returned to `main`. Candidate source:
`268e41834a0a66d922102edc70a97f5ca82aca8e`; source 0.4.0, film package 1.1.0,
supported Homebrew 0.3.2. No Rust binary release is being cut.

The [beta3 manifest](beta3-manifest.json) contains 15 payloads plus `release.json`, aggregate
SHA-256 `5b1f0b3580ea826d3cda16fe0bb171fbe8e4dca8c23753ea156294782f1e686e`.
The publishing commit is `26691b03c77b258914640ee5bce865d53778f798`, changing only six
beta paths. All seven merged-source jobs passed in run `38422776238`, attempt 2: the queued
macOS job received one retry at the identical commit; the six successful jobs were retained.
The publishing commit is pushed and read back. All three Pages jobs passed in run `38424877666`.
Actual HTTP verification found the expected beta3 manifest, all 15 payload hashes and aggregate,
six source/private probes returning 404, and all seven production files unchanged. The clean
publishing worktree was then removed/pruned. Lightweight `site-v0.4.0-beta3` is pushed and read
back at the frozen source; beta1/beta2 tags are unchanged. Actual manual:
https://mneves75.github.io/hay/beta/MANUAL.html.

## Independent served-destination acceptance

Verdict: PASS — all eight criteria. Builder: GPT-6 / repository editing/deployment tools /
main context. Verifier: GPT-6 Astra / isolated agent-browser, HTTP, SHA-256 and ffprobe /
independent source-blind context. Different model required: yes; used: yes.

1. Actual 320/390/1440 renders and 200% enlargement: no document overflow; Archivo/editorial
   colors, Home, desktop rail and mobile contents present. Retained actual
   [desktop](captures/manual/desktop.png) and [mobile](captures/manual/mobile.png) first views.
2. All 13 anchors, 22 flags and 18 examples remain. Native Enter disclosure and Tab/Enter
   skip-to-main focus passed.
3. `json` produced 17 marks; incremental `d`/`de` and command `sesison` matches are correct.
   Section/command text is unchanged. No results, slash, Escape and contents reset passed.
4. Native write resolved with exactly `brew install mneves75/tap/hay`; no clipboard reads.
   Adjacent polite status and unchanged label passed. Delayed write disabled/faded the button
   at opacity 0.65; repeated activation produced one write. Completion restored availability.
   Both denied APIs produced manual-selection guidance, still present after 2.2 seconds.
5. A separate fresh browser blocked scripts before its first navigation. All content, versions,
   links and native disclosures worked; optional controls were hidden. Network evidence confirmed
   the script was blocked and no Cargo request occurred. An inconclusive cached probe was discarded.
6. All 15 HTTP payloads returned 200 and matched their hashes; actual aggregate and clean
   source/tag/phase identity match the beta3 manifest. Canonical/version labels and six 404 probes passed.
7. Landing styles/script and approved film match their frozen digests. Remote ffprobe confirmed
   36 seconds, 1080p, 30 fps, video only; native playback decoded eight frames without error.
8. All seven production URLs returned 200 with identical incumbent hashes. Actual root render
   remains cream/ochre with IBM Plex Serif headings.

Remaining uncertainty: this proves the served URLs at verification time, not future deployments
or every browser engine. Native browser zoom, OS clipboard paste/readback and a new private
evaluation are unclaimed. Both verifier browser sessions are closed.

## Revised production approval packet

Repository: `mneves75/hay`. Candidate: `268e41834a0a66d922102edc70a97f5ca82aca8e`.
Website version/tag: `site-v0.4.0`. Production target: https://mneves75.github.io/hay/.
The [prepared production manifest](manual-production-manifest.json) has aggregate SHA-256
`b31b1179405564961c8c097b96df4fb288f905042a88f285130dbb5902cbbb7f`.
Actual bundle comparison found identical non-HTML assets/docs; only index/manual phase label,
tag, canonical/robots metadata and `release.json` differ from beta3. No production tag or
promotion has occurred. The earlier beta2 production packet is superseded.

Staging evidence: local source-blind acceptance 7/7, Impeccable `ship`, all seven merged-source
CI jobs and all three Pages jobs passed. Actual beta3 passed all eight independent served-interface
criteria above, including 15 payload hashes and all seven preserved production files.
The packet is ready for the user's exact-candidate production approval.

Material limits: Pages publishing is shared; beta is public, not access-controlled. Supported
Homebrew remains 0.3.2. The private retrieval gate remains FAIL as measured on 2026-09-23:
median-repository MRR 0.4328/0.50 and top-ten 77.21%/80%; it was not rerun. Native zoom and OS
clipboard paste/readback are unclaimed. These website changes assert no new ranking or speed gain.

Before promotion, recheck that Pages HEAD is the verified publishing commit; refuse concurrent
unowned changes. Rollback uses a new scoped publishing commit restoring the seven incumbent
root files from `3f891197d8642313034f73c09ed22adea4f64a1f`; retain beta and legacy media URLs,
then verify the restored hashes and root UI. Never reset or force-push publishing history.
Exact-candidate production approval remains the protected next action after staging passes.

## Cleanup

The merged task branch was deleted locally/remotely; the pushed publishing worktree was removed
and pruned. Four identified task-owned preview servers and the isolated QA browser sessions
were closed. No pre-existing Codemap process was stopped.

Approximately 28 MB of logical temporary previews, capture intermediates and superseded beta2
bundles were removed: about 13 MB moved recoverably to Trash, and about 15 MB of uncited manual
QA scratch deleted with `scratch clean`. The actual served desktop/mobile captures are retained
in the tracked record. `.scratch/manual-redo` no longer exists. Empty cited test-fixture parents
remain; pre-existing pinned tooling, root dependencies, Rust build output and shared caches
were preserved.

The complete 2 MB production bundle remains at `.scratch/production-site-v0.4.0-268e418` for the
pending approval. Its manifest, all 15 payload hashes and aggregate were rechecked after moving;
it matches the tracked production manifest exactly. Nothing bulky was produced by this correction.
