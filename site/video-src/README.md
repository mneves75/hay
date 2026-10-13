# hay editorial film

Editable Remotion source for the website's silent 36-second overview. The composition ID
remains `HayBenchmark`. The five scenes have standalone Studio timelines.

`scripts/prepare.mjs` derives the exact real-binary illustrative outputs, historical public
benchmark rows/date/version, source/Homebrew availability and palette from known public inputs.
It copies the already licensed self-hosted Archivo font into generated `public/`. No transcript,
private corpus, narration, soundtrack or runtime font service is used.

```bash
cd site/video-src
pnpm install --frozen-lockfile
pnpm test
pnpm dev --no-open --port 8460
pnpm lint
pnpm build
pnpm audit --audit-level high
pnpm render
```

Preparation runs before Studio, lint, bundle and render; generated public files are ignored.
Edit scene source, not generated data. Animation depends only on frames; exact scores stay
visible rather than counting through invented intermediate values. `--muted` avoids a silent
audio track. Inspect the MP4 and poster before replacing `../assets/hay-benchmark.mp4` and
`../assets/poster.png`, then verify the website bundle and actual beta playback.

The full storyboard and release constraints live in
[film.md](../../docs/specs/editorial-landing/film.md). Historical benchmark data is not a new
measurement of source 0.4.0, and the private behavioral gate remains failed.
