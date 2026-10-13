# hay website

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers evaluating hay for their own terminal or coding-agent workflow. They need to
understand what ranking changes, see evidence, and reach a working installation or the manual.
This is retained product truth from README.md and AGENTS.md, not a new audience claim.

## Product Purpose

hay is a Rust ranked grep. It uses ripgrep's matching engine, prioritizes likely definitions,
and interleaves ranked results by file. The public website explains this mechanism and its
limitations; the website is not a hosted search service.

## Positioning

The complete normalized-ripgrep match set is preserved when a search completes. Ranked
candidate-cap and visibility errors report incomplete results with exit 2. No query rewriting,
persistent index, watcher or automatic history is part of the delivered implementation.

## Operating Context

Source version 0.4.0 adds explicit live filename discovery and stdio MCP. The supported
Homebrew binary is still 0.3.2 until the protected binary release and tap update occur.
Source installation can access the merged 0.4.0 implementation. Ordinary CLI behavior remains
the product contract. The website publishes on the existing GitHub Pages gh-pages branch.

## Capabilities and Constraints

- Three opt-in MCP tools: grep, find_files and multi_grep; explicitly registered search roots.
- Filename search has exact, substring and typo ordering plus explicit filters.
- Keep the existing benchmark film, manual, benchmark report and method explanation available.
- Preserve the distinction between historical public definition-finding evidence and private
  behavioral evidence. The historical private gate still fails and was not rerun here.
- No invented customers, testimonials, pricing, task-completion or performance claims.
- A website tag/deployment does not publish a Rust binary or change the supported tap version.

## Brand Commitments

Keep the name hay and a factual, direct voice. The existing public product material is English;
keep that language for this redesign. The owner selected an editorial direction on 2026-10-13.

## Evidence on Hand

README.md, DESIGN-hay.md, BENCHMARK.md, evidence/benchmark.json, docs/specs/fsearch-transfer/,
the 36-second editorial overview film and poster, and actual CLI regressions. The public benchmark
was generated on 2026-08-28 with hay 0.3.0; it is historical evidence, not a fresh 0.4.0 run.

## Product Principles

- Explain the changed reading order before presenting numbers.
- Give installation and independent evidence clear, direct paths.
- Keep caveats adjacent to the claims they limit.
- Prefer a small static site with inspectable product examples over new service infrastructure.

## Accessibility & Inclusion

Meet the repository's WCAG 2.2 AA requirement, including keyboard access, visible focus,
responsive text, reduced-motion support, and equivalent text for benchmark/media information.
