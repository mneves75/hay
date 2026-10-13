# Editorial manual correction

Owner report, 2026-10-13: beta approved, but `beta/MANUAL.html` was missed. Its source-only
0.4.0 documentation is present; its presentation still uses the legacy cream/gold/serif theme,
and its runtime version fetch targets a deliberately excluded Cargo file.

Use the approved Archivo/white/charcoal/green design. Preserve all manual sections, flags,
examples, disclosures, section search, command copying and keyboard navigation. Provide a
visible home path, a readable desktop contents rail, stacked mobile navigation, selectable
commands and the source/Homebrew distinction without JavaScript. No new product feature or
dependency is needed.

Keep the existing landing CSS as the shared font/palette/focus foundation; add a small manual
stylesheet and script, explicitly allowlisted and fingerprinted by the packager. Extracting a
new shared design framework would disturb the already approved landing page; merely overriding
the old embedded stylesheet would retain contradictory theme and typography code.

The builder must stamp both templates with frozen source identity, source/Homebrew versions,
phase label, robots and per-page canonical URL. No browser request for Rust source. Search
must mark the actual match, preserve text and clear cleanly; denied copy reports recovery
without changing the command. JavaScript-disabled readers retain all content and native
disclosures, without inert search/copy controls.

Freeze these checks before editing: both templates have resolved public metadata; packaged
manual uses shared font/palette and only declared local dependencies; all 13 section anchors
remain; search/clear/no-result, flag disclosure, copy success/failure and skip link work through
the real page; no page overflow at 320/390/1440 and 200% enlargement. Inspect desktop/mobile
renders, run packaging/typecheck/AST gates and independent source-blind acceptance. Publish
beta3 from clean CI-green main, with the approved film unchanged and seven production files
preserved. Do not move beta1/beta2 tags or promote a superseded production bundle.
