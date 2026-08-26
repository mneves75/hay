# Benchmark film source

Remotion composition for `assets/hay-benchmark.mp4` on the GitHub Pages branch. The video build
tooling stays separate from the measurement tooling.

The composition imports `../../evidence/benchmark.json` at build time and derives the usable
corpora plus the `hay`/`rg` MRR bars from that evidence. Rendering fails if the evidence no
longer supports the on-screen claim that hay ranks first on every usable corpus.

The film contains no hand-copied scores. Refresh the benchmark evidence and re-render the film
together whenever a release publishes new public benchmark results.

```bash
cd site/video-src
pnpm install --frozen-lockfile
pnpm render
```

Copy `out/hay-benchmark.mp4` to the Pages branch's `assets/` directory.
