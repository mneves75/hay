# `hay` — a ranked grep for coding agents

**Historical design and results.** The first section preserves the pre-implementation plan; the
measured result and review history follow it.

## Why this and not the scorer

The measurement work in this repo produced one finding that points directly at a product:
retrieval is roughly **equally mediocre in every repository measured** — MRR 0.184-0.375, median
rank of the answer 5 to 28, answer in the top ten only 34-62% of the time, and no repo-level
property (documentation share, naming, size) predicts which repo is worse. If hygiene does not
explain the variance, the constraint is not the corpus. It is the retriever.

`ripgrep` is not bad. It is **prior-free**: it returns matches in path order, so a dead
`plan-v3-FINAL.md` outranks the function definition whenever it sorts earlier. `hay` adds the
priors and nothing else.

**Scope discipline, from the prior-art survey:** indexing products (tree-sitter graphs over MCP,
context engines) already report ~10x token reductions and are well funded. `hay` is deliberately
*not* one of them — **no index, no daemon, no state, no background process**. It is one stateless
binary that reorders what ripgrep would have returned anyway. That is a much smaller claim and a
far cheaper thing to adopt: an agent switches by being told to type `hay` instead of `rg`.

## The one design constraint that matters

**Output must be byte-compatible with `rg`.** `path:line:text`, same flags for the common cases
(`-i`, `-w`, `-F`, `-g`, `-l`, `-n`, `-C`). Agents already know how to read ripgrep output and
already know its flags. Any adoption story that requires the agent to learn a new format or a new
protocol is dead on arrival. The only difference is the *order* of the lines and where the tool
stops.

## Ranking model

Ranking is BM25 over files plus structural boosts — standard information retrieval, applied to a
tool that currently has none.

**Base relevance (BM25).** Term frequency within a file, damped, over inverse document frequency
across the repo. IDF is the important half: a term matching 500 files carries almost no
information, a term matching 3 files is close to an address. This alone reorders the common
failure case, where a generic word buries its own definition.

**Structural boosts, each of which must earn its place by ablation:**

| signal | rationale | evidence |
|---|---|---|
| definition > mention | a line declaring the symbol is usually the answer | CodeSearchNet: normalising identifiers halves MRR (0.809 → 0.419), so identifier position carries the signal |
| exact case/word match > substring | `Config` for `config` beats `reconfiguration` | free from the matcher |
| code > prose | a definition beats a plan describing it | **weak prior — must be validated.** Repo-level prose share predicted nothing (ρ −0.035); it may still work as a per-result tiebreak, which is a different claim |
| live > archived path | `src/` over `archive/`, `.scratch/` | **weak prior.** Measured lift for deadness detection was only 1.14; include only if ablation shows it helps ranking |
| tests down-ranked unless the query looks test-related | `handleApi` usually means the implementation | untested hypothesis |
| file concentration | many matches for a rare term = the home of that concept | this is just BM25 term frequency; listed for clarity |

Two of these are prior beliefs my own measurements have already been unkind to. They are in the
table because they are plausible per-result, not because they are established. **Any signal that
does not improve MRR in ablation does not ship.**

## Architecture

```text
ignore 0.4.33              gitignore-respecting parallel walk  (ripgrep's own crate)
grep-regex 0.1.14 +        matching                            (ripgrep's own engine)
grep-searcher 0.1.17
  -> single walk, all patterns in one RegexSet pass
  -> per-file match collection + repo-wide document frequency
  -> score, bounded top-K heap
  -> emit in rg format
```

Using ripgrep's own crates is not a convenience, it is a correctness decision. It makes four bug
classes that actually occurred during this project **structurally impossible** rather than guarded:

1. `rg --json` parsing errors (two of the nine instrument bugs found in this repo were this);
2. exit-code confusion (`1` = no match vs `2` = failure silently scored as "clean");
3. nondeterministic output order under parallel traversal (verified real: three identical runs,
   three different orderings);
