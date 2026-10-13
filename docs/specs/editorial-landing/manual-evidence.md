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

## Delivery status

Beta3 publication and its revised exact production approval packet are pending. The earlier
beta2 production bundle is superseded. No production tag or promotion is authorized by this
local verification record.
