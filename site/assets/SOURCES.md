# Landing assets

- Archivo variable Latin WOFF2: Google's official font CDN, delivered from the CSS2 Archivo
  400–900 request. SIL Open Font License 1.1 is included as OFL.txt, from google/fonts commit
  `66928797f271fed5ee428544e7229685e2d90127`, ofl/archivo/OFL.txt. Archivo Project Authors,
  https://github.com/Omnibus-Type/Archivo. Font SHA-256:
  `664cbb7bf80f6527022d4c76291f6df77dad3534c50d8862405d50040fd1ff5d`.
- Benchmark film and poster: existing hay public media, from gh-pages commit
  `3f891197d8642313034f73c09ed22adea4f64a1f`, assets/hay-benchmark.mp4 and assets/poster.png.
  The Remotion source remains in site/video-src. Historical figures are identified as such in
  the landing page; this is not a new benchmark run or a new video render.
- Film SHA-256: `5005c8fbe200c8c135fc0120443b76ee9ddfb6314430e1c638e5286e229aa8b3`.
  Original poster SHA-256: `e0cf3cc1d5bc821ab227879c29068a568a91914e9649760308a5911109e5ff87`.
  Raster provenance metadata may change the poster's file digest; payload manifests record the
  delivered digest. No generated illustration is used.

Fonts are served from this site. There is no runtime request to Google Fonts.

## Public manifest contract

`release.json` identifies the frozen source commit/version, phase, website tag and dirty state.
Its `files` map contains lowercase SHA-256 digests of the delivered bytes. The manifest itself
is excluded. To recompute `payload_sha256`, sort path entries using `localeCompare("en")`;
concatenate each UTF-8 path, one NUL byte, its lowercase hexadecimal digest and one LF byte.
SHA-256 that concatenation and encode the result as lowercase hexadecimal. Per-file hashes
must be checked against actual bytes before trusting the aggregate.
