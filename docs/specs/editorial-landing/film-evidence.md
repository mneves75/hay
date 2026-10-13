# Editorial film verification

2026-10-13. The owner requested a new film before production. This revision replaces the
18-second chart animation with the frozen five-scene [storyboard](film.md). It does not
change the Rust version, ranking weights, measurement corpus or Homebrew release.

## Standards

Fresh read-only code-review axis: no hard documented-standard breach. The reviewer identified
duplicated scene durations as a maintainability heuristic. One shared scene list now supplies
both the full film and the five standalone Studio compositions; the total derives from their
sum. The bounded correction review found no remaining issue. CONTRIBUTING.md was checked.

## Spec

Fresh read-only code-review axis: malformed documentation rows could be silently omitted,
reducing the regression count. The actual preparation-entry-point regression failed first
(exit 1), then passed after validating query arrays before the sample-size exclusion. Missing
and non-array inputs now fail before public output is written. The bounded correction review
confirmed resolution and unchanged 4/12/7/8/5-second scene timing.

## Builder checks actually run

- Film: frozen pnpm install, five actual-entry-point tests, ESLint/TypeScript lint, bundle and
  high-severity audit: exit 0; audit found no known vulnerabilities. Local Node 26.10.0 satisfies
  the declared engine; CI remains pinned to Node 24.19.0. pnpm is 11.22.0, Remotion 4.0.515.
- Website: 15 packaging/text-alternative tests, root typecheck, AST scan and three AST rule
  tests: exit 0. Bun 1.4.0 was used. The new text-alternative regression failed before the
  page change and then passed. Known AST postinstall fallback warnings are not test failures.
- Real illustrative binary: `bash site/check-demo.sh`, exit 0; six matches, four files,
  both orders and exact match set verified.
- Export: full Remotion render before and after the timing correction. Both MP4 digests are
  identical: `2e0bcae2385f02e24d2c729c65012cad944b75baf811cbe7af9592436961e84b`.
  ffprobe: H.264, 1920×1080, 30 fps, 1,080 frames, 36.000 seconds, one video stream, no audio.
  Full ffmpeg decode: exit 0. Representative exported scene and transition frames were inspected.
- Poster: actual decoded frame 45 at 1.5 seconds, after the introductory translation settles;
  only origin metadata was embedded. Its digest is recorded in the public asset source file.

## Independent acceptance

The source-blind verifier uses a fresh GPT-6 Astra dispatch, distinct from the builder.
Its initial local run passed the format, playback, complete illustration, feature availability,
historical evidence, installation and public packaging checks. A poster comparison used frame
zero rather than the documented frame 45. That finding was disproved: independent decoding
of frame 45 matched all poster pixels exactly (SSIM 1.000000). The verifier also confirmed
the distinct model dispatch. The full, fresh served-beta reverify passed all eight criteria.

Verdict: PASS
Builder: GPT-6 / Remotion, ffmpeg, agent-browser / main builder context
Verifier: gpt-6-astra / ffprobe, ffmpeg, isolated agent-browser, independent HTTP/hash checks / fresh source-blind context
Different model required: yes
Different model used: yes

Criterion 1 — Complete silent MP4: PASS — Fresh live download: H.264, 1920×1080, 30 fps,
1,080 frames, 36.000 seconds, no audio. Full decode succeeds; all frames contain visible
variation. Opening, all scenes and final frame were independently inspected.

Criterion 2 — Preserved matches and working playback: PASS — Six complete matches, four
files; declaration fourth to first, first four settled results use distinct files. Native
playback advanced from 0 to 1.806527 seconds.

Criterion 3 — Qualified filename/MCP features: PASS — Film/page show source 0.4.0,
`hay --find sesison .`, manually started `hay --mcp --root .`, and all three tool names;
no persistent index/history or speed claim.

Criterion 4 — Historical evidence and limitations: PASS — Four rows, sample sizes, values
and intervals match; hay 0.3.0, 2026-08-28, definition-finding limitation, zero documentation
wins/four regressions and private gate failing/not rerun remain visible.

Criterion 5 — Installation and destination: PASS — Homebrew 0.3.2 remains distinct from
source 0.4.0; page pins the frozen source below with `--locked`. Film ends at the public site.

Criterion 6 — Presentation and accessibility: PASS — Live poster matches frame 45 exactly
(SSIM 1.000000). Desktop/mobile renders show Archivo and the editorial palette/safe margins.
No page overflow at 1440/390; native controls, no autoplay, keyboard disclosure and complete
alternative work with the page's JavaScript blocked. Prior poster finding is disproved.

Criterion 7 — Beta identity, integrity and containment: PASS — Live manifest identifies
the frozen source, staging, site-v0.4.0-beta2 and dirty=false. All 13 downloaded payload hashes
and aggregate match. Exactly those payloads plus manifest, no symlinks; source/private probes
return 404.

Criterion 8 — Production preserved: PASS — All seven live root files match the immutable
snapshot. The legacy root is cream/ochre/serif; the earlier description as dark was inaccurate.

Remaining uncertainty: Source validation is outside this source-blind acceptance; source
review and actual-entry-point tests confirmed that correction separately. Manifest provenance
was checked as published metadata, not independently reconstructed from source. Isolated
browsers were closed. Production promotion is still pending exact-candidate approval.

## Delivered identity

- Source: `43bfb48d9a015c12b6f754d16d8007a6beb4013a`; PR #17 merged, main restored.
- All seven final-head CI jobs passed in run `38399909365`; all seven merged-main jobs
  passed in run `38400365662`. Pages build/deploy/status passed in run `38400891461`.
- Publishing commit: `0d8b76bf0c3066a6dc8e3296ac3a6226c48ff569`, changing only beta paths.
- Beta: https://mneves75.github.io/hay/beta/; website tag `site-v0.4.0-beta2` points at source.
- [Public manifest](beta2-manifest.json), aggregate payload SHA-256:
  `2cba9d29e65cf826511a60409c52ea59d859c2bbaee7f3f6d7f1b3dcbc19d1ed`.
- Source 0.4.0, private film package 1.1.0, supported Homebrew 0.3.2. No Rust release cut.

## Revised production packet (superseded)

The owner approved beta2 but identified the manual's legacy presentation. The
[manual correction and new delivery record](manual-evidence.md) supersede this production
packet. Do not promote these prepared bytes or move beta2's immutable tag.

Repository `mneves75/hay`; candidate source as above; website tag `site-v0.4.0`;
target https://mneves75.github.io/hay/. Prepared clean production payload SHA-256:
`0bf5604ab7ed230e61bfc219114664b5e2e70c651190d56aedbfd36dacdb7477`.
Non-HTML assets and documents match beta2 exactly; only the phase label, tag, canonical/robots
metadata and release.json differ. No production tag, push or promotion has happened.

Risks: shared Pages publishing, public beta visibility, historical private retrieval gate
still failed and not rerun, supported binary still 0.3.2. Recheck publishing HEAD before any
promotion; refuse concurrent unowned changes. Roll back through a new scoped commit restoring
the seven root files from `3f891197d8642313034f73c09ed22adea4f64a1f`, retain beta and legacy URLs,
then verify restored hashes/UI. Never reset or force-push.

The failed historical private retrieval gate remains dated and was not rerun. A CI build,
local preview or exported MP4 alone does not prove public deployment. Production's old media
and seven incumbent files remain the preservation baseline until exact-candidate promotion.
