# 04 — Does the noise actually show up in a number?

Type: prototype
Status: resolved
Blocked by: —

## Question

Before designing a score, find out by hand whether the phenomenon is even measurable. Make the
crudest possible version, on real repos, and look at it together.

Pick 3 local repositories spanning the range — one agent-heavy repo with a visible
`.scratch/` or `docs/` hoard, one clean small repo, one legacy/monolith. For each, take 5–10
realistic concept queries an agent would actually run (`auth`, `create`, `retry`, a domain noun
from that repo) and record, by hand or with a throwaway script:

- total hits and files hit;
- the split between **code** hits and **markdown/paperwork** hits;
- how many of the paperwork hits are in files that are plausibly dead;
- how many hits you'd have to read before reaching the one authoritative definition.

## Done when

We can look at three numbers side by side and answer the make-or-break question: **does this
discriminate?** If the hoarder repo and the clean repo score the same, the noise axis is dead and
the map contracts to naming only. Record the raw numbers as an asset in the repo, not just the
conclusion.

## Why this is early and unblocked

It is the cheapest thing that can kill the most expensive part of the plan. Everything downstream
assumes the number is interesting; nothing has checked.

## Answer

**Yes, decisively — and it did not need to be done by hand.** Built `grep-hygiene.ts` (rg + bun,
single file, no deps) and ran it on five repos (labels anonymised; the real mapping stays out of the published tree).
Raw output: `evidence/2026-08-19-five-repos.json`.

| repo (anonymised) | code/prose files | **prose share** | suspect share | median words/name | <3 words | p90 hits |
|---|---|---|---|---|---|---|
| `editor-app` | 330/9 | **3.2%** | 2.2% | 2 | 68.3% | 28 |
| `runtime-monorepo` | 13633/1268 | **4.4%** | 0.5% | 3 | 30.8% | 30 |
| `platform-workspace` | 1667/2167 | **14.6%** | 6.8% | 3 | 38.3% | 24 |
| `product-app` | 2761/1135 | **27.0%** | 13.1% | 3 | 30.8% | 88 |
| `docs-heavy-site` | 346/1045 | **92.3%** | 3.7% | 2 | 60.8% | 34 |

*prose share* = share of concept-query hits landing in `.md`/`.txt` rather than code, over the
**14 generic concept words that are identical for every repo**. Repo-specific busiest names are
measured too but reported separately — mixing them would compare different measurements between
repos and call it a ranking.

### Five findings, two of which reshape the map

1. **The noise axis is real and enormous.** 3.2% → 92.3% is a ~29× spread across repos owned by
   one person. In `docs-heavy-site` an agent grepping `response` gets 4,847 hits of which 95% are
   paperwork. That is the client's complaint, quantified, and it is not subtle.

2. **The two axes are independent — so 05 should ship two numbers, not a composite.** `editor-app` is
   clean on prose share (3.2%) and *terrible* on addressability (68.3% of names under 3 words). `runtime-monorepo`
   is middling on both (median 3 words, 4.4% prose). Compressing these into one
   score would tell `editor-app` it is "fine" while an agent drowns. This is the client's own mistake
   in miniature: one word, two diseases.

3. **File-count ratio is a bad proxy — hit share is the real thing.** `platform-workspace` has *more
   prose files than code files* (2167 vs 1667) and still scores 14.6%, while `docs-heavy-site` at
   1045 vs 346 scores 92.3%. That repo's code is dense (126k hits from 1661 files); the doc-to-code
   ratio predicts almost nothing about what an agent actually reads. Any competing tool that scores
   "docs vs code file counts" is measuring the wrong object. This is a load-bearing argument for
   ticket 07.

4. **The `suspect` heuristic fails exactly where it is needed most.** `docs-heavy-site` scores 92.3%
   prose but only 3.7% *suspect* prose — path and filename signals (`archive/`, `plan-v3-FINAL.md`)
   found 42 of 1,045 prose files. They work when a repo has a clean/dirty split (`product-app`: 647
   of 1135 flagged; `platform-workspace`: 462 of 2167) and collapse when **the sludge IS the repo**. So
   `proseShare` is the robust number and `suspectShare` is a secondary, higher-precision one.
   Ticket 03 must hunt for a signal that survives the no-clean-split case — git age and
   inbound-link count are the obvious next candidates.

5. **`platform-workspace` exposes the hardest sludge variant: domain-word collision.** Every other repo's worst
   queries are generic (`service`, `config`, `client`). `platform-workspace`'s are its own domain vocabulary:
   one of its own domain verbs (53.1% prose) and a second domain noun close behind. The planning docs
   discuss exactly the concepts the code implements, so no path rule, ignore-file, or stopword list
   separates them. Whatever ticket 06 chooses as "the one rule" has to work here, not just on
   `archive/`.

### Method notes / caveats

- Deterministic sample of 120 declared names per repo, ordered by FNV-1a hash so it is reproducible
  *and* spread across the name space.
