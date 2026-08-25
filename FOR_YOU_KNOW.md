# For you know — what this repo is, in plain language

The explainer. `README.md` has the findings, `HOWTO.md` has the commands, `MEMORY.md` has the
state. This one is the story: why it is built this way, what broke, and what it taught.

## The problem, with a librarian

Imagine a librarian who is brilliant, fast, and has complete amnesia every morning. You ask "where
do we handle refunds?" She cannot remember — she has never remembered — so she does the only thing
available: she walks the shelves looking for the word "refund" and hands you everything she finds,
**in shelf order**.

That is a coding agent. It reads your codebase by running `rg`, and `rg` returns matches in path
order, which is arbitrary. If a dead `plan-v3-FINAL.md` sorts before `src/refund.ts`, the dead plan
comes first. The agent reads the first page and acts on it.

A client described the symptom as *"codebases with the grep hygiene of a compulsive hoarder"* and
offered two wolves: **grep is bad**, or **your codebase is bad** — pick one.

## The first idea, and why it was wrong

The obvious move is to blame the hoard: measure how much of a repo's search results are paperwork
rather than code, score it, tell people to clean up. That is what got built first — `proseShare`,
plus a naming metric. Five repos, a ~100× spread, a nice table.

Then it got tested, and it does not work. Against real agent behaviour, `proseShare` correlates
with actual search difficulty at **ρ −0.035** — statistically indistinguishable from a coin.

The reason is almost funny. The metric assumed dead documentation is a needle in a haystack of live
documentation. Measured against what agents actually open, **76% of all documentation in these
repos had never been opened by any agent, in 3,144 recorded sessions.** It is not the needle. It is
the haystack. And a metric that weighs all prose equally is measuring the size of a pile that is
almost entirely inert.

So neither wolf. `grep` is not bad — it is **prior-free**. It ranks a dead plan exactly like the
function definition because nothing in the repo tells it otherwise. That is a fixable property of
the *reader*, not a moral failing of the *repo*.

## The thing that made everything else possible

The best asset here was sitting on the disk the whole time and took five seconds to find.

Every coding-agent session writes a transcript: `~/.claude/projects/**/*.jsonl`. Those transcripts
contain **every search an agent ran**, the directory it ran in, and **which files it opened next**.
That last part is the gold. Nobody labelled it, but when an agent searches for `retryPolicy` and
then opens `src/retry.ts`, that is evidence — the same click-through logic search engines have used
for decades.

3,144 transcripts became **2,508 real queries with real answers** in about five seconds. In
information-retrieval terms that is a *test collection*, and it is the one thing the project had
been missing: a way to be told it was wrong.

It immediately told the project it was wrong. That is what a good instrument does.

## `hay`, and why Rust

If the reader is the problem, fix the reader. `hay` runs the corresponding ripgrep-engine search
under a deterministic traversal policy and reorders the output so the line that *declares* the
thing, in source rather than in an archived plan, comes first. Complete searches preserve the
equivalent ripgrep match set; only the order changes.

Rust was chosen for two reasons, and speed is the less interesting one.

The measurement tools spawn **one `rg` process per query** — 146 tree walks to analyse one repo.
Rust does one walk and matches everything in a single pass. That is an ~N× improvement, which no
amount of clever TypeScript would buy.

The better reason: `hay` uses ripgrep's *own* crates (`ignore`, `grep-searcher`, `grep-regex`).
That makes four bug classes **structurally impossible** rather than merely guarded — JSON parsing
errors, exit-code confusion, nondeterministic output order, and inherited config. Every one of
those had already bitten this project. Owning the walk beats parsing someone else's output.

The ranking itself is three signals, and picking them was the humbling part. Six were built. Three
earned nothing and were deleted — exact-case matching, comment penalties, and whole-word matching.
Removing whole-word matching *improved* the score. Every one of them had sounded obviously correct
when it was written. **Intuition about ranking is worthless; ablation is not.**

## The twenty bugs

The full list is in `memory/2026-08-19.md`. What matters is their shape: almost none of them
crashed. They produced numbers that looked entirely reasonable.

