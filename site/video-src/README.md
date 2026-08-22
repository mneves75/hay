# Benchmark film source

Remotion composition for `assets/hay-benchmark.mp4` on the GitHub Pages branch. This build tooling
stays separate from the dependency-free measurement kit.

The figures come from `evidence/benchmark.json`. The recorded run used `hay` 0.6.0; release 0.7.0
changed no ranking behavior. Refresh the figures after any benchmark run.

```bash
cd site/video-src
pnpm install --frozen-lockfile
pnpm render
```

Copy `out/hay-benchmark.mp4` to the Pages branch's `assets/` directory.
