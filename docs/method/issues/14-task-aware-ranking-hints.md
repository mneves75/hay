# 14 - Task-aware ranking hints without making hay a second agent

**Status:** DELETED — public gate passed, private confirmation contradictory (2026-09-15, issue 15).
Not released; `evidence/ablations/hint-signal.patch` rebuilds the measured binary.

## The question

The public and private measurements keep pointing at the same gap: a stateless lexical query can
find the token, but it cannot know which surrounding task made that token relevant. ContextBench
describes the gap at the agent level - agents retrieve more context than they later use - and
SWE-Explore turns that into a code-search benchmark whose judgments come from independent
successful agent trajectories, not from a hay scoring rule.

This issue asks whether `hay` should accept a tiny amount of caller-provided task context while
preserving the property that made it worth shipping: it is still a grep-compatible first hop, not
a parser, index, embedding system, or agentic explorer.

## The alternatives considered

| option | decision | reason |
|---|---|---|
| repeatable literal `--hint` values | **try first** | bounded, deterministic, ranking-only, no new dependency, and compatible with agent tool use |
| named profiles such as `--docs` or `--tests` | later | useful, but each profile embeds a product opinion and needs its own benchmark |
| within-file depth packing | later | can help top-10 without changing scoring, but it does not add task context |
| ranked regions or context blocks | later | risks violating the invariant that rank order is the product unless carefully specified |
| tree-sitter structural search | no for this feature | belongs to the structural-search tool family; `ast-grep` already owns that job |
| explicit tool routing docs | keep documenting | correct boundary, but not an implementation |
| MCP wrapper that chooses tools | later, separate product | could be the five-year shape, but it is not the CLI's smallest useful improvement |
| hybrid dense/BM25 companion | later, separate product | CoREB shows short keyword queries are hostile to generic embeddings; training data would matter |
| LSP/SCIP or Zoekt companion | later, separate product | valuable graph/symbol layer, but it trades away zero-index adoption |
| repo map or session cache | later | useful for agents, but persistent state changes the contract and privacy story |

The choice is deliberately small: add a caller-controlled lexical prior, not a hidden semantic
retriever.

That choice also follows the strongest production evidence found in the review. Sourcegraph
reports a roughly 20% internal search-quality gain from interpretable BM25F fields for symbols and
filenames, and its Cody Enterprise documentation says it replaced embeddings with Sourcegraph
Search for scale, maintenance, security, and equal-or-better internal quality. Those are vendor
measurements, not independent benchmarks, so they guide architecture rather than count as evidence
for this signal. They still argue for a small explicit lexical field before a new embedding stack.

## The proposal

Add `--hint <literal>` as a repeatable ranked-mode flag. A hint is task context already known to
the caller: another symbol, path token, package name, or domain word from the issue. `hay` does
not parse prose and does not infer hints from the primary query.

Fixed here, before implementation:

1. `--hint` accepts at most eight nonempty UTF-8 strings, each at most 80 bytes. Duplicate hints
   are collapsed under the active case-sensitivity rule and cannot amplify their own weight.
2. Hints are literals, not regexes. Regex metacharacters in hints have no special meaning.
3. Hints are ranked-mode only. They are rejected with `--stream`, `-c`, `--count-matches`, `-o`,
   and `-v`, where no ranking exists. `-l` remains ranked and may use hints to order files.
4. The primary pattern alone defines the exact match set. A file or line that did not match the
   primary pattern is never added because of a hint.
5. Case sensitivity follows the primary search's `-i` behavior.
6. `--no-hint` disables the signal for ablation and measurement.
7. `--explain` always prints the hint contribution, including `+0.0`, so the breakdown remains a
   complete account of the score.

## The scoring rule

For each candidate line, count distinct hints found in either the matched line or the display
path. The contribution is:

```text
hint_score = 2.0 * matched_distinct_hints / total_hints
```

This participates in both prescore and final score. Its maximum contribution is below the existing
definition contribution, so task context can break ambiguous rankings without becoming a larger
single signal than a declaration.