The scanner could not see hidden directories, so `.scratch/` — the exact folder the tool existed to
find — was invisible, and the headline spread collapsed from ~100× to ~29× when that was fixed. A
percentile function was off by one *and its test asserted the wrong value*, so the bug was guarded
by its own test. Command parsing split on `|` before tokenising, so `rg "auth|session"` was
harvested as `auth`, silently corrupting 35% of the test collection and retracting a conclusion
that had already been written down.

The pattern is consistent: **the instrument lied, plausibly, repeatedly**, and the only thing that
ever caught it was checking against something already known. "Does ripgrep report 2 or 4 here?"
took four seconds and demolished a published number.

## What shipping 0.2.0 taught

The list of missing pieces — `-C`, `--json`, `-e`, `-t`, packaging, CI — read like the work between
`hay` and being finished. Closing it took an afternoon and moved the number that matters by
nothing at all, which is exactly what should have been expected: the gate fails for research
reasons, and flags are not research. The value was in what fell out along the way.

Two defects surfaced, both the quiet kind rather than the crashing kind:

- Above 20,000 candidates the ranking heap evicted on score alone, so an equal-scoring candidate
  never displaced the one already there — and which lines survived depended on the order the
  parallel walker happened to deliver them. A tool that documents itself as deterministic was not,
  in exactly the case where it matters most.
- A search where every path was unreadable exited **1**, which means "searched fine, found
  nothing", because the error check sat after the empty-result return.

And one false alarm worth the retelling. Re-running the evaluation after the changes moved two
repositories by 0.0001 MRR. That is small enough to wave away and large enough that it should not
have happened at all, since the ranking code was supposed to be untouched. Rebuilding the old
binary and diffing its output on exactly the queries that moved gave **zero differing lines** — the
cause was 1,795 and 179 files being committed to those repositories *while the measurement ran*.
The instrument was fine; the corpus moved. The habit that caught it is the same one that caught the
other nine: do not reason about the discrepancy, reproduce it.

## The fail-closed hardening pass

One later review found three more ways a plausible result could lie by omission. A search broader
than the 20,000-candidate retention cap printed a warning but still exited **0**, even though
thousands of matches had been dropped. JSON context records lacked their absolute byte offset,
and valid zero-width regex matches such as `^` and `$` disappeared from `submatches`. Finally,
a file that vanished between matching and context re-read quietly lost its requested context.

All three now fail or report honestly: capped searches exit **2**, JSON preserves offsets and
zero-width spans, and context re-reads use a capability anchored to the search root, rejecting
outside-pointing replacements as incomplete. The differential suite grew from ten literal cases
to seventeen traversal and matcher cases, while release archives gained provenance attestations.
None of this changes ranking; it strengthens the sentence callers can safely infer from an exit
code.

## Pitfalls, if you work here

- **zsh does not word-split unquoted expansions.** `$repos` arrives as one argument. This cost four
  separate debugging rounds in one day, once producing an ablation table where every row was
  identical because the flags never reached the binary. Use arrays.
- **ripgrep's default output order is nondeterministic.** Three identical runs, three orderings.
  Any rank metric needs `--sort path`. It also means an agent gets a different first page each run.
- **`-g '*.ts'` does not override `.gitignore`** — a reviewer claimed it did; a four-line test
  disproved it. Test the claim, including when it comes from something smarter than you.
- **`corpus/` holds real queries and paths from private work.** It is gitignored. Keep it that way.
- **`.scratch/` is ignored by convention**, so anything you link to from a README lives there at the
  cost of being a dead link in every clone. The method record moved to `docs/method/` for that
  reason. `hay` also classifies `.scratch/` as buried, which makes it a poor home for the record a
  reader is being pointed at.
- **MRR is only reproducible against a fixed checkout.** The measured repositories are live working
  trees; ranks move when they do. Compare against a pinned commit, not across a day.

## What 0.5.0 taught: the instrument needs auditing too

Everything above is about the harness catching bugs in the *tool*. 0.5.0 was the reverse — pointing
the same suspicion at the harness itself — and it found the thing that could have invalidated every
published comparison.

