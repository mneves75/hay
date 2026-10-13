# Editorial website production delivery

2026-10-13. The owner explicitly approved the exact [manual production packet](manual-evidence.md)
with “yes to all; deploy to prod”. This promotion uses that immutable candidate, without source,
dependency, film or ranking changes. It is a website release, not a Rust binary release.

## Identity and destination

- Repository: `mneves75/hay`; frozen source `268e41834a0a66d922102edc70a97f5ca82aca8e`.
- Website tag: `site-v0.4.0`, lightweight, created after live proof. Beta3 remains unchanged at
  `site-v0.4.0-beta3`; beta1/beta2 tags were not moved.
- Source version 0.4.0; private film package 1.1.0; supported Homebrew binary 0.3.2.
- Production: https://mneves75.github.io/hay/ and https://mneves75.github.io/hay/MANUAL.html.
- Publishing commit: `f66afdf6b4b09e8e242c63c7c2be517b678a2391`; previous Pages head
  `26691b03c77b258914640ee5bce865d53778f798`.
- [Approved production manifest](manual-production-manifest.json), also served as root
  `release.json`: 15 payload files, aggregate SHA-256
  `b31b1179405564961c8c097b96df4fb288f905042a88f285130dbb5902cbbb7f`.
- [Pages build/deploy/status](https://github.com/mneves75/hay/actions/runs/38453128411): all three
  jobs PASS; completed 2026-10-13 19:16:40 UTC.

Before promotion, staging's actual manifest and all 15 payload hashes matched beta3. The
prepared production bundle matched all approved hashes, had no symlinks or undeclared files,
and pointed to the same source. Both source CI runs (`38422776238`, `38426890581`) were green.
Pages configuration was read back as `gh-pages`, path `/`, HTTPS enforced. No application
secrets, bindings, databases or migrations are involved in this static Pages target.

The publishing diff contains exactly 14 approved root paths: three changed documents and
eleven added manifest/assets. Every beta3 byte and both legacy media files stayed unchanged.
The non-force push was gated on the unchanged publishing head, rechecked immediately before it.
An early manifest probe during the running deployment returned 404; after Pages completed,
the ordinary public URL and every payload passed. No tag was created on that early probe.

## Release tooling and scope

The generic release-contract checker printed `FAIL entry.release` and `FAIL entry.verify-live`
because this repository has no `scripts/release.sh` or `scripts/verify-live.sh`. Its generic
served-commit heuristic also missed the site's manifest identity. These are not recorded as
passing automation conformance. The documented allowlisted packager, scoped Pages publishing,
actual HTTP identity/hash/refusal controls and independent browser acceptance provide the
capability-based release route. No new release framework or dependency was introduced.

The source candidate's reviews, reproduced fixes, 16 packaging tests, typecheck/AST gates,
real-binary illustration and CI are recorded in [manual-evidence.md](manual-evidence.md).
This deployment did not repeat source reviews or change the approved bytes.

## Independent actual-production acceptance

Verdict: PASS — all eight frozen promotion criteria.
Builder: GPT-6 / editing and deployment tools / main context.
Verifier: fresh source-blind context, isolated agent-browser, HTTP, SHA-256, ffprobe and ffmpeg.
Different model required: yes. Different model selected: yes — the accepted native dispatch explicitly used
`model: gpt-6-astra` and `fork_turns: none`, task `/root/prod_live_verify`.
No provider runtime identity telemetry is exposed. The verifier's initial generic Sol
self-label was unsupported and retracted; the model-selection evidence is the dispatch record,
not that self-description.

1. **Identity and integrity: PASS.** All 15 production payloads returned 200 with exact hashes.
   Independently recomputed aggregate matches the approved value. Production/source/tag/clean
   metadata, both canonical URLs and `index, follow` are correct. Six source/private probes 404.
2. **Actual rendering: PASS.** Both pages inspected at 320/390/1440 and CSS enlargement
   (`zoom: 2`), without document horizontal overflow. Archivo/white/charcoal/green, desktop
   manual rail and mobile contents are present. Home click reaches `/hay/index.html`.
   Retained actual first views: [landing desktop](captures/production/landing-desktop.png),
   [landing mobile](captures/production/landing-mobile.png),
   [manual desktop](captures/production/manual-desktop.png),
   [manual mobile](captures/production/manual-mobile.png).
3. **Manual interactions: PASS.** 13 anchors, 22 flags, 18 examples; native disclosure and
   visible keyboard skip-to-main. `json` has 17 highlights; `d`/`de` and `sesison` mark actual
   matches without changing section/command text. No results, slash, Escape and contents reset work.
4. **Clipboard: PASS.** Native writes resolve with exact displayed commands; no clipboard reads.
   Persistent adjacent polite feedback and denied-API recovery work on both pages. Delayed manual
   copying disables/fades at 0.65, accepts one write despite repeated activation, then restores.
5. **Scripts unavailable: PASS.** Separate fresh browser blocks scripts before first navigation.
   Both pages retain content, versions, commands, links and native controls. Optional inert
   controls are hidden; no Cargo request was captured.
6. **Claims and installation: PASS.** Complete synthetic six-match/four-file illustration,
   source 0.4.0 versus Homebrew 0.3.2, pinned source installation and source-only find/MCP labels.
   Historical public evidence is dated 2026-08-28; private FAIL is dated 2026-09-23 and not rerun.
   No new speed claim appeared.
7. **Media: PASS.** Approved movie/poster hashes match. Actual native control playback advances
   without error or autoplay. ffprobe confirms 36 seconds, 1080p, 30 fps, video only; full ffmpeg
   decode exits 0. The complete accessible text alternative remains available.
8. **Preservation and destinations: PASS.** All 15 beta payloads plus manifest match beta3,
   including its independently recomputed aggregate. Both legacy media hashes match the
   incumbent baseline; manual, benchmark and method pages load useful content.

Remaining limits: CSS enlargement is not native browser zoom. OS clipboard paste/readback,
every browser engine, future deployments and a new private evaluation are unclaimed.
Both verifier browser sessions were closed. A script-only play probe was refused by the
browser's user-activation policy; actual native control playback supplied the passing proof.

## Recovery

Do not reset or force-push. If rollback is needed, start at the then-current Pages head and
make a new scoped commit: restore the seven incumbent root files from
`3f891197d8642313034f73c09ed22adea4f64a1f`, remove only this promotion's eleven newly added
root paths (root `release.json` and the ten declared files under root `site/`), and retain
`beta/` plus legacy URLs. This removes the new manifest rather than leaving it to describe
restored old bytes. Recheck the publishing head, push normally, wait for Pages, verify all
restored root hashes, unchanged beta bytes and actual root rendering. Source/publishing
identities remain separate. The historical private retrieval gate remains FAIL, not waived
or recalculated by this website release.

## Closeout

The final lightweight website tag is pushed and read back at the source production serves;
beta3 remains at the same source. The publishing worktree was removed/pruned. Both verifier
browsers were closed, and its two accidental default screenshots were moved to Trash.
Four actual production first views (365,064 bytes total) are retained with this record.

The task-owned prepared production duplicate (about 2 MB) and uncited QA scratch (about
664 KB) were removed with `scratch clean`; their manifests/captures are retained in tracked
records and the served site. No dependency installation, local Rust build, simulator or
dev server was needed. Pre-existing pinned tooling, dependencies, Rust build output, fixture
parents and shared caches were preserved. Main remains the visible branch; the final docs
are committed/pushed separately from the immutable deployed source.
