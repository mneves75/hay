# Use `hay` and the measurement kit

Written for someone who has never opened this project. Every command below has been run on macOS
and produced the output shown. If something differs on your machine, that is a bug in this
document — the numbers here are not aspirational.

---

## 0. What is actually in here

Two separate things ended up in this repository, and it matters which one you want.

**`hay` — a ranked grep.** A drop-in replacement for `rg` that reorders results so the likely
answer comes first. This is the useful thing. If you only read one section, read [§3](#3-hay).

**A measurement kit.** Four TypeScript tools that were used to test whether "repository search
hygiene" is a real, measurable property. The answer was **no** — see
[README.md](README.md) for the negative result. The tools are kept because the apparatus is
reusable even though the original metric was wrong.

You do not need the measurement kit to use `hay`.

---

## 1. Prerequisites

| you need | why | check it |
|---|---|---|
| **ripgrep** (`rg`) | the measurement kit shells out to it; also the baseline `hay` is compared against | `rg --version` |
| **Rust** (`cargo`) | to build `hay` | `cargo --version` |
| **Bun** | runs the TypeScript tools | `bun --version` |

Install anything missing:

```bash
brew install ripgrep                                        # macOS
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust
curl -fsSL https://bun.sh/install | bash                    # Bun
```

Bun is only needed for the measurement kit. **If you just want `hay`, you need Rust and nothing
else** — `hay` does not shell out to ripgrep, it uses ripgrep's own libraries directly.

---

## 2. Get set up

```bash
git clone https://github.com/mneves75/hay.git
cd hay
cargo build --release --manifest-path hay/Cargo.toml
```

First build takes about 20 seconds (it compiles ripgrep's crates). The binary lands at
`hay/target/release/hay`.

Check it works:

```bash
./hay/target/release/hay --help
```

Or install it onto your PATH so you can type `hay` anywhere:

```bash
cargo install --locked --path hay # lands in ~/.cargo/bin/hay
```

If you would rather not install, symlink the built binary instead:

```bash
ln -sf "$PWD/hay/target/release/hay" ~/.local/bin/hay   # or wherever your PATH points
```

---

## 3. `hay`

### The idea in one paragraph

`rg config` prints matches in **path order**, which is arbitrary. If a dead `plan-v3-FINAL.md`
sorts before `src/config.ts`, the plan comes first. An agent reads the first page and acts on it.
`hay` runs the corresponding ripgrep-engine search and reorders the output so the line that
*declares* the thing, in source code rather than in an archived document, comes first.

For complete searches, it returns **exactly the same matches as an equivalently configured
ripgrep invocation** — never more, never fewer. The differential test normalizes non-`.gitignore`
ignore inputs and VCS exclusions on both sides: [§6](#6-checking-it-still-works).

### Basic use

```bash
hay config                    # search from here down, best matches first
hay classify_path hay/src     # search a subdirectory
hay -i config                 # case-insensitive
hay -l config                 # just file names, best file first
```

Output is `path:line:text`, identical in shape to `rg -n`:

```text
hay/src/score.rs:29:pub fn classify_path(path: &str) -> PathClass {
hay/src/score.rs:170:    s += w.path * path_weight(classify_path(inp.path));
```

The definition came first even though line 170 sorts earlier in the file. That is the whole point.

### Why it put that first — `--explain`

If a result surprises you, ask:

```bash
hay --explain classify_path hay/src
```

```text
8.00 [def +6.0 path +1.0 tf +1.00]  hay/src/score.rs:29:pub fn classify_path(path: &str) -> PathClass {
   2.00 [def +0.0 path +1.0 tf +1.00]  hay/src/score.rs:303:    let path = w.path * path_weight(classify_path(inp.path));
   2.00 [def +0.0 path +1.0 tf +1.00]  hay/src/score.rs:346:        assert_eq!(classify_path("src/auth/session.ts"), PathClass::Source);
   ... (12 more, all 2.00)
```

The number on the left is the total score — higher is earlier — and the bracket shows what each
signal contributed to it. Here the declaration scores **8.00** because the definition signal fired
(`def +6.0`); every use scores **2.00** because it did not. That is the whole ranking, visible per
result, so a surprising order can be attributed to a specific signal rather than guessed at. The
score is built from exactly three things:

| signal | what it does |
|---|---|
| **definition** (+6) | the line looks like it *declares* the thing (`function foo`, `class Foo`, `foo:`) rather than using it |
| **path class** (±1 to ±4) | `src/` outranks `test/`, which outranks `docs/`, which outranks `.json` data, which outranks `archive/` and `.scratch/` |
| **term frequency** (up to +1) | a file that mentions the term repeatedly is mildly more likely to be its home |

Three *other* signals were built, measured, and deleted because they made no difference. That is
documented in [DESIGN-hay.md](DESIGN-hay.md); the short version is that intuition about ranking is
unreliable and the only honest way to keep a signal is to measure it.

### Useful flags

```bash
hay -F 'foo|bar'              # literal string, not a regex
hay -w config                 # whole words only
hay -e config -e settings     # several patterns at once (matches the union)
hay -g '*.ts' config          # only files matching a glob
hay -t rust config            # only Rust files (hay --type-list shows them all)
hay -C3 config                # three lines of context either side
hay --json config             # ripgrep-shaped JSON Lines, for programs
hay --hidden config           # include dotfiles (.git is still excluded)
hay --no-ignore config        # ignore .gitignore
hay -m 100 config             # show 100 results (default 50; 0 = no limit)
hay --no-path config          # turn off one ranking signal, to see what it was doing
```

### Where it differs from ripgrep

Important deliberate divergences:

| | ripgrep | hay |
|---|---|---|
| result order | path order | rank order |
| `-m N` | at most N matches **per file** | at most N results **in total** |
| exhaustiveness | every match | 20,000 candidates retained by prescore |
| `--json` | `begin`, `match`, `context`, `end`, `summary` | `match` and `context` only |
| additional ignore sources | honours global gitignore, `.git/info/exclude`, `.ignore`, and `.rgignore` | disables them for deterministic results; repository `.gitignore` still applies |

A search matching more than 20,000 lines ranks only the 20,000 strongest-by-prescore candidates,
says so on stderr, and exits 2 because the result is incomplete. `-m 0` prints everything `hay`
ranked rather than every match in the tree. The cap keeps memory flat in match count; use `rg` for
exhaustive broad searches.

`begin`/`end`/`summary` are file-scoped messages, and rank-ordered output is not grouped by file,
so there is no honest moment to emit them. Consumers that filter for `"type":"match"` — which is
most of them — work unchanged.

`-C` needs one more rule than ripgrep does, because ripgrep prints in file order and `hay` does
not. Results are emitted strictly by rank, and a context window never reorders them: a line shared
by two windows in the same file is printed once, and a line that is itself a ranked result is
never shown as context — it appears at its own rank, with the `:` that says it matched. So two
results in the same file can be separated by a result from another file, exactly as their scores
say. Merging them into one block would read more like ripgrep and would quietly drag a weak result
ahead of a strong one, which is the one thing this tool must not do.

A related consequence: in `hay`, `:` means *ranked result* and `-` means *context*, where in
ripgrep they mean *match* and *non-match*. A line that contains the pattern but did not make the
ranked page appears as context. That is the honest reading for a tool that shows the best N results
rather than all of them.

Exit codes follow ripgrep: **0** = a complete search found something, **1** = a complete search
found nothing, **2** = wrong or incomplete (bad path, unreadable file, broken pattern, candidate
cap). A mistyped directory gives you exit 2 and an error, not a silent "no matches".

### Using it with a coding agent

This is what `hay` is for. There is nothing to install on the agent side — just tell it to use
`hay` instead of `rg`. Add a line to your `AGENTS.md` or `CLAUDE.md`:

```markdown
## Searching

Use `hay` instead of `rg` for concept searches ("where is auth handled", "find the retry logic").
Same flags, same `path:line:text` output — results are ordered so the definition comes first, so
the first few lines are usually enough. Use plain `rg` when you need every match or exact ordering.
```

Works the same for Claude Code, Codex, Cursor, or anything else that shells out to a terminal.

### When *not* to use it

- **You want every match, in file order** — use `rg`. `hay` shows the best 50 by default.
- **You are piping to `head` in a tight loop** — `hay` must see all matches before it can rank
  them, so it cannot stream the first result the way `rg` does. On a large repo that is a fraction
  of a second, but it is a real difference.
- **You are counting** (`rg -c`) — `hay` does not do counts.

---

## 4. The measurement kit

Only needed if you want to reproduce the research or measure your own repositories.

**Everything here reads your local agent transcripts**, which contain real searches and file paths
from whatever you have been working on. The output goes to `corpus/`, which is **gitignored**.
Do not publish it without reading [§7](#7-privacy).

### Step 1 — build a test collection

```bash
bun harvest-queries.ts
```

```text
scanning 3144 transcripts...
2508 judged queries across 68 repos -> corpus/queries.json
```

What it did: read `~/.claude/projects/**/*.jsonl`, pulled out every `rg`/`grep` command an agent
ran, and paired each search with the files the agent opened immediately afterwards. Those pairs are
the "right answers" — not because anyone labelled them, but because that is what the agent actually
went on to read.

Takes about five seconds.

### Step 2 — score your repositories

```bash
bun measure-mrr.ts --min-queries 60
```

```text
12 repos with >= 60 judged queries
some-repo    MRR 0.184  median rank 28  top10 34%  unreachable 8%  n=145/251
...
```

**MRR** (Mean Reciprocal Rank) is the headline: if the answer is always the first result, MRR is
1.0. If it is always second, 0.5. Real repositories with plain `rg` score **0.18 to 0.38**.

**median rank** is the plainer version of the same thing: how many result lines you read before
reaching the answer. **top10** is how often the answer is on the first page.

### Step 3 — see whether `hay` helps on *your* repos

```bash
bun measure-mrr.ts --min-queries 60 --retriever hay      # score one retriever
bun measure-mrr.ts --min-queries 60 --compare            # score both, paired, with intervals
```

`--compare` is the one to trust. It runs both retrievers over the identical judged queries and
reports the **absolute** difference with a 95% bootstrap interval — by query, and again clustered
by repository, because queries inside one repo share a corpus and are not independent:

```text
paired over 951 queries in 12 repositories
  MRR      rg 0.2656  ->  hay 0.4036
  top-10   rg 0.4606  ->  hay 0.6004
  nDCG@10  rg 0.3733  ->  hay 0.5033
  dMRR (by query)        +0.1380  95% CI [0.1120, 0.1646]  boot p=0.0002  rand p=0.0001  observations=951  clusters=951
  dMRR (by repo)         +0.1380  95% CI [0.1106, 0.1619]  boot p=0.0002  rand p=0.0005  observations=951  clusters=12
  dTop10 (by query)      +0.1399  95% CI [0.1073, 0.1735]  boot p=0.0002  rand p=0.0001  observations=951  clusters=951
  dTop10 (by repo)       +0.1399  95% CI [0.0844, 0.1845]  boot p=0.0002  rand p=0.0005  observations=951  clusters=12
  dNDCG10 (by query)     +0.1300  95% CI [0.1092, 0.1517]  boot p=0.0002  rand p=0.0001  observations=951  clusters=951
  dNDCG10 (by repo)      +0.1300  95% CI [0.0912, 0.1667]  boot p=0.0002  rand p=0.0005  observations=951  clusters=12
  better 557 / worse 235 / tied 159
  nDCG first page truncated on 0 of 951 queries
  hay candidate cap hit on 0 of 951 queries

  GATE (DESIGN-hay.md, median across 12 repos): MRR 0.3810 (need >= 0.50)  top-10 0.5916 (need >= 0.80)  ->  FAIL
  rg for reference: median MRR 0.2645  top-10 0.4934  ·  repos where hay is worse than rg: 0
```

**Three measures, because each is blind to something.** MRR is the rank of the first answer, and
Fuhr argues averaging a reciprocal rank is invalid because it is an ordinal scale. The top-10 rate
is a plain proportion, immune to that objection. nDCG@10 is graded by position and uses *every*
judgment — which matters because the mean query here has 2.27 answer files, so MRR ignores most of
what was judged. They should move together; when they do not, say so.

**Two p-values, because one of them is the reference.** `boot p` inverts the bootstrap interval;
`rand p` is Fisher's paired randomization test, which Smucker et al. use as the standard the
bootstrap is validated *against*, and which their 2009 follow-up suggests is the less flattering of
the two at small samples. Believe `rand p` where they disagree. Neither can report zero:
`p=0.0002` is `2/(10000+1)`, the smallest two-sided value a 10,000-replicate simulation resolves.

**Read the last two lines too.** `hay` is **worse on 24% of individual queries** — it wins clearly
on average and is not a free lunch per search. And a non-zero truncation count means some queries'
nDCG is a floor rather than a measurement, because the first page of ten distinct files could not
be filled inside the line budget.

### The most useful single command

```bash
bun measure-mrr.ts ~/dev/some-project
```

```text
some-project  MRR 0.184 · 146 judged queries · answer in top 10 for 34%

Most expensive searches in this repo — result lines an agent reads before the answer:

  >1000   config
  >1000   export
    989   insert
```

Each line is a concrete thing to fix in *that* repository: rename the concept so it is
distinctive, or make its definition findable. This is the one output that survived the project's
own criticism — repo-level scores compare badly between projects, but within one project these
numbers point at real work.

### Step 4 — find documentation nothing reads

```bash
bun doc-authority.ts ~/dev/some-project
```

```text
some-project: 32 prose files, 8 never opened by any agent (base rate 25%)
  suspect path/name      precision 43%  recall 75%  lift 1.71  (fires on 14)
  no inbound links       precision 31%  recall 100% lift 1.23  (fires on 26)
```

**"never opened by any agent"** is the number that matters. Across the repos measured here it was
**78%** — more than three quarters of all documentation had never been read by the thing it was written for.
The heuristics below it (`lift ~1.1`) are barely better than guessing, which is the finding: you
do not need a clever detector when you can just observe what nothing ever opens.

Caveat worth keeping in mind: humans read documentation too, and this only sees your agent
sessions.

### The falsified tool

`grep-hygiene.ts` is the original repository score. It does not predict retrieval difficulty
(ρ −0.035). It is kept so the negative result is reproducible. **Do not use its numbers to judge a
codebase.**

---

## 5. Reproducing the research

```bash
bun harvest-queries.ts                                     # test collection
bun measure-mrr.ts --min-queries 60 --json > corpus/mrr.json          # rg baseline
bun measure-mrr.ts --min-queries 60 --json --retriever hay > corpus/mrr-hay.json
bun measure-mrr.ts --min-queries 60 --compare --json > corpus/paired.json   # the A/B with intervals
bun measure-mrr.ts --min-queries 60 --json --ablate no-path           # one signal off
```

The bootstrap uses a seeded PRNG, so `--compare` is reproducible against a fixed checkout. It is
not reproducible across a day of commits to the measured repositories — see §8.

Note which of those payloads may be published. The per-repo `--json` output carries **real search
terms harvested from your own repositories**, so it goes to `corpus/` (gitignored) and the command
warns you on stderr. The absolute checkout path used to be in there too and is now stripped, since
naming a private repository is what invariant 4 forbids. Only the `--compare` payload is
aggregates-only and safe to commit — that is why `evidence/` contains that one and nothing else.

`--ablate` turns off a single ranking signal so you can see what it was contributing. Valid values:
`no-definition`, `no-path`, `no-tf`.

**Public-corpus comparison**: `./benchmark-corpora.sh` clones whatever corpora `benchmark.ts`
wants and is missing into `${XDG_CACHE_HOME:-$HOME/.cache}/hay/corpora` (`BENCH_CORPORA`
overrides), runs
`benchmark.ts --sample 30`, renders `BENCHMARK.md`, then deletes only what it cloned. Extra args
are passed through to `benchmark.ts`. The corpus list lives in `benchmark.ts`; the script reads
it from there rather than keeping its own copy.

**Paired before/after runs**: evidence files record the exact query symbols each run asked.
To compare two hay builds on identical queries — the only honest way to isolate a code change
from sample luck — pin the first run's sample:

```bash
bun benchmark.ts --sample 30 --out /tmp/before.json          # records symbols per corpus
# ...change the code, rebuild...
bun benchmark.ts --sample 30 --queries-from /tmp/before.json --out /tmp/after.json
```

Symbols whose declaration is no longer unique in the tree are skipped with a count on stderr,
never silently. Unpinned runs stay reproducible the old way: fixed seed, sorted symbol keys.

**Error analysis** (issue 10) starts from the paired records `--compare` computes:

```bash
bun measure-mrr.ts --min-queries 60 --compare --dump-pairs corpus/pairs.json
bun categorize-misses.ts        # counted taxonomy -> evidence/error-taxonomy.json (counts only)
```

The dump carries real queries and paths, so `--dump-pairs` only writes beneath gitignored
`corpus/`, using private directory/file modes and rejecting traversal or symlinked parents. The
taxonomy artifact in `evidence/` is category counts only. Diagnose an individual query with
`hay --explain -e '<query>'` — the bracketed breakdown says which signal put each line where it is.

**External validity** runs hay against a public, agent-shaped localization benchmark
(SWE-Explore-Bench, arXiv 2606.07297 — issues from SWE-bench Verified/Multilingual, gold files
from successful agent trajectories):

```bash
bun swe-explore.ts --sample 100     # downloads instance list, issues, repo snapshots (cached)
```

Everything it writes to `evidence/` is public data — instance ids, aggregates, intervals — and
the sampled instance list is committed so a rerun scores exactly the same set. Archive downloads
and expanded contents have independent byte caps; member count, path depth, compression ratio,
links, special entries, and traversal are rejected before the temporary checkout is promoted.
Read the `claim` field before quoting a number: it tests reordering under identical queries, not
issue localization.

Full method, limits and the list of everything that went wrong: [DESIGN-hay.md](DESIGN-hay.md) and
the tickets under [`docs/method/issues/`](docs/method/issues/).

---

## 6. Checking it still works

```bash
cargo test --manifest-path hay/Cargo.toml     # unit tests + tests/cli.rs contract tests
./hay/differential-test.sh                     # exact match set under normalized traversal
bun install --frozen-lockfile
bun audit
bun run typecheck                              # bun strips types without checking
bun grep-hygiene.ts --selftest
bun harvest-queries.ts --selftest
bun measure-mrr.ts --selftest
bun doc-authority.ts --selftest
bun categorize-misses.ts --selftest
bun swe-explore.ts --selftest
bun benchmark.ts --selftest
bun benchmark-report.ts --selftest
bun explainer-html.ts --selftest
bash install.sh --selftest                    # exact ref + deterministic install root
```

The installer resolves `CARGO_INSTALL_ROOT`, then `CARGO_HOME`, then `~/.cargo`, and passes the
result to Cargo with `--root`. This intentionally overrides a configured `install.root`, so the
script installs, verifies, and reports the same binary.

The typecheck gate is not optional politeness: bun executes TypeScript by stripping the types,
so a property access on a field that does not exist runs happily as `undefined`. That is exactly
how the `--compare` both-invisible exclusion was dead code for four versions.

The differential test is the important one. It compares `hay` and `rg` result sets over ten queries
per repository and fails if they differ by a single line:

```bash
./hay/differential-test.sh ~/dev/repo-a ~/dev/repo-b
# identical: 20   differing: 0
```

Three real bugs were found by this test and by nothing else, because each changed *which files got
searched* rather than how a line scored.

---

## 7. Privacy

The measurement tools read your agent transcripts. That means real search terms, real file paths,
and real project names from whatever you have worked on.

- `corpus/` is **gitignored**. Keep it that way.
- Publishing results? Use `=label` to rename repositories and `--redact-names` to pseudonymise
  identifiers:
  ```bash
  bun grep-hygiene.ts ~/dev/client-project=project-a --json --redact-names
  ```
- The tools warn on stderr if a report quotes a security-sensitive identifier. Do not ignore that
  warning.
- `hay` itself reads no transcripts and stores nothing.

---

## 8. Troubleshooting

**`cargo: command not found`** — Rust is not installed or not on your PATH. Run the rustup
installer from §1, then open a new shell.

**`no judged queries for <path>`** — either you have not run `bun harvest-queries.ts`, or you have
never used a coding agent in that directory. The path must match exactly what the agent had as its
working directory.

**`hay: <path>: no such file or directory` (exit 2)** — the path is wrong. This is deliberate: an
earlier version exited 0 with no output, which is indistinguishable from "no matches".

**`hay: N matches; ranked the 20000 strongest-by-prescore candidates` (exit 2)** — your pattern is
very broad. `hay` capped its retained candidates, so the output is incomplete. Narrow the pattern
or use `rg` for an exhaustive result.

**`measure-mrr.ts` is slow** — it runs one search per query. A few minutes across twelve
repositories is normal.

**Results differ between runs of `rg`** — not your imagination. ripgrep's default output order is
nondeterministic under parallel traversal. Use `rg --sort path` when order matters. `hay` is
deterministic for a given tree: ties break on path then line number, and since 0.2.0 that also
holds above the 20,000-candidate cap, where eviction used to depend on walk order.

**`measure-mrr.ts` gives slightly different numbers than yesterday** — expected if the measured
repositories are live working trees. Ranks move when the corpus moves. Compare runs against a fixed
checkout, not across a day's commits.
