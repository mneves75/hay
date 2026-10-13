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
the distinct model dispatch. Final served-beta verification is required before delivery.

The failed historical private retrieval gate remains dated and was not rerun. A CI build,
local preview or exported MP4 alone does not prove public deployment. Production's old media
and seven incumbent files remain the preservation baseline until exact-candidate promotion.
