# 01 — Does this already exist?

Type: research
Status: resolved
Blocked by: —

## Question

Ponytail rung 1, asked honestly: **does a grep-hygiene tool need to exist at all?** Survey what
already occupies this space and report what each one *measures* versus what it *fixes*, so we can
say precisely what none of them does.

Cover at minimum:

- **Text search**: `grep`, `ripgrep` — what ranking/priors, if any, do they offer? (`rg`'s
  `--type`, ignore files, `--sort`.)
- **Structural search**: `ast-grep`, `comby`, `semgrep`, tree-sitter queries. Do any of them
  expose a *metric* over a codebase, or only match/rewrite?
- **Index/symbol**: ctags, LSP workspace symbols, Sourcegraph/Zoekt, `scip`. What do they give an
  agent that `rg` doesn't, and why do agents still fall back to `rg`?
- **Agent-facing exclusion**: `.cursorignore`, `.aiexclude`, `.claudeignore`, `AGENTS.md`,
  `llms.txt`. Is doc-sludge exclusion already a solved convention that we would only be renaming?
- **Doc rot / lint**: Vale, lychee, ADR tooling, `markdownlint`, docs-as-code status conventions.
- **Naming/quality metrics**: any existing lint rule or metric that scores identifier
  distinctiveness (not length — *distinctiveness*).

## Done when

A ranked report answering: (a) what exists, (b) what each measures, (c) the specific gap — if the
honest answer is "this is already covered, use X", say so plainly. That outcome kills or reshapes
the whole map and is a legitimate result.

## Answer

**It exists, and more of it than expected — but not the part this project is actually about.**

### The measurement machinery is solved and standardised. Do not invent a metric.

CodeSearchNet (github/CodeSearchNet, arXiv 1909.09436) is the reference benchmark: 99 curated
natural-language queries, **4,026 expert relevance judgments** on a 4-point scale over ~6M
functions in six languages, evaluated with **MRR and NDCG@k** and a published `relevanceeval.py`.
The vocabulary this project was groping toward — test collection, relevance judgment, reciprocal
rank — has been settled since Cranfield. Ticket 05's "what is the score" question is largely
answered by reading that paper rather than by arguing.

It also delivers **independent, peer-reviewed support for the addressability half of our thesis**,
far stronger than the blog post the map was anchored on: normalising identifier names collapses
retrieval quality from **MRR 0.809 → 0.419** (RoBERTa) and **0.869 → 0.507** (CodeBERT). Strip the
meaning out of names and retrieval roughly halves. That is the naming argument, quantified, by
someone else, on a public corpus.

### The intervention half is being solved by better-funded people.

A 2026 tree-sitter knowledge-graph index exposed over MCP reports **~10x fewer tokens and 2.1x
fewer tool calls across 31 repositories**; Augment's context engine reports +12.8 vs -13.9/-11.8
for competitors on 500 agent PRs against Elasticsearch. "Grep is prior-free, so add priors" is an
occupied, capitalised space. **This project should not build an index or a retriever.**

### The document-lifecycle half is only partly covered, and the gap is real.

DOCER (arXiv 2212.01479, Empirical Software Engineering) detects **outdated code-element
references** in documentation by two-snapshot diff, with a GitHub Action and a `.DOCER_exclude`
file; across 3,000+ GitHub projects most contain at least one. But it is explicitly scoped to
rotten *references* inside READMEs and wikis. Whole-document authority — "this plan is dead, that
spec is current" — is out of scope for it and, as far as this survey found, unowned.

Exclusion conventions are fragmented, not standard: `.cursorignore`, `.cursorindexingignore`,
`.aiexclude`, `.codeiumignore`, `.aiignore`. JetBrains reads several; Claude Code reads none of
Cursor's. A unifying `.agentignore` has been proposed and does not exist. Cursor states plainly
these are **not security boundaries** and that terminal/MCP tools bypass them.

One result cuts directly against adding more prose: an ETH study found LLM-generated context files
**reduced task success in 5 of 8 settings**, added 2.45-3.92 steps and 20-23% cost — and only
helped (+2.7%) once all other documentation had been removed first. More repo prose can actively
harm an agent. That supports the sludge thesis and warns against shipping another generated file.

### Verdict

The honest niche is narrow and worth stating precisely: everyone measures **the retriever against
a fixed corpus**; nobody measures **the corpus against a fixed retriever**. Inverting CodeSearchNet
— fix ripgrep, vary the repository — is the defensible idea here, together with document-level
authority, which DOCER does not attempt.

What must change as a result:
1. Use MRR. Do not invent a metric. (Actioned in ticket 08.)
2. Do not build an index or ranked retriever; that race is lost and the winners publish 10x numbers.
3. Validate against tokens / tool-calls per resolved task — the field's accepted outcome measures.

**This ticket should have been resolved before any code was written.** It was open the entire time
the scorer was being built and reviewed.

## Sources

- CodeSearchNet Challenge — https://arxiv.org/pdf/1909.09436 , https://github.com/github/CodeSearchNet/blob/master/BENCHMARK.md
- Detecting Outdated Code Element References in Software Repository Documentation (DOCER) — https://arxiv.org/abs/2212.01479
- Wait, wasn't that code here before? Detecting Outdated Software Documentation — https://arxiv.org/abs/2307.04291
- Code Intelligence & Code-Graph Indexing for AI Agents — https://anthonywest.co.uk/research/code-intelligence-indexing-2026-openai
- Repository Intelligence in AI Coding Tools (2026) — https://www.buildmvpfast.com/blog/repository-intelligence-ai-coding-codebase-understanding-2026
- Cursor ignore files — https://cursor.com/docs/reference/ignore-file
- Agent rule/context file notes — https://gist.github.com/0xdevalias/f40bc5a6f84c4c5ad862e314894b2fa6
- Your AI agent doesn't care about your readme — https://daplab.cs.columbia.edu/general/2026/03/31/your-ai-agent-doesnt-care-about-your-readme.html
