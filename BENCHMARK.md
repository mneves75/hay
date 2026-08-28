# Code search benchmark

Every code-search tool installed on the test machine, over 4 usable repositories (plus 1 thin self-check corpus), measured on one
task: **given a symbol, how far down the results is its declaration?**

> ### Read this before the numbers
> `hay` is built to rank declarations first, and this benchmark's ground truth *is* the
> declaration. It is measuring the thing `hay` optimises for, so it should win, and a win here
> is weaker evidence than it looks. Read inferential margins only for invocations with an
> explicit stable-order contract; every unordered tool remains visible as a snapshot.
>
> The project's other evaluation does not have this problem: it uses real agent searches paired
> with the files the agent opened next, so the ground truth was not designed around the tool.
> That one is in `README.md`. It is also unreproducible by anyone else, because the transcripts
> are private. Neither evaluation is sufficient alone; that is why both exist.

**New to any of this?** [BENCHMARK_FEYNMAN.md](BENCHMARK_FEYNMAN.md) builds every idea below from
scratch — no jargon, one analogy at a time — including the traps that nearly poisoned the numbers
and the places this benchmark is wrong.

## Method

- **Generated** — 2026-08-28T15:40:24.464Z.
- **Task** — definition finding: given a symbol declared exactly once, rank of the declaring file.
- **Ground truth** — ast-grep (a parser), independent of every heuristic under test. A symbol declared in more than one place is discarded:
  there is no single right answer, so scoring against an arbitrary one would be noise.
- **Queries** — symbols with between 5 and 2,000 total occurrences. Fewer than five is not a
  retrieval problem; more than two thousand is a different and pathological one. Sampling is
  seeded, so the same corpus yields the same queries on every run.
- **Metric** — reciprocal rank of the first result line landing in the declaring file, capped
  at 1000 results. Mean reciprocal rank and the share answered within the first ten.
- **Difference** — for stable-order invocations only: absolute, against deterministic ripgrep
  `--sort path`, with a 95% paired bootstrap interval over per-query reciprocal ranks
  (10,000 replicates, fixed seed). Unordered tools are descriptive snapshots. An interval that
  spans zero is not a detected difference, whatever the point estimate suggests.
- **Significance** — Fisher's paired randomization test on the same differences, reported
  beside the interval. Smucker et al. (CIKM 2007) use the randomization test as the reference
  against which the bootstrap and the t-test are validated, and their follow-up (SIGIR 2009)
  finds the bootstrap biased toward smaller p-values at small samples — which is most of the
  corpora here. Where the two disagree, believe the randomization test. Neither test is run
  for a tool that cannot guarantee repeatable rank order.
- **Flag parity** — every tool is asked for the same job: recursive, fixed-string,
  case-sensitive, `path:line:text`. Filtering is deliberately *not* normalised across tools,
  because what a tool skips is a real property of it; the file counts each tool sees are
  reported per corpus. The **one exception is ripgrep**, which is given
  `--sort path --no-ignore-dot --no-ignore-global --no-ignore-exclude` so its rank order is
  deterministic and it walks exactly what `hay` walks. ugrep gets its documented `--sort=name`
  mode for the same reason. `hay` disables those sources internally so operator-local state cannot change
  results; without the flags the head-to-head measured which files were searched rather than
  how they were ranked — 231 files against 225 on the ripgrep corpus, which ships a `.ignore`.
- **Invocation** — every binary is called by absolute path. On the test machine `grep` is a
  shell function that resolves to ugrep, so calling tools by name would have measured the
  wrong program.
- **Peak memory** — an em dash means `/usr/bin/time -l` did not expose RSS for that run;
  missing values are reported, never imputed.

### Versions

| tool | version |
|---|---|
| `hay` | hay 0.3.0 |
| `rg` | ripgrep 15.2.0 |
| `ugrep` | ugrep 7.8.4 aarch64-apple-darwin25.6.0 +neon/AArch64; -P:pcre2jit; -z:zlib,bzip2,lzma,lz4,zstd,brotli,7z,tar/pax/cpio/zip |
| `ag` | ag version 2.2.0 |
| `grep` | grep (BSD grep, GNU compatible) 2.6.0-FreeBSD |
| `git-grep` | git version 2.55.0 |
| `cs` | cs version 1.4.0 |
| `ast-grep` | ast-grep 0.45.2 |

## Documentation track

Generated 2026-08-28 · hay hay 0.3.0 · rg ripgrep 15.2.0.
Corpus revisions: linux `1b78070aaef6` · openclaw `0706f629c3b5` · ripgrep `3fce3b5bb023` · alamofire `0455bfb65089` · hay `87d3988c8119`.

