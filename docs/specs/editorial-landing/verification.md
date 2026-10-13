# Independent website acceptance

2026-10-13. Artifact: clean commit `4d02c7ae38292b6ab2413a7c674176f9ab8cf9ef`, served
locally from its explicit public bundle. This verdict does not prove a live deployment.

Verdict: PASS
Builder: GPT-6.1 Sol / Codex implementation tools / main builder context
Verifier: GPT-6 Astra / isolated agent-browser, HTTP, public output hashing / fresh source-blind context
Different model required: yes
Different model used: yes

Criterion 1 — Responsive layout, enlargement, keyboard access: PASS — Rendered and visually
inspected 320/390/768/1440 widths; document scroll width equaled viewport width, with no
overflowing actions, commands or table. CSS 200% enlargement and 320-CSS-pixel reflow passed.
Visible skip-link focus had a 2px outline; activation skipped navigation, with the next Tab
reaching Install hay. Mobile keyboard traversal reached page actions and footer with visible
focus after scrolling settled; headers/navigation were static.

Criterion 2 — Installation distinction and copy behavior: PASS — UI identifies supported
Homebrew 0.3.2 separately from source 0.4.0. Both buttons delegated to the original native
`navigator.clipboard.writeText`; captured arguments after successful resolution exactly
matched displayed commands. Synthetic `NotAllowedError` produced “Copy failed. Select the
command above and copy it manually.” in polite live status regions. Selecting each displayed
command still returned its complete text.

Criterion 3 — Pinned source installation and feature availability: PASS — Displayed source
installation checks out `4d02c7ae38292b6ab2413a7c674176f9ab8cf9ef` and uses
`cargo install --locked --path hay`. “Available in source 0.4.0.” appears immediately beside
the first filename and MCP examples.

Criterion 4 — Honest scope, illustrative results and historical evidence: PASS — Both rendered
lists contain the same six complete matches from four distinct files; hay's first four results
cover those four files. The synthetic-fixture disclaimer is visible. Public evidence explicitly
identifies hay 0.3.0 and 2026-08-28. Private gate explicitly fails at median-repository MRR
0.4328/0.50 and top-ten 77.21%/80%, dated 2026-09-23, and says it was not rerun. No new latency,
conversion or private-confirmation claim appeared.

Criterion 5 — Links, progressive enhancement and media: PASS — Manual, benchmark and method
pages returned and rendered meaningful content; GitHub and pinned fixture links returned
HTTP 200. Blocking `**/*.js` prevented the landing page's sole script from loading; all content,
commands and navigation remained available while copy buttons stayed hidden. Film began paused
without autoplay; clicking its native play control advanced playback, with duration 18 seconds,
1920×1080 video and no media error. Observed landing resources were same-origin, including its
font; no third-party runtime font or analytics request appeared.

Criterion 6 — Explicit public bundle, identity, integrity and exclusions: PASS — Independently
enumerated exactly 13 payload files plus `release.json`. Source, version, phase and tag matched
the frozen candidate. Python `hashlib` and two independent HTTP reads per payload confirmed
every file's digest and byte identity. Independently recomputed the aggregate from actual file
hashes using the pathname/NUL/hash/LF contract:
`0af410a44bcc11a56f20b00f89d86cbf18b33b20770901cd21a62073426059be`, matching the manifest.
HTTP probes for `corpus/`, `corpus/queries.json`, `.git/config`, `.scratch/`, `site/build.ts`,
`package.json` and `hay/src/main.rs` all returned 404.

Remaining uncertainty: Acceptance covers the local served candidate, not a deployed destination.
Enlargement used CSS zoom and equivalent reflow, not native browser zoom. Clipboard verification
proves successful native writes of exact public commands, not OS paste/readback. Source behavior
and packaging refusal/determinism/symlink controls were outside this source-blind check. Those
separate ordinary test controls are recorded in evidence.md; they are not this verifier's claims.
The isolated browser session was closed.
