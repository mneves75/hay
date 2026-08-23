# Code search benchmark

Every code-search tool installed on the test machine, over 5 repositories, measured on one
task: **given a symbol, how far down the results is its declaration?**

> ### Read this before the numbers
> `hay` is built to rank declarations first, and this benchmark's ground truth *is* the
> declaration. It is measuring the thing `hay` optimises for, so it should win, and a win here
> is weaker evidence than it looks. The number worth reading is the margin — and whether
> `ast-grep`, which actually parses the code, beats a text tool with priors anyway.
>
> The project's other evaluation does not have this problem: it uses real agent searches paired
> with the files the agent opened next, so the ground truth was not designed around the tool.
> That one is in `README.md`. It is also unreproducible by anyone else, because the transcripts
> are private. Neither evaluation is sufficient alone; that is why both exist.

**New to any of this?** [BENCHMARK_FEYNMAN.md](BENCHMARK_FEYNMAN.md) builds every idea below from
scratch — no jargon, one analogy at a time — including the traps that nearly poisoned the numbers
and the places this benchmark is wrong.

## Method

- **Task** — definition finding: given a symbol declared exactly once, rank of the declaring file.
- **Ground truth** — ast-grep (a parser), independent of every heuristic under test. A symbol declared in more than one place is discarded:
  there is no single right answer, so scoring against an arbitrary one would be noise.
- **Queries** — symbols with between 5 and 2,000 total occurrences. Fewer than five is not a
  retrieval problem; more than two thousand is a different and pathological one. Sampling is
  seeded, so the same corpus yields the same queries on every run.
- **Metric** — reciprocal rank of the first result line landing in the declaring file, capped
  at 1000 results. Mean reciprocal rank and the share answered within the first ten.
- **Difference** — absolute, against ripgrep in its default order, with a 95% paired bootstrap
  interval over per-query reciprocal ranks (10,000 replicates, fixed seed). An interval that
  spans zero is not a detected difference, whatever the point estimate suggests.
- **Significance** — Fisher's paired randomization test on the same differences, reported
  beside the interval. Smucker et al. (CIKM 2007) use the randomization test as the reference
  against which the bootstrap and the t-test are validated, and their follow-up (SIGIR 2009)
  finds the bootstrap biased toward smaller p-values at small samples — which is most of the
  corpora here. Where the two disagree, believe the randomization test.
- **Flag parity** — every tool is asked for the same job: recursive, fixed-string,
  case-sensitive, `path:line:text`. Filtering is deliberately *not* normalised across tools,
  because what a tool skips is a real property of it; the file counts each tool sees are
  reported per corpus. The **one exception is ripgrep**, which is given
  `--no-ignore-dot --no-ignore-global --no-ignore-exclude` so it walks exactly what `hay`
  walks. `hay` disables those sources internally so operator-local state cannot change
  results; without the flags the head-to-head measured which files were searched rather than
  how they were ranked — 231 files against 225 on the ripgrep corpus, which ships a `.ignore`.
- **Invocation** — every binary is called by absolute path. On the test machine `grep` is a
  shell function that resolves to ugrep, so calling tools by name would have measured the
  wrong program.

### Versions

| tool | version |
|---|---|
| `hay` | hay 0.6.0 |
| `rg` | ripgrep 15.2.0 |
| `rg-sorted` | ripgrep 15.2.0 |
| `ugrep` | ugrep 7.8.4 aarch64-apple-darwin25.6.0 +neon/AArch64; -P:pcre2jit; -z:zlib,bzip2,lzma,lz4,zstd,brotli,7z,tar/pax/cpio/zip |
| `ag` | ag version 2.2.0 |
| `ack` | ack v3.10.0 (standalone version) |
| `grep` | grep (BSD grep, GNU compatible) 2.6.0-FreeBSD |
| `git-grep` | git version 2.55.0 |
| `cs` | cs version 1.4.0 |
| `ast-grep` | ast-grep 0.45.1 |

## Documentation track

A public development set for documentation retrieval: identifier-like tokens from ATX
headings that occur in exactly one markdown file's headings and in at least three
parity-visible files. Ranks use the same 1000-result-line cap as the code
track; cap truncations are reported as `hay / rg`, never absorbed into another metric.