A public development set for documentation retrieval: identifier-like tokens from ATX
headings that occur in exactly one markdown file's headings and in at least three
parity-visible files. Ranks use the same 1000-result-line cap as the code
track; cap truncations are reported as `hay / rg`, never absorbed into another metric.

| corpus | n | MRR hay | MRR rg --sort path | Δ MRR (95% CI) | bootstrap p | randomization p | both tests | cap truncations (hay / rg) |
|---|---:|---:|---:|---|---:|---:|---|---:|
| linux | 60 | 0.032 | 0.043 | -0.010 [-0.037, 0.009] | 0.436 | 0.568 | ✓ agree — not detected | 22 / 28 |
| openclaw | 60 | 0.060 | 0.132 | -0.072 [-0.135, -0.009] | 0.024 | 0.026 | ✓ agree — detected | 6 / 4 |
| ripgrep | 60 | 0.110 | 0.197 | -0.087 [-0.148, -0.033] | <0.001 | 0.003 | ✓ agree — detected | 0 / 1 |
| alamofire | 60 | 0.130 | 0.324 | -0.194 [-0.276, -0.118] | <0.001 | <0.001 | ✓ agree — detected | 0 / 0 |
| hay | 60 | 0.228 | 0.313 | -0.085 [-0.164, -0.010] | 0.024 | 0.033 | ✓ agree — detected | 0 / 0 |

### Query-shape splits

Mutually exclusive precedence: flag-shaped → uppercase → snake case → hyphenated → camel
case → pascal case → plain word.

| corpus | feature | n | MRR hay | MRR rg --sort path | Δ MRR |
|---|---|---:|---:|---:|---:|
| linux | `flagShaped` | 0 | 0.000 | 0.000 | +0.000 |
| linux | `hyphenated` | 4 | 0.039 | 0.078 | -0.039 |
| linux | `snakeCase` | 4 | 0.161 | 0.203 | -0.042 |
| linux | `upperCase` | 0 | 0.000 | 0.000 | +0.000 |
| linux | `camelCase` | 0 | 0.000 | 0.000 | +0.000 |
| linux | `pascalCase` | 29 | 0.037 | 0.049 | -0.012 |
| linux | `plainWord` | 23 | 0.003 | 0.000 | +0.003 |
| openclaw | `flagShaped` | 0 | 0.000 | 0.000 | +0.000 |
| openclaw | `hyphenated` | 6 | 0.006 | 0.020 | -0.014 |
| openclaw | `snakeCase` | 1 | 0.022 | 0.100 | -0.078 |
| openclaw | `upperCase` | 2 | 0.288 | 0.542 | -0.253 |
| openclaw | `camelCase` | 2 | 0.057 | 0.177 | -0.120 |
| openclaw | `pascalCase` | 18 | 0.037 | 0.140 | -0.103 |
| openclaw | `plainWord` | 31 | 0.070 | 0.120 | -0.050 |
| ripgrep | `flagShaped` | 0 | 0.000 | 0.000 | +0.000 |
| ripgrep | `hyphenated` | 1 | 0.333 | 0.017 | +0.316 |
| ripgrep | `snakeCase` | 0 | 0.000 | 0.000 | +0.000 |
| ripgrep | `upperCase` | 1 | 0.250 | 0.143 | +0.107 |
| ripgrep | `camelCase` | 0 | 0.000 | 0.000 | +0.000 |
| ripgrep | `pascalCase` | 17 | 0.139 | 0.298 | -0.158 |
| ripgrep | `plainWord` | 41 | 0.089 | 0.161 | -0.072 |
| alamofire | `flagShaped` | 0 | 0.000 | 0.000 | +0.000 |
| alamofire | `hyphenated` | 0 | 0.000 | 0.000 | +0.000 |
| alamofire | `snakeCase` | 0 | 0.000 | 0.000 | +0.000 |
| alamofire | `upperCase` | 2 | 0.187 | 0.254 | -0.067 |
| alamofire | `camelCase` | 1 | 0.500 | 1.000 | -0.500 |
| alamofire | `pascalCase` | 51 | 0.135 | 0.350 | -0.215 |
| alamofire | `plainWord` | 6 | 0.012 | 0.021 | -0.010 |
| hay | `flagShaped` | 0 | 0.000 | 0.000 | +0.000 |
| hay | `hyphenated` | 1 | 1.000 | 1.000 | +0.000 |
| hay | `snakeCase` | 0 | 0.000 | 0.000 | +0.000 |
| hay | `upperCase` | 1 | 0.143 | 0.250 | -0.107 |
| hay | `camelCase` | 0 | 0.000 | 0.000 | +0.000 |
| hay | `pascalCase` | 12 | 0.249 | 0.406 | -0.157 |
| hay | `plainWord` | 46 | 0.208 | 0.275 | -0.067 |

