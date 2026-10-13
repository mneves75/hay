# Editorial landing redesign

Base: `13cb6c5`. Incumbent website source: gh-pages `3f891197d8642313034f73c09ed22adea4f64a1f`.
Depends on completed plans 001-003. Owner requested implementation and chose editorial.

## What the review changes

Track the landing source on the working/main branch instead of editing only the deployed
branch. Replace the warm serif/chip layout with a white, charcoal and green editorial world.
Put the retrieval mechanism and a real fixture before benchmark persuasion; make installation
an obvious action. Remove scroll-dependent visibility of numerical evidence. Correct the stale
private-gate figures and distinguish source capabilities from the supported Homebrew release.

## First principles and research

A visitor must understand the mechanism, judge its limits and install the right version.
Visual hierarchy should do most of that work. Current references favor purposeful typography,
shorter copy and real product demonstrations; they do not establish a conversion guarantee.
Sources: [Webflow's January 2026 survey](https://webflow.com/blog/web-design-trends-2026),
[Vercel's interaction guidance](https://vercel.com/design/guidelines),
[Linear's current product-first presentation](https://linear.app/), and
[WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/). These are references and our interpretation;
their authors have not reviewed hay.

## Alternatives and decision

1. Static editorial page with actual search-order proof: selected. It explains the product,
   gives installation/evidence equal access and remains easy to inspect and publish.
2. A documentation-first homepage with the same example: strongest simpler alternative. Our
   judgment is that an editorial introduction better serves a newcomer; no conversion test
   establishes that. Keep the alternative's direct navigation.
3. Preserve the old structure and fix only version/evidence truth: the premise challenge.
   Distribution and retrieval evidence matter more than visual fashion, but the owner explicitly
   requested this redesign. A richer SaaS shell was considered and rejected as unnecessary.

Five years later: content drift is the main risk. A tracked static source, one explicit version
source, dated evidence, self-hosted licensed assets, native controls and a small release package
should outlast fashionable motion and a second application stack.

## Ownership and boundaries

Main session owns framing, design, implementation and acceptance. Scope: index.html, site's
landing CSS/JS/assets and small build/test scripts; design/product docs; affected CI/docs.
Keep hay's ranking, measurement instruments, release-dispatch policy and private corpus untouched.
Use Impeccable's code-led path with the owner's editorial direction; no invented stock product UI.

## Ordered implementation

1. Record product truth and the selected visual contract. Read craft-floor immediately before
   UI edits. Keep incumbent desktop/mobile captures for comparison.
2. Write build/package behavior tests first. Missing implementation must fail; success must
   prove an allowlisted public bundle, valid version/phase, complete digest manifest, and
   refusal of symlinks, dirty release input or overwriting a nonempty destination.
3. Retain a tiny tracked synthetic fixture and exact normalized rg/hay invocations. Verify its
   complete match set and the displayed order through real binaries, and label it illustrative.
   Build one semantic static landing: product statement and installation CTA; real illustrative
   search-order comparison; opt-in filename/MCP capability; historical public evidence and the
   private-gate caveat; existing film; two explicit installation choices; manual/report/source.
4. Use native controls, readable selectable commands, clipboard success/refusal feedback,
   strong focus, self-hosted licensed typography, no autoplay, and fully readable no-JS content.
5. Produce a bounded desktop/mobile QA batch including 320/390/768/1440 widths, 200% zoom,
   400% reflow from a 1280px viewport,
   keyboard, reduced motion, missing-JS/clipboard failure, media and same-origin links. Run
   Impeccable's detector once at completion, plus axe. Fix material findings in one batch and
   confirm once; independent review governs any further confirmed correction.
6. Apply improve deep to affected source, the code-review Standards/Spec axes and fresh
   different-model mneves-verify actual-interface acceptance. Retain exact results and limits.
7. Update docs/changelog and the existing PR, commit explicit paths, push and require full CI.

## Frozen acceptance

- At all named widths there is no page overflow, clipped action or unreadable evidence; zoom
  and keyboard navigation work with visible focus and no obstructing sticky element.
- Install commands identify Homebrew 0.3.2 versus source 0.4.0 accurately. Copy success uses the
  displayed command; refusal gives selectable-text recovery and announced feedback.
- Source installation pins the frozen source SHA with --locked. Source-only capability labels
  appear beside the first --find/--mcp examples, not only at the installation footer.
- Ordinary search, filename/MCP scope and evidence claims match the existing implementation;
  no acceleration/private-confirmation claim is introduced. Both evaluations and limits remain.
- Manual, report, method, GitHub and film remain reachable; static content survives disabled JS;
  media does not autoplay; no runtime font/analytics dependency is introduced.
- Public packaging is explicit, reproducible and complete, with source/tag identity and per-file
  SHA-256. No private corpus, Git state, task scratch or development-only files are served.
  The manifest hashes every payload file except itself. Deterministic output, a planted excluded
  private-looking sentinel, symlink refusal and preserved nonempty output are actual controls.

Validation: `bun test site/build.test.ts`, `bun run typecheck`, AST scan, actual isolated-browser
flow/axe, and all required CI gates must exit 0; missing capability is BLOCKED, never PASS.

Advisory review: fresh read-only GPT-6 Astra using mneves-expert-review. The six concrete
corrections above and in plan 005 were accepted. Research/reference review is not browser
acceptance or an endorsement by the referenced designers; axe is supporting evidence, not
WCAG certification.