| corpus | n | MRR hay | MRR rg | Δ MRR (95% CI) | bootstrap p | randomization p | both tests | cap truncations (hay / rg) |
|---|---:|---:|---:|---|---:|---:|---|---:|
| ripgrep | 30 | 0.059 | 0.499 | -0.440 [-0.586, -0.298] | <0.001 | <0.001 | ✓ agree — detected | 5 / 3 |
| alamofire | 30 | 0.062 | 0.402 | -0.340 [-0.471, -0.217] | <0.001 | <0.001 | ✓ agree — detected | 2 / 0 |
| hay | 30 | 0.095 | 0.117 | -0.023 [-0.078, 0.019] | 0.352 | 0.479 | ✓ agree — not detected | 0 / 0 |

### Query-shape splits

Mutually exclusive precedence: flag-shaped → uppercase → snake case → hyphenated → camel
case → pascal case → plain word.

| corpus | feature | n | MRR hay | MRR rg | Δ MRR |
|---|---|---:|---:|---:|---:|
| ripgrep | `flagShaped` | 0 | 0.000 | 0.000 | +0.000 |
| ripgrep | `hyphenated` | 1 | 0.125 | 0.013 | +0.112 |
| ripgrep | `snakeCase` | 0 | 0.000 | 0.000 | +0.000 |
| ripgrep | `upperCase` | 1 | 0.100 | 0.250 | -0.150 |
| ripgrep | `camelCase` | 0 | 0.000 | 0.000 | +0.000 |
| ripgrep | `pascalCase` | 8 | 0.092 | 0.875 | -0.783 |
| ripgrep | `plainWord` | 20 | 0.040 | 0.385 | -0.345 |
| alamofire | `flagShaped` | 0 | 0.000 | 0.000 | +0.000 |
| alamofire | `hyphenated` | 0 | 0.000 | 0.000 | +0.000 |
| alamofire | `snakeCase` | 0 | 0.000 | 0.000 | +0.000 |
| alamofire | `upperCase` | 0 | 0.000 | 0.000 | +0.000 |
| alamofire | `camelCase` | 0 | 0.000 | 0.000 | +0.000 |
| alamofire | `pascalCase` | 27 | 0.068 | 0.433 | -0.365 |
| alamofire | `plainWord` | 3 | 0.005 | 0.118 | -0.113 |
| hay | `flagShaped` | 0 | 0.000 | 0.000 | +0.000 |
| hay | `hyphenated` | 0 | 0.000 | 0.000 | +0.000 |
| hay | `snakeCase` | 0 | 0.000 | 0.000 | +0.000 |
| hay | `upperCase` | 0 | 0.000 | 0.000 | +0.000 |
| hay | `camelCase` | 0 | 0.000 | 0.000 | +0.000 |
| hay | `pascalCase` | 6 | 0.074 | 0.096 | -0.022 |
| hay | `plainWord` | 24 | 0.100 | 0.123 | -0.023 |

## linux

C · 95,661 files on disk · 95,660 visible after gitignore · 95,776 tracked by git · 559,944 symbols declared exactly once · **30 queries**

| tool | MRR | answer in top 10 | median rank | never found | Δ MRR vs ripgrep (95% CI) | randomization p |
|---|---:|---:|---:|---:|---|---:|
| hay (this project) | 0.967 | 100% | 1 | 0% | **+0.296 [0.150, 0.446]** | 0.001 |
| ripgrep --sort path | 0.737 | 93% | 1 | 0% | +0.067 [-0.092, 0.222] | 0.464 |
| git grep | 0.737 | 93% | 1 | 0% | +0.067 [-0.092, 0.222] | 0.464 |
| ast-grep (structural) | 0.721 | 90% | 1 | 0% | +0.050 [-0.009, 0.133] | 0.345 |
| ugrep | 0.689 | 87% | 1 | 0% | +0.019 [-0.107, 0.145] | 0.797 |
| ripgrep (default order) | 0.670 | 90% | 1 | 0% | baseline | baseline |
| codespelunker (ranked) | 0.643 | 90% | 2 | 0% | -0.027 [-0.139, 0.074] | 0.629 |
| ack | 0.637 | 80% | 1 | 0% | -0.033 [-0.172, 0.105] | 0.609 |
| the_silver_searcher | 0.607 | 80% | 1.5 | 0% | -0.063 [-0.213, 0.084] | 0.390 |
| BSD grep | 0.534 | 70% | 1 | 17% | -0.136 [-0.312, 0.038] | 0.135 |