4. inherited `RIPGREP_CONFIG_PATH` silently changing results.

Owning the walk also fixes the performance problem, which is architectural rather than linguistic.
The TypeScript diagnostic spawns **one `rg` per query** — 146 tree walks to analyse one repository.
Rust does one walk and matches every query in a single pass. That is an ~N× improvement, not the
2-3× a language port would buy on its own.

**The streaming tradeoff, stated honestly.** `rg` streams: it can print the first match before it
has seen the last file, which is what makes `rg foo | head` cheap. A ranker cannot — it must see
the candidate set before it can order it. Mitigations: a bounded top-K heap so memory stays
constant regardless of match count; a fast path that skips scoring entirely when total matches are
below a threshold (nothing to rank); and `--stream` to fall back to pure ripgrep behaviour. Latency
becomes "time to walk the tree" instead of "time to first match". For a coding agent, which reads a
whole result page before acting, this is the right trade — but it is a real regression for
interactive human use and should be documented as such, not hidden.

## How we know it works — decided before writing code

This is the part the rest of this project got wrong, so it is fixed first.

**The evaluation harness already exists and already has a baseline.** `harvest-queries.ts` +
`measure-mrr.ts` produce a test collection of real agent searches paired with the files the agent
actually opened, and a per-repo MRR. Current baseline with plain ripgrep, on 12 repositories:

```text
MRR 0.184 - 0.375     median rank 5 - 28     answer in top 10: 34% - 62%
```

Swapping the retriever and recomputing MRR on the identical collection is a direct A/B. Nothing
about the ground truth changes.

**Success criteria, fixed now so they cannot be moved later:**

- **Ship threshold:** median MRR across the 12 repos ≥ **0.50** (from a measured median of **0.265**), and answer in
  the top 10 ≥ **80%** (from a measured median of **49%**).
- **Do-not-ship:** any repo where MRR is *worse* than plain ripgrep. Ranking that helps on average
  while hurting somewhere is a trap for whoever hits that repo.
- **Per-signal ablation:** every boost is measured with and without. Signals that do not move MRR
  are deleted, not kept "because they seem sensible". This applies especially to the two priors
  already flagged as weak.
- **Honest limits:** n=12 repositories from one developer. The eval must be re-run on someone
  else's corpus before any public claim. The harness makes that a five-second job for anyone with
  agent transcripts, which is the point.

**Outcome validation, further out.** MRR is still a proxy. The field's accepted measures are tokens
and tool calls per resolved task. The real experiment is running an agent on a fixed task set with
`rg` and with `hay`, and comparing both. That is expensive and comes after the MRR gate, not
instead of it.

## Cross-agent support

Queries are recoverable from both Claude Code and Codex — both record shell commands with `cwd`
(Codex: 785 `rg`/`grep` invocations in a 60-file sample).

Relevance judgments are asymmetric and this is the real work. Claude Code emits structured
`Read`/`Edit` tool calls. **Codex reads files through the shell** — 9 structured read markers
against those 785 searches — so what it opened must be recovered by parsing `cat`, `sed -n 'X,Yp'`,
`head`, `tail`, `bat` and `apply_patch` out of shell arguments. Same quote-aware tokeniser the
query harvester already needs, applied to a second command vocabulary. Noisier than structured tool
calls; the harvester should record which agent and which extraction method produced each judgment
so the two can be compared rather than silently pooled.

Note this matters only for *evaluating* `hay`. `hay` itself needs no transcripts and no history —
it ranks live.

## CLI surface

```bash
hay <pattern> [path]        # ranked, rg-compatible output
hay -l <pattern>            # files, best first
hay --explain <pattern>     # per-result score breakdown, for debugging the ranker
hay --stream <pattern>      # bypass ranking; behave exactly like rg
```

Common ripgrep flags pass through unchanged (`-i -w -F -n -C -g -t --hidden --no-ignore`).

## Open questions for review