The A/B was not giving both retrievers the same files. Ripgrep was called with `--hidden`; `hay`
was not. So for four versions, the headline "hay beats ripgrep by +0.131" was produced by running
two different searches. Not two rankings of the same result set — two different result sets. In a
file whose own comment says, in as many words, that the retrievers must be fed identically or the
comparison is not one.

The punchline is that fixing it changed nothing: +0.1318 instead of +0.131. And that is precisely
why it is worth telling. Before measuring, there was no way to know which way it would go — this
project has already retracted two numbers for defects that looked equally harmless. **"It turned
out not to matter" is a sentence you earn by measuring, not by reasoning.** If you find yourself
about to skip a check because you can predict the answer, that is the check to run.

Two smaller ones from the same pass, both in the same direction:

- The project **cited** a statistics paper (Smucker et al.) to justify its bootstrap. Reading it
  properly, the paper uses a *different* test as the reference and validates the bootstrap against
  it — and a follow-up found the bootstrap flatters you at small samples. So the number being
  reported was the more generous of the two available. Both now run. They agree.
- MRR only looks at the first correct answer, but the average query here has 2.27 correct answers,
  because an agent opens several files after a search. So the headline metric was ignoring most of
  the evidence that had been collected. nDCG@10 uses all of it, and says the same thing.

Notice the pattern in all three: none was a crash, none looked wrong in the output, and each one
happened to favour the tool being sold. That is not coincidence — it is what selection pressure
looks like when the person checking is also the person hoping.

## What 0.6.0 taught: count first, then code

0.5.0 ended with a confession: the gate fails and there is no theory of the gap. 0.6.0 is what
happens when you buy the theory before touching the ranker. Every miss and regression went into
one of seven counted buckets first (`categorize-misses.ts`), and only then did anyone open
`score.rs`. The counts overruled the plan twice: the language gap everyone would have guessed was
Python or Go turned out to be Swift — this corpus belongs to an iOS developer — and the
"unwinnable" bucket (ripgrep also missed) turned out to be 100% winnable, every answer sitting in
hay's stream below rank ten.

The mechanism the counts exposed is a nice one: `const body = await readOptionalJsonBody(...)`
scored as a *definition* of `readOptionalJsonBody`, because `const` sat within four tokens of the
match. But `const` declares `body`. Thirteen call sites wearing that costume outranked one real
answer. The fix is a sentence — if `=` or `:` falls between the keyword and the match, the
keyword declared something else — and a reviewer immediately found the sentence was too strong
(`const { remoteName: localName }` really does declare `localName`; colons inside braces are
aliases, not type positions). Both versions are in the tests now.

Three other things this cycle that are worth stealing:

- **The gate had never been computed.** The pre-registration says "median MRR across the 12
  repos"; every number ever held against it was a paired mean over queries. Nobody noticed for
  five releases because both numbers moved together. A rigour project graded itself against the
  wrong statistic — write the gate statistic into code the day you write the gate.
- **bun does not typecheck.** It strips types and runs. A dead property access (`a.results` on an
  object whose field is `scanned`) sat in the comparison harness through four versions, silently
  disabling an exclusion the comment right above it described. One `tsc --noEmit` found it in
  seconds, along with only three other errors in seven files — this codebase was *almost* clean,
  which is exactly why nobody had looked.
- **External validity finally exists** (`swe-explore.ts`): on 97 public SWE-bench-derived
  instances in eight languages — repositories, issues and gold files all chosen by other people —
  hay's reordering beats ripgrep's path order by +0.27 MRR given identical queries. Bigger effect
  than on the private corpus, and the one number in this repo no one can accuse of home cooking.

## The one lesson worth carrying out of here

The project failed at what it set out to do and the failure is the useful part, so the correction
history stays in the README on purpose. Do not tidy it away.

If there is a single transferable habit: **build the thing that can tell you you are wrong, first.**
Every good decision in this repo traces back to the transcript harvester. It killed the original
metric, it graded `hay`, it made the ablation possible — and it was one afternoon of work that
could have been the first afternoon instead of the last.
