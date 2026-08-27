# Benchmark film source

Remotion composition for `assets/hay-benchmark.mp4` on the GitHub Pages branch. The video build
tooling stays separate from the measurement tooling.

The composition imports `../../evidence/benchmark.json` and `../../evidence/docs-track.json` at
build time. It derives the usable `hay`/deterministic-`rg` bars and the documentation
counter-result from those files. Rendering fails if the evidence no longer supports the
four-corpus layout, stable-order comparison, or documentation summary.

The film contains no hand-copied scores, narration, or soundtrack. Renders pass `--muted` so the
MP4 does not carry a phantom silent audio track. Its install command defaults to the stable
evidence version; a beta render must pass a matching beta ref so the shown command resolves before
the stable tag exists. Refresh both evidence files and re-render the film together whenever a
release publishes new public benchmark results.

```bash
cd site/video-src
pnpm install --frozen-lockfile
pnpm render

# Staging example
pnpm exec remotion render HayBenchmark out/hay-benchmark.mp4 --props='{"releaseRef":"v0.1.4-beta1"}' --muted
```

Copy `out/hay-benchmark.mp4` to the Pages branch's `assets/` directory.