## linux

Corpus revision `1b78070aaef6` · clean.
C · 95,911 files on disk · 95,910 visible after gitignore · 96,013 tracked by git · 560,787 symbols declared exactly once · **30 queries**

| tool | MRR | answer in top 10 | median rank | never found | Δ MRR vs rg --sort path (95% CI) | randomization p |
|---|---:|---:|---:|---:|---|---:|
| hay (this project) | 0.933 | 100% | 1 | 0% | **+0.392 [0.247, 0.544]** | <0.001 |
| ast-grep (structural snapshot) | 0.629 | 90% | 1.5 | 0% | snapshot only | — |
| ugrep --sort=name | 0.606 | 90% | 1.5 | 0% | +0.065 [0.000, 0.163] | 0.496 |
| codespelunker (ranked) | 0.604 | 93% | 2 | 0% | snapshot only | — |
| BSD grep | 0.601 | 87% | 2 | 0% | snapshot only | — |
| the_silver_searcher | 0.559 | 83% | 2 | 3% | snapshot only | — |
| ripgrep --sort path (deterministic baseline) | 0.541 | 83% | 2.5 | 0% | baseline | baseline |
| git grep | 0.541 | 83% | 2.5 | 0% | +0.000 [0.000, 0.000] | 1.000 |

Bold = **both** tests agree the difference is real: the interval excludes zero *and* the
randomization test puts it under 0.05. `snapshot only` means the tool has no stable-order
contract, so its point estimates are shown but no confidence interval or p-value is computed.

### Time to complete a full search

| query | hay | rg --sort path | ugrep --sort=name | ag | grep | git grep | cs | ast-grep |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `su_remove` | 2.66 s | 8.87 s | 1.52 s | 2.78 s | timeout | 2.79 s | 10.30 s | 8.96 s |
| `use_intel_pmu` | 2.45 s | 8.72 s | 65 ms | 2.67 s | 19.47 s | 2.55 s | 11.32 s | 7.71 s |
| `mgag200_init_pci_options` | 2.70 s | 9.40 s | 1.90 s | 2.62 s | 15.96 s | 2.53 s | 9.94 s | 7.80 s |

| peak memory | 17 MB | 8 MB | 8 MB | 182 MB | 3 MB | 250 MB | 145 MB | 711 MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|

## openclaw

Corpus revision `0706f629c3b5` · clean.
TS · 34,366 files on disk · 33,882 visible after gitignore · 34,391 tracked by git · 21,385 symbols declared exactly once · **30 queries**

| tool | MRR | answer in top 10 | median rank | never found | Δ MRR vs rg --sort path (95% CI) | randomization p |
|---|---:|---:|---:|---:|---|---:|
| hay (this project) | 0.928 | 100% | 1 | 0% | **+0.109 [0.035, 0.200]** | 0.017 |
| ripgrep --sort path (deterministic baseline) | 0.819 | 97% | 1 | 0% | baseline | baseline |
| git grep | 0.819 | 97% | 1 | 0% | +0.000 [0.000, 0.000] | 1.000 |
| codespelunker (ranked) | 0.816 | 97% | 1 | 0% | snapshot only | — |
| ugrep --sort=name | 0.797 | 97% | 1 | 0% | -0.022 [-0.080, 0.013] | 1.000 |
| ast-grep (structural snapshot) | 0.776 | 87% | 1 | 0% | snapshot only | — |
| the_silver_searcher | 0.730 | 87% | 1 | 0% | snapshot only | — |
| BSD grep | 0.730 | 87% | 1 | 0% | snapshot only | — |

Bold = **both** tests agree the difference is real: the interval excludes zero *and* the
randomization test puts it under 0.05. `snapshot only` means the tool has no stable-order
contract, so its point estimates are shown but no confidence interval or p-value is computed.

### Time to complete a full search

| query | hay | rg --sort path | ugrep --sort=name | ag | grep | git grep | cs | ast-grep |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `collectScopes` | 906 ms | 2.95 s | 1.06 s | 881 ms | 5.56 s | 883 ms | 2.75 s | 2.49 s |
| `handleComposerKeydown` | 844 ms | 2.79 s | 334 ms | 937 ms | 4.97 s | 884 ms | 2.70 s | 3.08 s |
| `githubResponse` | 1.10 s | 2.97 s | 1.06 s | 932 ms | 5.16 s | 889 ms | 2.63 s | 1.99 s |