Bold = **both** tests agree the difference is real: the interval excludes zero *and* the
randomization test puts it under 0.05.

Timeouts: BSD grep 5.

### Time to complete a full search

| query | hay | rg | rg-sorted | ugrep | ag | ack | grep | git-grep | cs | ast-grep |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `contpte_ptep_get` | 2.66 s | 2.78 s | 16.50 s | 5.03 s | 4.22 s | 30.62 s | 25.31 s | 2.31 s | 14.02 s | 17.28 s |
| `iwl_trans_stop_device` | 3.09 s | 2.93 s | 17.49 s | 3.80 s | 3.58 s | 32.74 s | timeout | 2.76 s | 18.04 s | 20.79 s |
| `ip_vs_nat_xmit` | 2.74 s | 2.91 s | 28.39 s | 2.16 s | 3.75 s | 39.20 s | timeout | 2.83 s | 16.42 s | 21.87 s |

| peak memory | 15 MB | 16 MB | 8 MB | 10 MB | 175 MB | 23 MB | 3 MB | 251 MB | 197 MB | 630 MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|

## openclaw

TS · 33,430 files on disk · 32,955 visible after gitignore · 33,455 tracked by git · 20,752 symbols declared exactly once · **30 queries**

| tool | MRR | answer in top 10 | median rank | never found | Δ MRR vs ripgrep (95% CI) | randomization p |
|---|---:|---:|---:|---:|---|---:|
| hay (this project) | 0.879 | 97% | 1 | 0% | **+0.210 [0.067, 0.354]** | 0.008 |
| ast-grep (structural) | 0.726 | 90% | 1 | 3% | +0.058 [-0.006, 0.139] | 0.171 |
| codespelunker (ranked) | 0.696 | 93% | 1 | 0% | +0.027 [-0.094, 0.141] | 0.661 |
| ripgrep (default order) | 0.669 | 90% | 1 | 0% | baseline | baseline |
| ripgrep --sort path | 0.649 | 93% | 1 | 0% | -0.020 [-0.152, 0.110] | 0.859 |
| git grep | 0.622 | 93% | 1 | 0% | -0.046 [-0.168, 0.065] | 0.513 |
| ugrep | 0.620 | 93% | 1 | 0% | -0.049 [-0.187, 0.085] | 0.553 |
| the_silver_searcher | 0.607 | 93% | 1.5 | 0% | -0.061 [-0.190, 0.058] | 0.346 |
| ack | 0.594 | 93% | 2 | 0% | -0.074 [-0.199, 0.039] | 0.290 |
| BSD grep | 0.594 | 93% | 2 | 0% | -0.074 [-0.199, 0.039] | 0.290 |

Bold = **both** tests agree the difference is real: the interval excludes zero *and* the
randomization test puts it under 0.05.

### Time to complete a full search

| query | hay | rg | rg-sorted | ugrep | ag | ack | grep | git-grep | cs | ast-grep |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `createBetaAutoUpdateConfig` | 851 ms | 791 ms | 3.58 s | 1.62 s | 1.03 s | 5.57 s | 7.26 s | 791 ms | 2.50 s | 3.49 s |
| `expectEnvGatewayCredentials` | 681 ms | 726 ms | 2.92 s | 1.31 s | 937 ms | 5.09 s | 6.29 s | 522 ms | 2.71 s | 3.25 s |
| `buildMatrixReplyDetails` | 852 ms | 946 ms | 4.00 s | 609 ms | 935 ms | 6.07 s | 5.78 s | 741 ms | 3.04 s | 3.70 s |

| peak memory | 16 MB | 16 MB | 8 MB | 8 MB | 20 MB | 19 MB | 3 MB | 60 MB | 42 MB | 46 MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|

