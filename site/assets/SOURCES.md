# Landing assets

- Archivo variable Latin WOFF2: Google's official font CDN, delivered from the CSS2 Archivo
  400–900 request. SIL Open Font License 1.1 is included as OFL.txt, from google/fonts commit
  `66928797f271fed5ee428544e7229685e2d90127`, ofl/archivo/OFL.txt. Archivo Project Authors,
  https://github.com/Omnibus-Type/Archivo. Font SHA-256:
  `664cbb7bf80f6527022d4c76291f6df77dad3534c50d8862405d50040fd1ff5d`.
- Editorial overview film: rendered locally from `site/video-src` with Remotion 4.0.515.
  The five-scene storyboard is in `docs/specs/editorial-landing/film.md`: 36 seconds,
  1920×1080, 30 fps, H.264, no audio. The six public fixture results and dated public
  benchmark values come from the same checked-in inputs as the page. This is a new film,
  not a new benchmark run or a binary release.
- Film SHA-256: `2e0bcae2385f02e24d2c729c65012cad944b75baf811cbe7af9592436961e84b`.
  Poster: frame 45 (1.5 seconds), with origin embedded as PNG text metadata. Poster SHA-256:
  `2bf479deab5dae73f380c6a86bcdca6cecfce4d8569542685cd16e340db709d4`.
  No generated illustration is used; the poster is an actual exported film frame.

Fonts are served from this site. There is no runtime request to Google Fonts.

## Public manifest contract

`release.json` identifies the frozen source commit/version, phase, website tag and dirty state.
Its `files` map contains lowercase SHA-256 digests of the delivered bytes. The manifest itself
is excluded. To recompute `payload_sha256`, sort path entries using `localeCompare("en")`;
concatenate each UTF-8 path, one NUL byte, its lowercase hexadecimal digest and one LF byte.
SHA-256 that concatenation and encode the result as lowercase hexadecimal. Per-file hashes
must be checked against actual bytes before trusting the aggregate.