| peak memory | 16 MB | 8 MB | 9 MB | 17 MB | 3 MB | 54 MB | 34 MB | 46 MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|

## ripgrep

Corpus revision `3fce3b5bb023` · clean.
RUST · 236 files on disk · 225 visible after gitignore · 237 tracked by git · 534 symbols declared exactly once · **23 queries**

| tool | MRR | answer in top 10 | median rank | never found | Δ MRR vs rg --sort path (95% CI) | randomization p |
|---|---:|---:|---:|---:|---|---:|
| hay (this project) | 0.877 | 100% | 1 | 0% | **+0.458 [0.304, 0.613]** | <0.001 |
| ast-grep (structural snapshot) | 0.695 | 91% | 1 | 0% | snapshot only | — |
| codespelunker (ranked) | 0.642 | 91% | 2 | 0% | snapshot only | — |
| the_silver_searcher | 0.489 | 70% | 4 | 0% | snapshot only | — |
| ugrep --sort=name | 0.421 | 70% | 5 | 0% | +0.002 [0.000, 0.007] | 1.000 |
| ripgrep --sort path (deterministic baseline) | 0.419 | 70% | 5 | 0% | baseline | baseline |
| git grep | 0.419 | 70% | 5 | 0% | -0.000 [-0.000, 0.000] | 1.000 |
| BSD grep | 0.418 | 70% | 7 | 0% | snapshot only | — |

Bold = **both** tests agree the difference is real: the interval excludes zero *and* the
randomization test puts it under 0.05. `snapshot only` means the tool has no stable-order
contract, so its point estimates are shown but no confidence interval or p-value is computed.

### Time to complete a full search

| query | hay | rg --sort path | ugrep --sort=name | ag | grep | git grep | cs | ast-grep |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `basic` | 11 ms | 18 ms | 8 ms | 24 ms | 33 ms | 12 ms | 37 ms | 31 ms |
| `enforce_literal_len` | 11 ms | 19 ms | 9 ms | 20 ms | 41 ms | 12 ms | 36 ms | 36 ms |
| `quiet` | 14 ms | 28 ms | 8 ms | 23 ms | 28 ms | 12 ms | 41 ms | 43 ms |

| peak memory | 7 MB | 5 MB | 5 MB | 7 MB | 2 MB | 10 MB | 22 MB | 29 MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|

## alamofire

Corpus revision `0455bfb65089` · clean.
SWIFT · 568 files on disk · 555 visible after gitignore · 568 tracked by git · 509 symbols declared exactly once · **29 queries**

| tool | MRR | answer in top 10 | median rank | never found | Δ MRR vs rg --sort path (95% CI) | randomization p |
|---|---:|---:|---:|---:|---|---:|
| hay (this project) | 0.776 | 100% | 1 | 0% | **+0.343 [0.235, 0.459]** | <0.001 |
| ripgrep --sort path (deterministic baseline) | 0.433 | 59% | 3 | 0% | baseline | baseline |
| ugrep --sort=name | 0.433 | 59% | 3 | 0% | +0.000 [0.000, 0.000] | 1.000 |
| git grep | 0.433 | 59% | 3 | 0% | +0.000 [0.000, 0.000] | 1.000 |
| codespelunker (ranked) | 0.430 | 86% | 3 | 0% | snapshot only | — |
| ast-grep (structural snapshot) | 0.409 | 79% | 3 | 7% | snapshot only | — |
| the_silver_searcher | 0.326 | 41% | 12 | 10% | snapshot only | — |
| BSD grep | 0.294 | 38% | 19 | 3% | snapshot only | — |

Bold = **both** tests agree the difference is real: the interval excludes zero *and* the
randomization test puts it under 0.05. `snapshot only` means the tool has no stable-order
contract, so its point estimates are shown but no confidence interval or p-value is computed.

### Time to complete a full search

| query | hay | rg --sort path | ugrep --sort=name | ag | grep | git grep | cs | ast-grep |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `requestDidCancel` | 16 ms | 31 ms | 7 ms | 34 ms | 139 ms | 15 ms | 63 ms | 30 ms |
| `reset` | 16 ms | 39 ms | 7 ms | 36 ms | 135 ms | 15 ms | 64 ms | 27 ms |
| `value` | 17 ms | 36 ms | 8 ms | 60 ms | 106 ms | 15 ms | 153 ms | 31 ms |

| peak memory | 11 MB | 6 MB | 4 MB | 7 MB | 3 MB | 13 MB | 44 MB | 26 MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|

## hay

> **Too few queries to conclude anything (1).** Reported for completeness; the
> numbers below are not evidence and no difference is marked as detected.