## ripgrep

RUST · 236 files on disk · 225 visible after gitignore · 237 tracked by git · 534 symbols declared exactly once · **23 queries**

| tool | MRR | answer in top 10 | median rank | never found | Δ MRR vs ripgrep (95% CI) | randomization p |
|---|---:|---:|---:|---:|---|---:|
| hay (this project) | 0.800 | 100% | 1 | 0% | **+0.390 [0.235, 0.548]** | <0.001 |
| ast-grep (structural) | 0.769 | 96% | 1 | 0% | **+0.359 [0.172, 0.542]** | 0.002 |
| codespelunker (ranked) | 0.642 | 91% | 2 | 0% | **+0.232 [0.097, 0.373]** | 0.004 |
| the_silver_searcher | 0.529 | 70% | 3 | 0% | +0.119 [0.008, 0.246] | 0.073 |
| ripgrep --sort path | 0.419 | 70% | 5 | 0% | +0.008 [-0.010, 0.029] | 0.419 |
| git grep | 0.419 | 70% | 5 | 0% | +0.008 [-0.010, 0.029] | 0.419 |
| ack | 0.418 | 70% | 7 | 0% | +0.008 [-0.013, 0.030] | 0.512 |
| BSD grep | 0.418 | 70% | 7 | 0% | +0.008 [-0.013, 0.030] | 0.512 |
| ripgrep (default order) | 0.410 | 65% | 7 | 0% | baseline | baseline |
| ugrep | 0.383 | 65% | 7 | 0% | -0.027 [-0.103, 0.024] | 0.681 |

Bold = **both** tests agree the difference is real: the interval excludes zero *and* the
randomization test puts it under 0.05.

> **The two tests disagree here, and the table takes the conservative reading.** the_silver_searcher (interval excludes zero, randomization p=0.073). Smucker et al.'s follow-up finds the bootstrap biased toward smaller p-values at small
> samples, which this is, so these are reported as **not detected**.

### Time to complete a full search

| query | hay | rg | rg-sorted | ugrep | ag | ack | grep | git-grep | cs | ast-grep |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `basic` | 14 ms | 15 ms | 20 ms | 10 ms | 30 ms | 70 ms | 45 ms | 16 ms | 42 ms | 36 ms |
| `enforce_literal_len` | 14 ms | 16 ms | 22 ms | 13 ms | 31 ms | 76 ms | 59 ms | 15 ms | 36 ms | 38 ms |
| `quiet` | 15 ms | 16 ms | 26 ms | 11 ms | 32 ms | 81 ms | 34 ms | 15 ms | 49 ms | 45 ms |

| peak memory | 6 MB | 7 MB | 6 MB | 5 MB | 7 MB | 13 MB | 2 MB | 10 MB | 23 MB | 32 MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|

## alamofire

SWIFT · 568 files on disk · 555 visible after gitignore · 568 tracked by git · 509 symbols declared exactly once · **29 queries**

| tool | MRR | answer in top 10 | median rank | never found | Δ MRR vs ripgrep (95% CI) | randomization p |
|---|---:|---:|---:|---:|---|---:|
| hay (this project) | 0.691 | 93% | 1 | 0% | **+0.397 [0.264, 0.534]** | <0.001 |
| ack | 0.451 | 62% | 2 | 0% | **+0.157 [0.038, 0.285]** | 0.020 |
| BSD grep | 0.451 | 62% | 2 | 0% | **+0.157 [0.038, 0.285]** | 0.020 |
| ugrep | 0.446 | 62% | 2 | 0% | **+0.152 [0.035, 0.281]** | 0.025 |
| the_silver_searcher | 0.443 | 62% | 2 | 0% | **+0.150 [0.031, 0.279]** | 0.028 |
| ripgrep --sort path | 0.433 | 59% | 3 | 0% | **+0.140 [0.033, 0.257]** | 0.018 |
| git grep | 0.433 | 59% | 3 | 0% | **+0.140 [0.033, 0.257]** | 0.018 |
| codespelunker (ranked) | 0.430 | 86% | 3 | 0% | **+0.136 [0.034, 0.237]** | 0.015 |
| ast-grep (structural) | 0.381 | 76% | 6 | 7% | +0.088 [-0.043, 0.217] | 0.198 |
| ripgrep (default order) | 0.294 | 52% | 7 | 0% | baseline | baseline |