1. **Name.** `hay` is short, typeable and distinctive — which is what this project's own evidence
   says a name should be. Alternatives if it collides: `sift`, `rgr`.
2. **Should `hay` read `AGENTS.md`** for repo-specific priors ("the real implementation lives in
   `packages/core`")? Powerful, and it makes the ranking repo-controlled, which is a gaming vector
   and a reproducibility problem. Recommend: no, not in v1.
3. **Definition detection.** Regex keywords are what this repo already uses, and they were wrong
   often enough to matter. `ast-grep` or tree-sitter would be correct but adds a dependency per
   language and startup cost. Recommend: start with regex, measure how much definition-boost
   contributes, and only pay for tree-sitter if the ablation says it earns it.
4. **Is the streaming regression acceptable?** For agents, almost certainly. For humans piping to
   `head`, no. `--stream` covers it, but it means the tool has two behaviours.

---

# Results — built and measured

Implemented in `hay/` (Rust, 1,850 lines of source plus 228 of CLI contract tests, 41 tests, zero
warnings). A/B against the identical test collection: 12 repositories, 2,508 judged queries from
real agent transcripts.

The ranking code was unchanged from 0.1.0 through 0.3.0; 0.4.0 added the typed-declaration rule for
brace languages, and 0.5.0 changed no ranking behaviour at all — its numbers differ from 0.4.0's
only because the harness that produces them was corrected.

Reported as a **paired** comparison, absolute differences with 95% bootstrap intervals, over the
953 queries where both retrievers return something. The original framing — "median MRR 0.265 →
0.391, +47%, 12/12 improved, none worse" — was a relative improvement of an arithmetic mean with no
interval, computed over twelve repo-level medians when the design is paired at the query level.

Measured on the 0.5.0 harness, after the `--hidden` asymmetry that had made the two retrievers walk
different file sets was fixed. It did not move the result (+0.1318 against +0.131), which is
knowable only because it was re-run.

| | ripgrep | hay | difference (95% CI) | rand. p |
|---|---|---|---|---|
| MRR | 0.265 | **0.397** | **+0.132** [0.107, 0.158] | 0.0001 |
| answer in top 10 | 46.0% | **58.2%** | **+12.3 pts** [9.1, 15.5] | 0.0001 |
| nDCG@10 (distinct files) | 0.373 | **0.503** | **+0.131** [0.110, 0.152] | 0.0001 |
| clustered by repo, MRR | | | +0.132 [0.105, 0.157] | 0.0005 |
| per-query outcome | | | **570 better / 226 worse / 157 tied** | |
| peak memory, 61k-match query | 5.2 MB | 13.9 MB | flat in match count | |

10,000 replicates, fixed seed, percentile interval, plus Fisher's paired randomization test — the
reference Smucker et al. validate the bootstrap against, run here rather than merely cited. Every
interval excludes zero, both tests agree, and the repo-clustered interval barely differs from the
query-level one, so the effect does not depend on a handful of queries in one project.

nDCG@10 is here because these judgments average **2.27 relevant files per query** — an agent opens
several files after one search — so MRR, which stops at the first, was reading a minority of the
evidence collected. It gives the same answer, which is the outcome worth having: the gain is not
one lucky top hit per query. Evidence: `evidence/2026-08-20-paired-bootstrap.json`.

**hay is worse on 24% of individual queries.** The old "none worse" was true of repository medians
only. The pre-registered do-not-ship criterion was written at repo level and still holds, but the
per-query picture is the one that describes what an agent experiences, and it is not one-sided.

**The pre-registered gate FAILS**, at median MRR **0.387** against 0.50 and top-10 **58.2%**
against 80%. Both thresholds were fixed before implementation precisely so they could not be moved
afterwards, and they have not been. `measure-mrr.ts --compare` now prints the gate itself, so the
verdict comes from the same run as the evidence rather than from arithmetic done by hand over a
table. `hay` is a large, statistically unambiguous improvement — the interval on the difference is
nowhere near zero — that is still not good enough by its own stated standard. Those are compatible
statements, and keeping both is the point: significance is not sufficiency.

## Correctness property: same matches, different order

`hay` must return exactly what ripgrep returns, only reordered. `hay/differential-test.sh` checks
this over 10 queries per repository: **30/30 identical match sets**.

This test found three defects that no unit test would have caught, because each one changed *which
files were searched* rather than how a line scored:

- **no binary detection** — hay searched files ripgrep reports as "binary file matches" and printed
  raw binary bytes into output an agent parses. Now quits at the first NUL, matching ripgrep.
- **`.git/` was searched** under `--hidden`. ripgrep avoids VCS metadata only because the directory
  is hidden, so `--hidden` re-exposed packfiles and hook samples. Now excluded by default and under
  `--hidden` / `--no-ignore`, along with `.hg/`, `.svn/`, `.jj/` — though an explicit `-g` include
  still reaches them, as it does in ripgrep. See the security review below.
- a first version of the test itself was **invalid** — it passed `--hidden` to ripgrep but not to
  hay, and the resulting "missing matches" were an artifact of the harness, not the tool.

## Ablation — what each signal actually earns

Re-measured on the corrected binary. Earlier ablation figures were taken before four scoring fixes
and were stale.

| signal | contribution to median MRR |
|---|---|
| path class (source / test / prose / data / buried) | **+0.032** |
| definition detection | **+0.026** |
| term frequency (capped) | **+0.017** |
| ~~whole-word match~~ | −0.001 — **deleted** |
| ~~exact-case match~~ | +0.000 — **deleted** |
| ~~comment penalty~~ | +0.000 — **deleted** |

**Three of six hand-designed signals earned nothing and were removed.** Each sounded obviously
correct. Removing whole-word matching slightly *improved* the score. What survives is three
signals, and the strongest is path class — despite the repo-level finding that documentation share
predicts nothing (rho −0.035). A prior can be worthless as a repository score and valuable as a
per-result tiebreak; that distinction was written down as a hypothesis before testing, and held.

**Constraint on any future signal** (2026-08-20, from the bounded-retention soundness argument in
`score.rs`): a signal must be computable per line/per path — it goes into `prescore_line` — or, if
it needs per-file state, it must be capped like the frequency term. The top-K heap retains
candidates by prescore during the walk; an uncapped post-walk signal could out-score a dropped
candidate, making bounded retention silently wrong. BM25 document-length normalisation is only
admissible folded into the capped TF term.

**Development/confirmation firewall** (2026-08-20): the behavioural corpus decides *what* to build
(the counted taxonomy, issue 10); the public benchmark decides *how much* (weight values, every
keep/delete decision). Weights are frozen and committed before any behavioural run of a changed
binary, and confirmation is one run, whose numbers are the published numbers. The count of
behavioural runs per release cycle is part of the record — it is the honest measure of how much
the gate corpus was looked at.

## What review and verification changed

An independent review found six defects; verification found three more; the unit tests found two.
The ones that mattered were all the same class — silently wrong answers rather than crashes:

1. `is_whole_word` advanced one byte at a time and **panicked on any non-ASCII line**.
2. Walk and search errors were discarded — unreadable paths produced partial results reported as
   success. Now counted, printed, and exit 2.
3. Scoring compared against the raw pattern, so for any regex (`foo|bar`) the definition signal
   **silently never fired**. Now scores against the text actually matched.
4. Bounded retention by prescore was unsound while the frequency term was uncapped — it could reach
   6.5 and outweigh the definition signal (6.0). Capped at 2.0.
5. Stripping the search root printed `file.rs` instead of `src/file.rs`, losing the path
   classification that ablation later showed is the strongest signal.
6. A missing pattern printed help and exited **0**, falsely signalling "match".
7. A `foo(bar)` call at the start of a line was scored as a **definition**.
8. Bounding the channel **deadlocked** the walker until consumption moved to its own thread.

Fixing the correctness bugs *lowered* median MRR from 0.402 to 0.391. The earlier number was
partly inflated by the false-positive definition rule. That is the right direction of travel.

## Security review

Ten probes against the built binary, verified rather than asserted, and re-run against 0.2.0 with
the new surface (`--json`, `-C`, `-e`, `-t`) in place. Re-running them corrected one claim that had
been asserted and never tested: VCS metadata is excluded by default and under `--hidden` /
`--no-ignore`, but **not** against an explicit `-g '.git/**'`, which searches it — as `rg` does with
the same flag. The exclusion is a default, not a sandbox, and the earlier "unconditionally" was
wrong. symlinks are not followed out
of the tree (no `/etc/passwd` escape); catastrophic regexes do not hang (Rust's engine is
linear-time by construction); oversized patterns are rejected; `.gitignore` and hidden files are
excluded by default so secrets are not read unless `--hidden --no-ignore` is passed explicitly;
binary content is suppressed; VCS metadata is never searched; non-ASCII input does not panic; exit
codes are 0/1/2 as ripgrep defines them.

Memory is bounded by a capped heap plus a bounded channel. The original unbounded design peaked at
135 MB on a broad query and grew with match count — attacker-influenced input, since the agent
chooses the pattern. Re-measured on 0.2.0: 13.9 MB on a 61,249-line query against ripgrep's 5.2 MB,
and 12.6 MB on a query that truncates at the candidate cap. A few megabytes above ripgrep, and flat
in match count, which is the property that matters.

Regex *compilation* is not bounded by `hay` and deliberately so: it inherits ripgrep's limits
unchanged, since accepting a different pattern set than ripgrep would break the parity the tool is
built on. Both allocate hundreds of megabytes on a pattern near the ceiling (367 MB `hay`, 368 MB
ripgrep, same pattern) and both exit 2 past it. Two new probes were added for 0.2.0: `--json`
output stays parseable when a matched source line contains JSON metacharacters, and `-C` re-reads
only files the walk already yielded, so context cannot reach a path the search itself excluded.

**0.5.0 review — the property this design gives away.** Every probe above is about what `hay`
reads. The one that had been missed is about what it *promotes*, and it is the only axis where
`hay` is strictly worse than the tool it wraps. ripgrep orders by path, so a file cannot influence
its own position in the output. `hay` orders by content, by construction — so anyone who can write
a file into a searched tree chooses what an agent reads first. Shape a file like a declaration in a
`src/` path and it outranks the genuine definition; under ripgrep it would have landed wherever its
filename sorted.

This is a design consequence, not a bug, and it does not have a fix that leaves the tool intact:
ranking by content *is* the product. What bounds it is that the signals are structural, public, and
inspectable per result with `--explain`; that the attacker needs write access to the tree being
searched; and that the match set is still exactly ripgrep's, so nothing is hidden, only reordered.
The correct posture is to treat search output as untrusted content regardless of rank — true for
`rg` too, and more obviously necessary here, since the entire point is that something reads the
first page and acts on it. Stated in `SECURITY.md` rather than left for someone else to notice.

Two findings outside the binary, in the measurement kit: `--json` serialised the absolute checkout
path into payloads written beside a committed `evidence/` directory (stripped, tested, and the
command now warns that the per-repo payload contains real queries), and `cargo audit` — wired into
CI since 0.2.0 — had never once executed, because CI has never run. Run manually: clean across 58
dependencies.

## Honest status

**0.5.0 — the instrument was audited, and it had a defect that could have invalidated the A/B.**
No ranking code changed in this release. The harness gave ripgrep `--hidden` and never gave `hay`
the matching flag, so for four versions the published comparison ran two retrievers over different
file sets. Re-measured after the fix, the effect is +0.1318 [0.1065, 0.1585] against the published
+0.131 [0.105, 0.158] — unchanged. The point is not that it was harmless; it is that nobody knew
that until it was measured, and this project has retracted numbers twice before for exactly this
class of thing.

The same pass added the test the project had been citing rather than running. Smucker et al. treat
Fisher's randomization test as the reference and validate the bootstrap against it, and their 2009
follow-up finds the bootstrap biased toward smaller p at small samples — so the one statistic being
reported was the flattering one. Both now run at both clustering levels and agree (p=0.0001 by
query, 0.0005 by repo). nDCG@10 over distinct files was added because these judgments average 2.27
relevant files per query and MRR reads only the first: +0.1306 [0.1097, 0.1524], the same effect,
which is the answer you want — the gain is not one lucky top hit per query.

Review then caught a defect in that new metric before publication: nDCG counts distinct *files*
while the scan stopped at 1,000 result *lines*, so a query with one very noisy first file would
have scored nDCG 0 with the answer at file-rank 2. It fired on 0 of 953 queries. Fixing it
introduced a second defect in the same diff — a rank past the cap being recorded as a real rank,
inflating MRR on the noisiest queries — caught by asserting the behaviour rather than trusting the
change. Both live in a pure `ResultScan` class now, because the original loop spawned a process and
therefore could not be unit-tested at all, which is why neither was visible.

**Review history for 0.2.0.** Four rounds of independent adversarial review (Codex `gpt-5.6-sol`,
`--max-priority P3`) found **12 defects**, converging 5 → 5 → 2 → 0. Every one was reproduced
against ripgrep before being fixed and after, and two of them were introduced by the previous
round's own patch — including a fix for duplicated context lines that silently reordered results,
which is worse than the bug it replaced, because rank order is the entire product. The full list is
in `CHANGELOG.md`. The pattern is the one this repository already knew: the defects were all quiet
wrong answers, never crashes, and none would have been noticed from reading the output.

**Engineering, as of 0.2.0: closed.** `-C/--context`, `--json`, multi-pattern `-e`, `-t/--type`,
packaging (`cargo install --path hay`, MIT, crate metadata) and CI on Linux, macOS and Windows all
ship. CI runs fmt, clippy, the Rust tests, the differential test against ripgrep, every TypeScript
selftest, type checking, Bun and Rust vulnerability audits, an MSRV check, and generated-report
drift checks. At the time of the 0.5.0 review, CI had not executed in the private repository, so
`cargo audit` was run locally and cross-platform support remained configured but unverified. Two
defects were found while closing the engineering work, both of the quiet-wrong-answer kind this
project keeps producing: truncation above 20,000 candidates evicted on prescore alone, so which
lines survived depended on the parallel walker's delivery order in a tool that documents itself as
deterministic; and a search in which every path was unreadable exited 1 — "found nothing" — rather
than 2.

**Research: unchanged, and this is the part that matters.** The pre-registered gate still fails at
**0.387 / 58.2%** against 0.50 / 80%, and it has not been moved. Those two figures are, as of
0.5.0, the first ones any code actually computed the way the gate was written — a median across the
twelve repositories. The number quoted before (0.391 / 57%) was assembled by hand from a per-repo
table, and being close to right is not the same as being computed. The evaluation remains n=12 from one
developer's repositories; the three surviving weights are hand-set rather than fitted, because
fitting them on this same set would be overfitting the only evaluation set that exists. A held-out
corpus is needed before any published claim, and MRR is still a proxy for the outcome measures the
field actually uses. Shipping the missing flags did not move any of that, and was never going to.

One methodological note earned during the 0.2.0 work: re-measuring MRR against live working trees
is not reproducible. Two repositories in the set moved by 0.0001 between runs, which turned out to
be 1,795 and 179 files changing under the measurement, not a ranking change — confirmed by diffing
the old and new binaries' output on exactly the queries that moved, which was identical. Pin the
corpus to a fixed checkout before comparing anything.