Corpus revision `87d3988c8119` · clean.
RUST · 47,295 files on disk · 91 visible after gitignore · 102 tracked by git · 59 symbols declared exactly once · **1 query**

| tool | MRR | answer in top 10 | median rank | never found | Δ MRR vs rg --sort path (95% CI) | randomization p |
|---|---:|---:|---:|---:|---|---:|
| ast-grep (structural snapshot) | 1.000 | 100% | 1 | 0% | snapshot only | — |
| hay (this project) | 0.250 | 100% | 4 | 0% | +0.241 [0.241, 0.241] | 1.000 |
| codespelunker (ranked) | 0.167 | 100% | 6 | 0% | snapshot only | — |
| the_silver_searcher | 0.029 | 0% | 35 | 0% | snapshot only | — |
| ripgrep --sort path (deterministic baseline) | 0.009 | 0% | 111 | 0% | baseline | baseline |
| git grep | 0.009 | 0% | 117 | 0% | -0.000 [-0.000, -0.000] | 1.000 |
| ugrep --sort=name | 0.007 | 0% | 139 | 0% | -0.002 [-0.002, -0.002] | 1.000 |
| BSD grep | 0.004 | 0% | 237 | 0% | snapshot only | — |

Bold = **both** tests agree the difference is real: the interval excludes zero *and* the
randomization test puts it under 0.05. `snapshot only` means the tool has no stable-order
contract, so its point estimates are shown but no confidence interval or p-value is computed.

### Time to complete a full search

| query | hay | rg --sort path | ugrep --sort=name | ag | grep | git grep | cs | ast-grep |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `write` | 10 ms | 14 ms | 14 ms | 20 ms | 30.40 s | 12 ms | 17 ms | 19 ms |

| peak memory | 6 MB | 5 MB | 5 MB | 7 MB | 29 MB | 10 MB | 27 MB | 12 MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|

## What each tool is

| tool | ranks results | skips files | deterministic order | machine-readable | index |
|---|---|---|---|---|---|
| `hay` | yes | gitignore | yes | rg-shaped | none |
| `rg` | no | gitignore | yes (--sort path) | yes | none |
| `ugrep` | no | opt-in | yes (--sort=name) | yes | none |
| `ag` | no | own rules | no | no | none |
| `grep` | no | none | no | no | none |
| `git-grep` | no | tracked only | yes | no | git |
| `cs` | yes | own rules | no contract | yes | none |
| `ast-grep` | no | gitignore | no contract | yes | parses per run |

### Not benchmarked

- **ack** — excluded after the pinned 0.1.4 probe hit the 60 s cap on 52 of 113 rank queries and 5 of 13 full-search timings; mostly censored ranks cannot support comparison
- **zoekt** — trigram index server; needs a build step and a daemon, so it is a different product category
- **Google codesearch (csearch)** — trigram index; not installed on the test machine
- **Sourcegraph, GitHub code search** — hosted services, not comparable on a local tree
- **LSP workspace symbols** — requires a language server per language and a warm project
- **embedding / semantic search** — needs an index build and a model; the opposite of this tool's premise

## Limits

- **The task favours `hay` by construction.** Stated again because it is the single most
  important caveat on this page.
- **Definition-finding is not all of search.** An agent also asks where something is *used*,
  what calls what, and where a behaviour lives with no symbol to name. None of that is here.
- **Unordered tools are snapshots, not inference.** Their MRR and top-10 values describe this
  run only; scheduler or traversal order may change them on the same immutable corpus.
- **One machine, one filesystem, macOS only.**
- **Ground truth is a parser's opinion.** `ast-grep` misses declaration forms its patterns do
  not cover, and those symbols are simply absent rather than wrong.

## Reproduce it

```bash
BENCH_CORPORA="${XDG_CACHE_HOME:-$HOME/.cache}/hay/corpora"
mkdir -p "$BENCH_CORPORA"
git clone --depth 1 https://github.com/torvalds/linux.git       "$BENCH_CORPORA/linux"
git clone --depth 1 https://github.com/openclaw/openclaw.git     "$BENCH_CORPORA/openclaw"
git clone --depth 1 https://github.com/BurntSushi/ripgrep.git   "$BENCH_CORPORA/ripgrep"
git clone --depth 1 https://github.com/Alamofire/Alamofire.git   "$BENCH_CORPORA/alamofire"
cargo build --release --manifest-path hay/Cargo.toml
bun benchmark.ts --corpora "$BENCH_CORPORA" --sample 30
bun benchmark-report.ts                 # writes BENCHMARK.md and benchmark.html
```

Tools absent from the machine are reported as *not installed* rather than skipped silently.