The implementation must keep the existing invariant: `hay PATTERN` and `rg PATTERN` have the same
matches, modulo ranking, and the differential test must stay at zero differing.

## Evaluation, fixed before any number is taken

Primary public evaluation is SWE-Explore, because its relevance judgments come from files used by
successful independent trajectories. The experiment is paired:

- baseline: current `hay`;
- treatment: `hay` with hints;
- primary query derivation: existing `qderive-v1`;
- hint derivation: `hderive-v1`, mechanically taking up to eight other issue identifiers from
  the public issue text, excluding the current primary query;
- forbidden inputs: gold files, result lists, trajectory files, clicked files, or any hay score.

Report query-level paired effects with groups clustered by SWE-Explore instance:

- MRR;
- answer-in-top-10;
- nDCG@10;
- better / worse / tied counts;
- cap and truncation counts;
- manifest SHA and instance IDs;
- 10,000 paired bootstrap interval;
- Fisher randomization p-value.

The signal ships only if the clustered interval excludes zero and Fisher p < .05 for MRR or
nDCG@10, with no contradictory one-shot result on the private behavioural corpus. The public half
passes; the private half failed on its corrected one-shot (issue 15), so the signal was deleted. The default
code benchmark remains unchanged, because this is an opt-in ranking hint rather than a default
ranking signal. The documentation track is sanity-only: issue 13 already showed why heading-based
construction can make a ranking signal circular.

The original public run observed 414 paired primary queries across 96 scored SWE-Explore
instances and included every pair in inference: MRR **0.2146 -> 0.2350** and nDCG@10 **0.1500
-> 0.1640**. A P3 post-run instrument audit then found that two pairs hit the candidate cap in
both arms. Because hints participate in prescore, a capped treatment arm can retain a different
candidate set from its control; those pairs are diagnostics, not valid paired effects.

The corrected artifact keeps all 414 observations visible and estimates effects from the 412
complete pairs across the same 96 instances. MRR moves **0.2150 -> 0.2336** with clustered 95% CI
**[0.0063, 0.0325]** and Fisher p=0.0044. nDCG@10 moves **0.1501 -> 0.1633** with CI **[0.0065,
0.0211]** and p=0.0003; top-10 moves **0.3325 -> 0.3544**. Better/worse/tied on MRR:
47/18/347. The two candidate-capped pairs and zero page-truncated pairs remain counted. One
repository exceeded the archive budget and remains a counted skip.

Evidence: `evidence/swe-explore-hints.json`. The artifact pins the exact bytes of all three
benchmark/issue inputs, the sample manifest, and both retriever binaries with SHA-256 digests; none
changed during scoring. It fixes the archive budget at 500 MB and records the exact
scored/excluded partition of all 97 manifest IDs. Repository caches are keyed by instance, repo, base commit and archive budget, so neither a changed
source coordinate nor a larger-budget run can silently contaminate the fixed 500 MB sample. The
correction did not change the derivation, sample, threshold, or decision: the public gate still
passes, now on complete observations only.

## Five-year critique

The likely five-year answer is not "make `hay` understand everything." Code search for agents is
already separating into lexical, structural, graph, embedding, and session-context layers. `hay`
should be the fast lexical layer that accepts explicit context from a smarter caller. A future MCP
or IDE companion may combine `hay`, `ast-grep`, Zoekt/SCIP, repository maps, and agent session
state, but that should be a sibling system. Folding all of that into the CLI would burn the
stateless adoption advantage before the project has proved the smaller ranking idea.

## Sources

- ContextBench - https://arxiv.org/abs/2602.05892
- SWE-Explore - https://arxiv.org/abs/2606.07297
- CoREB - https://arxiv.org/abs/2605.04615
- Sourcegraph BM25F - https://sourcegraph.com/blog/keeping-it-boring-and-relevant-with-bm25f
- Sourcegraph Cody retrieval FAQ - https://sourcegraph.com/docs/cody/faq
- ast-grep introduction - https://ast-grep.github.io/guide/introduction.html
- Zoekt - https://github.com/sourcegraph/zoekt