- **Two real bugs found and fixed mid-probe, both of which produced confident wrong numbers:**
  1. `rg -r` does **not** rewrite the match text in `--json` output, so the first run "measured"
     names like `"class max"`. Anything downstream that parses `rg --json` needs the same warning.
  2. The first sampler sorted names alphabetically and sliced — deterministic, and badly biased:
     it only ever measured names starting with `a`. Because alphabetically-early names skewed long
     and PascalCase, **it flattered every repo on addressability**: `<3 words` moved 9.2%→17.5%,
     60.8%→68.3%, 26.7%→30.8% and 50.8%→61.7% once fixed. The selftest now fails on an
     alphabetically-biased sampler.
  3. Every concept query was passed to ONE `rg` invocation as an alternation. ripgrep matches
     leftmost-first and does not re-scan inside a match, so with `-e create -e createClient` every
     `createClient` was counted as `create` and the longer query reported **zero**. Verified
     directly against ripgrep. Per-query attribution in the first published run was corrupted;
     each query now gets its own pass. Aggregate prose share was near-unaffected (classification
     is per path, not per query), which is exactly why it went unnoticed.
- `platform-workspace` is scored once, not twice: it is a thin wrapper whose 5,429 files are 5,427
  files of its single nested repo plus large ignored archives. Its 1,926 "other"
  files (neither code nor prose) are the largest non-code mass in the sample and are currently
  unmeasured by either axis.
- Declaration scanning is restricted to code extensions; scanning prose finds English sentences
  containing the word "class".
- Not yet measured: hits-to-definition (how many hits you read before reaching the authoritative
  one). It needs definition ranking and is the natural next increment.

### Corrections after review

A Codex review (P3) and a security pass found six further defects, all fixed and re-measured
before these numbers were published. The ones that changed results:

- **Cross-repo comparison was confounded.** The headline mixed 14 shared queries with 10
  repo-specific names, so no two repos were being compared on the same measurement. The headline
  is now the shared set only.
- **Query attribution was corrupted** by the ripgrep alternation behaviour described above.
- **`percentile` was off by one** (upper-biased nearest-rank), and the selftest asserted the wrong
  value — locking the bug in as intended behaviour.
- **ripgrep failures were silently scored.** Exit code 2 became "no matches" and produced a
  clean-looking report for a scan that never ran.
- **`--sample N` was parsed as a repository path.**
- **The `worst` list was ranked by `suspectShare`** while the README calls `proseShare` primary,
  so it surfaced low-prose queries above ones where nearly every hit was paperwork.

A second review round found three more, all fixed and re-measured:

- **Occurrences were counted, not result lines.** `rg --json` emits one event per matching line
  with every occurrence in `submatches`; iterating submatches made a line containing a term ten
  times count ten times, while `rg -c` — and the stated metric — count it once. Verified against
  ripgrep: it reports 2 where the code counted 4.
- **Comments and strings polluted the declaration sample.** `// class RetryHandler` was extracted
  as a real declaration. Now filtered by comment marker and quote parity; this removed ~1% of the
  name population, so the defect was real but small in effect.
- **`lowConfidence` ignored `--sample`.** `--sample 1` on a large repo reported medians from a
  single identifier with no warning.

A third round found five more, including the one that moved the headline furthest:

- **P1: hidden directories were invisible to every scan.** ripgrep skips dotted directories
  without `--hidden`, so `.scratch/` — this tool's own top suspect-prose location — was never
  measured. `runtime-monorepo` went from "2389 code / 54 prose, 0.9% prose share" to
  "13633 / 1268, 4.4%" once its tracked `.repos/`, `.scratch/` and `.plans/` became visible, and
  **the headline spread fell from ~100× to ~29×**. Every earlier figure in this ticket was
  measured by a scanner that could not see hidden paperwork.
- **Case variants were counted as separate result lines** in the case-insensitive scans.
- **Comment detection required whitespace before the marker** and ran before quote tracking, so
  `x();/* class Removed */` passed and `const n = " // "; export class Real {}` was rejected.
- **A path containing `=` was unparseable** because of the `path=label` syntax.
- **A published README figure did not match the evidence file** — it had been hand-edited rather
  than derived. Published numbers are now generated from the evidence JSON.

Rounds four through eight found nine further defects. The ones that moved numbers:

- **ripgrep configuration and operator-local ignore state leaked into the score.** `RIPGREP_CONFIG_PATH`
  was inherited (a rc file containing `--glob=!*.md` would have produced a perfect report), and
  local `.git/info/exclude` plus the global gitignore were honoured. Disabling them changed
  `product-app` from 732/332 files to 2761/1135 — a local exclude had been hiding two thousand
  files. The same commit was scoring differently on different machines. Committed `.gitignore` is
  still honoured, deliberately.
- **Occurrences were counted where the metric says result lines**, and case variants on one line
  counted as separate lines in the case-insensitive scans.
- Also fixed: byte-vs-UTF-16 offsets, non-UTF-8 and newline-containing paths, Windows separators
  in the suspect-directory test, `E2BIG` on large `--sample`, Go `type`/method extraction,
  `basename(".")`, and a >12 MB-per-event memory path on minified files (concept queries now use
  `rg -c`, which counts matching lines directly and is both cheaper and closer to the metric).

Disclosure controls added at the same time: reports emit a basename or an explicit `path=label`
instead of an absolute path (which was publishing the operator's username and disk layout), and
the tool now warns when a report quotes a security-sensitive identifier from a private repository.