Bold = **both** tests agree the difference is real: the interval excludes zero *and* the
randomization test puts it under 0.05.

### Time to complete a full search

| query | hay | rg | rg-sorted | ugrep | ag | ack | grep | git-grep | cs | ast-grep |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `requestDidCancel` | 27 ms | 28 ms | 113 ms | 12 ms | 59 ms | 256 ms | 367 ms | 39 ms | 140 ms | 51 ms |
| `reset` | 35 ms | 38 ms | 180 ms | 15 ms | 76 ms | 207 ms | 235 ms | 19 ms | 74 ms | 31 ms |
| `value` | 24 ms | 24 ms | 78 ms | 8 ms | 68 ms | 176 ms | 145 ms | 18 ms | 154 ms | 31 ms |

| peak memory | 10 MB | 10 MB | 6 MB | 5 MB | 7 MB | 14 MB | 3 MB | 14 MB | 48 MB | 27 MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|

## hay

> **Too few queries to conclude anything (1).** Reported for completeness; the
> numbers below are not evidence and no difference is marked as detected.

RUST · 5,356 files on disk · 54 visible after gitignore · 56 tracked by git · 46 symbols declared exactly once · **1 query**

| tool | MRR | answer in top 10 | median rank | never found | Δ MRR vs ripgrep (95% CI) | randomization p |
|---|---:|---:|---:|---:|---|---:|
| hay (this project) | 1.000 | 100% | 1 | 0% | +0.986 [0.986, 0.986] | 1.000 |
| ast-grep (structural) | 1.000 | 100% | 1 | 0% | +0.986 [0.986, 0.986] | 1.000 |
| codespelunker (ranked) | 0.333 | 100% | 3 | 0% | +0.319 [0.319, 0.319] | 1.000 |
| the_silver_searcher | 0.048 | 0% | 21 | 0% | +0.034 [0.034, 0.034] | 1.000 |
| ripgrep --sort path | 0.018 | 0% | 56 | 0% | +0.004 [0.004, 0.004] | 1.000 |
| ugrep | 0.018 | 0% | 57 | 0% | +0.003 [0.003, 0.003] | 1.000 |
| git grep | 0.018 | 0% | 57 | 0% | +0.003 [0.003, 0.003] | 1.000 |
| ripgrep (default order) | 0.014 | 0% | 71 | 0% | baseline | baseline |
| BSD grep | 0.009 | 0% | 117 | 0% | -0.006 [-0.006, -0.006] | 1.000 |
| ack | 0.008 | 0% | 118 | 0% | -0.006 [-0.006, -0.006] | 1.000 |

Bold = **both** tests agree the difference is real: the interval excludes zero *and* the
randomization test puts it under 0.05.

### Time to complete a full search

| query | hay | rg | rg-sorted | ugrep | ag | ack | grep | git-grep | cs | ast-grep |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `write` | 9 ms | 9 ms | 8 ms | 7 ms | 17 ms | 490 ms | 3.22 s | 9 ms | 13 ms | 12 ms |

| peak memory | 6 MB | 7 MB | 5 MB | 4 MB | 7 MB | 15 MB | 10 MB | 9 MB | 22 MB | 10 MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|

## What each tool is

| tool | ranks results | skips files | deterministic order | machine-readable | index |
|---|---|---|---|---|---|
| `hay` | yes | gitignore | yes | rg-shaped | none |
| `rg` | no | gitignore | no | yes | none |
| `rg-sorted` | no | gitignore | yes | yes | none |
| `ugrep` | no | opt-in | yes | yes | none |
| `ag` | no | own rules | no | no | none |
| `ack` | no | file types | yes | no | none |
| `grep` | no | none | yes | no | none |
| `git-grep` | no | tracked only | yes | no | git |
| `cs` | yes | own rules | yes | yes | none |
| `ast-grep` | no | gitignore | yes | yes | parses per run |

### Not benchmarked

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
