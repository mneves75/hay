# Editorial website beta delivery

The owner approved beta2 but identified the missed manual. The [manual correction](manual.md)
and [its verification record](manual-evidence.md) supersede beta2's prepared production packet.
The film remains unchanged. The beta1 and beta2 records below and their immutable tags remain
history; neither old production bundle may be promoted.

2026-10-13. Repository: mneves75/hay. PR #16 merged with a merge commit, then the working
checkout returned to clean `main`. Both local and remote feature branches were deleted.

## Identity and actual destination

- Frozen source: `f172e96d15a267ed0bc48f3b55ca3e1c5e48a1ee`.
- Source version: 0.4.0. Supported Homebrew binary: 0.3.2; no Rust binary release was published.
- Website beta tag: `site-v0.4.0-beta1`, lightweight, pushed and read back at the frozen source.
- Publishing commit: `07ba38f67091a05eeca951c8789d0426f32446c9` on `gh-pages`.
- Actual beta: https://mneves75.github.io/hay/beta/.
- [Frozen public manifest](beta-manifest.json), also served at beta/release.json. Payload hash:
  `8e923c3180dff5f7b24a2df20c18f712899b426ff5571295484f4958b7720006`.
- [All seven source/main CI jobs passed](https://github.com/mneves75/hay/actions/runs/38359499402).
  [Pages build, deploy and status jobs passed](https://github.com/mneves75/hay/actions/runs/38360164303).

The source/main CI runs the complete Rust contract suite on Linux/macOS/Windows, differential
parity, MSRV, Cargo audit, measurement/website gates and the audited film bundle. The beta
publish changed exactly 14 paths under beta/ and no root/config path. All seven incumbent files
were checked against their source bytes before deployment and against live HTTP afterward.
The unmodified generated benchmark report retains a pre-existing blank line with trailing
spaces; the artifact whitespace scan reports that line. All other beta paths pass the scan.

## Independent served-destination verdict

Verdict: PASS
Builder: GPT-6.1 Sol / Codex implementation and deployment tools / main builder context
Verifier: GPT-6 Astra / isolated agent-browser, live HTTP, independent SHA-256 calculations / source-blind context
Different model required: yes
Different model used: yes

Criterion 1 — Responsive layout, enlargement and keyboard access: PASS — Fresh live renders
at 320/390/768/1440 pixels showed no page overflow, clipped actions or unreadable evidence.
DOM overflow checks returned empty lists. CSS 200% enlargement and 320-CSS-pixel 400%-equivalent
reflow passed. Skip-link focus was visible; activating it moved subsequent keyboard navigation
to Install hay. All page actions through the footer remained visible after scrolling settled,
with no sticky navigation obstruction.

Criterion 2 — Installation distinction and copy behavior: PASS — Live UI distinguishes
Homebrew 0.3.2 from source 0.4.0. Both original native clipboard writes resolved successfully
with arguments exactly matching displayed commands. Synthetic denied writes announced
recovery through polite live status regions and preserved complete selectable commands.
No clipboard reads or paste probes occurred.

Criterion 3 — Pinned source and feature availability: PASS — Live source installation pins
the frozen source above and uses `cargo install --locked --path hay`. Both first `--find` and
`--mcp` examples have adjacent source-0.4.0 availability labels.

Criterion 4 — Honest scope and historical evidence: PASS — Independently compared both
rendered lists: six identical complete matches, four files, and four distinct files among
hay's first four results. Synthetic-fixture limitations remain explicit. Public results
identify hay 0.3.0 and 2026-08-28. Private gate remains visibly failed at 0.4328/0.50
median-repository MRR and 77.21%/80% top-ten, dated 2026-09-23, explicitly not rerun.
No new latency, conversion or private-confirmation claim appeared.

Criterion 5 — Reachability, progressive enhancement and media: PASS — Actual beta manual,
benchmark and method pages rendered useful content. GitHub and the new commit-pinned fixture
destination returned HTTP 200. A fresh empty-cache browser with JavaScript blocking installed
before navigation confirmed the landing script did not load: all content, commands and 20 links
remained available; copy buttons were hidden. Film began paused without autoplay and actually
played through its native control: time advanced to 3.498 seconds, duration 18 seconds,
resolution 1920×1080, no media error. Observed landing resources were same-origin, including
the font.

Criterion 6 — Served identity, payload integrity and exclusions: PASS — Verified the live beta
against its served manifest: correct frozen source/version/phase/tag, dirty false. All 13 declared
payload files matched their hashes and two separate HTTP reads. Recomputed aggregate from
actual bytes using the publicly served manifest contract, matching the expected hash above.
Private corpus, .git/config, .scratch/, build source, package metadata and Rust source probes
returned 404.

Criterion 7 — Incumbent production preserved: PASS — Independently fetched all seven production
URLs listed in the public incumbent snapshot; every SHA-256 matched. Browser inspection of
https://mneves75.github.io/hay/ confirmed the older dark v0.3.2 homepage.

Remaining uncertainty: Native browser zoom and OS clipboard paste/readback were not tested;
CSS enlargement, equivalent reflow and resolved native writes were tested. Source behavior
and packaging refusal controls remain outside this source-blind acceptance; ordinary controls
are recorded separately. Directory enumeration is unavailable over public HTTP; exclusion
evidence covers the specified probes. The isolated browser is closed.

## Prepared production packet (superseded)

The owner approved proceeding conditional on redoing the film first. The film revision below
supersedes this packet; never deploy these old prepared bytes or move beta1's tag. See
[the film storyboard](film.md) and [its verification record](film-evidence.md). A new beta count
and exact production payload must be prepared from the revised clean, CI-green source.

The production website tag would be `site-v0.4.0` at the same frozen source. Target:
https://mneves75.github.io/hay/. The prebuilt clean production payload hash is
`c274ae7e0f8e60c6a364f903738c636ef09c85af1f1a3f9b3851abc1621c2043`.
Actual bundle comparison confirms identical UI/assets/docs except declared phase label,
tag, robots/canonical metadata and release.json. No production tag or promotion has happened.

Production waits for exact-candidate approval required by mneves-ship-deploy. Risks: shared
Pages publishing; the dated private retrieval gate still fails; native zoom/paste remain
unclaimed; supported Homebrew stays 0.3.2. The beta label/noindex is not access control.
Refuse promotion if the publishing head advanced; refresh scoped checks instead of overwriting.

Rollback: restore the seven incumbent root files from
`3f891197d8642313034f73c09ed22adea4f64a1f` through a new scoped publishing commit, retain
the beta subtree and legacy media URLs, and verify all restored bytes and root UI. Never reset
or force-push the publishing history. Source and publishing commits are separate identities.

## Cleanup

The temporary Pages worktree was removed/pruned after its commit was pushed and read back.
All four task-owned local servers and both isolated browser sessions were stopped. No
pre-existing Codemap watcher was stopped. Obsolete local previews and download intermediates,
about 33 MB, were moved recoverably to Trash, along with the task-created external baseline
screenshot. The preserved source captures are tracked; no user data or shared Trash was erased.

The remaining task scratch, about 75 MB, contains the production/staging candidates, pinned
Bun runtime, rollback snapshot and live QA captures pending production approval. The empty
unit-fixture parent remains because the tests name it. It is not a private-data archive.
