# The benchmark, explained from nothing

*Feynman's rule: if you can't explain it without jargon, you don't understand it — and the places
where the explanation gets slippery are exactly the places where something is wrong. This document
explains what `BENCHMARK.md` measures, why every piece of it is shaped the way it is, and where it
breaks. It assumes you know nothing about information retrieval and don't want to.*

*Live companions: the [full report](benchmark.html) with charts and intervals, the
[manual](MANUAL.html) for the tool itself, and [`./install.sh`](install.sh) to get it. Numbers in
here reflect the latest committed run.*

---

## 1. The whole thing in one sentence

**You type a word into a search tool. How far down the list is the thing you were looking for?**

That's it. Everything else on this page is the consequence of trying to answer that honestly.

---

## 2. Why this question exists at all

Imagine a librarian who is fast, tireless, and has complete amnesia every single morning. You ask
her "where do we handle refunds?" She has never remembered anything, so she does the only thing
available to her: she walks the shelves looking for the word *refund*, and hands you every book
that contains it — **in shelf order**.

Shelf order. Not "most useful first". Not "the actual refund manual first". The order the books
happen to sit on the shelves.

That librarian is `grep`, and by extension every tool like it. It isn't stupid. It is *prior-free*:
it has no opinion about which of its results is more likely to be the one you wanted, because
nothing ever gave it one.

Now: a coding agent reads the first page of results and acts on what it sees. If a dead planning
document from two years ago happens to sort before the actual function, the agent reads the dead
plan. So the position of the answer in the list is not cosmetic. It is the whole product.

`hay` is a librarian who has been given exactly one opinion: *a book that defines a thing is
probably more useful than a book that merely mentions it.* The benchmark asks whether that one
opinion is worth anything, and how it compares to everyone else's approach.

---

## 3. The hard part, which is not the searching

Here is the thing that surprises people. Measuring a search tool is not hard because searching is
hard. It's hard because **to score an answer you must already know the right answer.**

If I want to say "tool A puts the answer at position 1 and tool B puts it at position 7", I need
someone to have decided, in advance, what "the answer" *is* — for every single query. That list of
(question, correct answer) pairs is the entire cost of the exercise. In the research world it's
called a *test collection*, and building one is normally a funded project with human annotators.

So: where do correct answers come from?

**The tempting wrong idea:** ask `hay` what the answer is. Obviously absurd when stated plainly —
the tool would grade its own homework and score 100% — but the trap has subtler forms. If I decided
the right answer using the same rule `hay` uses internally to spot definitions, I would be doing
exactly this while feeling rigorous.

**What I actually did:** ask a *parser*. `ast-grep` reads source code the way a compiler does — it
builds a syntax tree and knows that `fn validateSession(...)` is a function declaration in a way
that has nothing to do with searching for text. I ask it: *which symbols are declared exactly once
in this repository, and in which file?*

That gives me thousands of pairs like:

```text
question: "validateSession"     correct answer: "src/auth.ts"
```

The correct answer comes from a different mechanism than any tool being tested. That's the point.
It isn't perfect — §9 is entirely about how it isn't — but it isn't circular.

**Why "exactly once"?** If a symbol is declared in three places, there is no single right answer,
and scoring a tool against one arbitrarily chosen site measures nothing but luck. Those symbols are
thrown away rather than guessed at.

---

## 4. Turning "position in a list" into a number

Say I run four queries and the answer comes back at position 1, 2, 10, and 4.

The naive move is to average the positions: (1 + 2 + 10 + 4) / 4 = 4.25. This is wrong, and it's
worth understanding *why*, because the reason shapes the whole metric.

**Positions are not worth what their size suggests.** The difference between position 1 and
position 2 is enormous — you either read the right thing first or you didn't. The difference
between position 50 and position 51 is nothing at all; nobody reads either. But plain averaging
treats both gaps as "1 apart". And one catastrophic result at position 500 would drag the average
so far that nine perfect results couldn't rescue it.

**The fix: flip it.** Instead of the position, use **1 divided by the position**.

| position | 1/position | what it feels like |
|---:|---:|---|
| 1 | 1.00 | perfect — first thing you see |
| 2 | 0.50 | still fine |
| 4 | 0.25 | you're scrolling |
| 10 | 0.10 | bottom of the first page |
| 100 | 0.01 | never happening |
| never found | 0.00 | — |

Now the numbers behave the way the experience behaves. Going from 2nd to 1st gains you 0.50. Going
from 100th to 99th gains you 0.0001. That matches reality: the top of the list is where all the
value is.

Average those flipped values across all queries and you get **Mean Reciprocal Rank** — MRR.
"Reciprocal" is just the fancy word for "1 divided by". That's the whole metric. An MRR of 1.0
means the answer was always first. In the committed benchmark, `hay` scores 0.967 on the Linux
kernel; plain ripgrep scores 0.670.

**An honest complication.** A researcher named Norbert Fuhr published a paper arguing you shouldn't
average reciprocal ranks at all, because rank is an *ordinal* scale — an ordering, not a quantity —
and averaging orderings is a category error, like averaging the finishing places in a race and
calling it a speed. Tetsuya Sakai wrote a rebuttal saying the argument rests on a theory of
measurement scales that is itself disputed. This is not settled.

So the report gives you a second number that has no such problem: **the share of queries answered
within the first ten results.** That's a proportion — a plain percentage of a count — and nobody
disputes averaging those. Both numbers move the same way, which is mildly reassuring. When two
different ways of measuring agree, you worry less that you invented the result.

### A third number, because MRR ignores most of the answer

There is one more thing wrong with reciprocal rank, and it has nothing to do with scales: **it only
looks at the first correct result and throws the rest away.**

That would be fine if every question had exactly one right answer. It doesn't. In the behavioural
corpus, **57% of entries name more than one answer file** — an agent searching for "auth" opened
three files, and all three were reasonable. MRR finds the earliest of those and stops. A tool that
puts one good file at position 1 and nothing else useful on the page scores identically to a tool
that puts four good files at positions 1 through 4. Those are not the same page to read.

The fix is a metric that credits *every* correct result on the first page, worth less the further
down it sits: **nDCG@10**. Take the ten results, give each correct one a score that shrinks with
depth, add them up, and divide by the best possible arrangement so a perfect page scores 1.0. The
"n" is for that normalisation, which is what makes a question with five right answers comparable to
one with a single right answer.

It agrees with MRR — +0.131 against +0.132 on the same data — which is the outcome you want and not
the one you can assume. Three metrics with three different weaknesses pointing the same direction
is a much better position than one metric you had to defend.

---

## 5. Why a single number is a lie

Say `hay` scores 0.967 and ripgrep scores 0.670. Difference: 0.296. Done?

No. Because I only asked **30 questions**. If I'd picked 30 *different* symbols from the same
kernel, I'd have got different numbers. So the real question isn't "what's the difference" but
**"how much would this difference move if I'd been unlucky with which questions I picked?"**

If the difference would jump around between −0.1 and +0.7 depending on the sample, then 0.296 is
noise wearing a suit. If it would stay somewhere between 0.16 and 0.45 no matter which questions I
drew, that's a real effect.

### Trick one: compare on the same questions

Instead of running `hay` on one set of queries and ripgrep on another and comparing the two
averages, I run **both tools on every single query** and record the *difference per query*.

This is enormously more powerful, and the reason is intuitive: some questions are just hard for
everyone. A symbol that appears 800 times is hard for every tool. If tool A got the easy questions
and tool B got the hard ones, comparing their averages tells you about the questions, not the
tools. Asking both the same question and looking at the gap cancels the question's difficulty out
entirely.

This is why you weigh yourself on the same scale before and after, rather than using two scales.

### Trick two: the bootstrap

Now I have 30 per-query differences. I want to know how stable their average is. The honest way
would be to get 30 fresh questions, then another 30, a thousand times, and see how much the answer
wobbles. I can't; I only have the 30.

So I fake it, and the faking is legitimate:

> Write each of the 30 differences on a card. Put them in a hat. Draw one, **write it down, and put
> it back**. Do that 30 times. You now have a new set of 30 — some cards drawn twice, some not at
> all. Average it. Write that average down.
>
> Do the whole thing 10,000 times.

You end up with 10,000 averages. Sort them and chop off the lowest 2.5% and the highest 2.5%. What
remains is the **95% confidence interval**: the range the answer lands in almost all the time when
the sample is jostled.

Why does putting the card back matter? Because that's what makes each draw independent, and it's
what simulates "a different sample from the same underlying world". Without replacement you'd just
get the same 30 cards in a different order, every time, and learn nothing.

For `hay` versus ripgrep on the kernel, the interval is **[0.150, 0.446]**.

### Reading the interval — the only skill you need here

**If the interval does not contain zero, the difference is probably real.** [0.150, 0.446] is
entirely above zero: in essentially every resampling, `hay` won.

**If the interval contains zero, you have not detected anything** — regardless of how good the
headline number looks. `ugrep` on the kernel scores +0.019 over ripgrep, interval
**[−0.107, 0.145]**. That interval includes zero, which means "on a different sample of questions
this could easily have gone the other way". +0.019 is not a result. It's a shrug with a decimal
point.

This is why the benchmark tables bold some rows and not others. On the current kernel run, **only
`hay` beats plain ripgrep by an amount that survives both tests**. Every other interval crosses
zero or fails the randomization check.

### Where I had to correct this section

I wrote the paragraph above as "the difference is real" — flat, no hedge. Then the bootstrap and a
second test disagreed, and the disagreement went against this project.

The hat trick in §5 is one way to ask the question. There is another, called a **randomization**
(or permutation) test, and its logic is even more direct. If `hay` and ripgrep were really
equivalent, then for any given query it would be a coin flip which one came out ahead — so the
*sign* of each difference is arbitrary. So: take the differences, randomly flip the sign of each
one, average them, repeat 10,000 times, and ask how often pure sign-flipping produces a gap as
large as the one actually measured. If the answer is "often", the gap is what coin flips look like.

On the **openclaw** corpus, `hay` beats ripgrep by +0.150. The bootstrap interval is
**[0.005, 0.297]** — it excludes zero, barely, and by the rule I gave you two paragraphs ago that
counts as detected. The randomization test says **p = 0.058**, which does not.

They disagree, and the reason is known rather than mysterious: the bootstrap runs optimistic at
small samples. Thirty queries is a small sample.

So the report no longer bolds on the interval alone. A difference is claimed only when **both**
tests agree; where they disagree the table says so and takes the conservative reading. That 0.5.0
report reduced `hay`'s detected wins from three corpora to two. The current run restores openclaw
because the tool improved: +0.210 [0.067, 0.354], randomization p=0.008.

I've left my original wording standing above rather than quietly editing it, because the sequence
is the lesson: a rule can sound crisp enough to teach and still be too crisp, and the way you find
out is to ask the same question a second way while being willing to lose.

### One more subtlety, which cost me a correction

The report also gives a p-value, and the first version printed **p = 0.0000**.

That's impossible, and noticing why is the useful part. The p-value here is "what fraction of my
10,000 resamples landed on the other side of zero?" If none did, the fraction is 0/10,000 = 0. But
that doesn't mean the probability *is* zero — it means **my simulation isn't fine-grained enough to
see it.** Ten thousand coin flips coming up heads doesn't prove tails is impossible; it proves you
need more flips to measure how rare it is.

The standard repair is to count as if there had been one more of everything: (0+1)/(10,000+1). Now
the smallest thing the report can say is p ≈ 0.0002, which is exactly the resolution the simulation
has and no finer. Reporting 0.0000 was claiming a precision I hadn't bought.

### Trick three: shuffle the labels instead

There's a second column in that table now, **randomization p**, and it answers the same question by
a different route — which is the whole reason to have it.

The bootstrap asks: *if I'd sampled a different set of queries, how much would the answer wobble?*
The randomization test asks something more direct. Suppose the two tools are secretly identical.
Then for any one query, which tool "won" is pure coin-flip — the label `hay` versus `ripgrep` is
meaningless and I could swap them without changing anything. So: take the real per-query
differences, flip a random subset of their signs, and average. Do it ten thousand times. That
builds the distribution of results a world with *no real difference* would produce. Then ask how
often that pretend world matched what I actually measured.

If shuffled coin-flips reach my result all the time, my result is a coin-flip. If they essentially
never do, something real is going on.

Why bother having both? Because the paper this project cites for its statistics — Smucker,
Allan and Carterette — doesn't actually recommend the bootstrap. It uses the *randomization* test
as the yardstick and checks the bootstrap against it. And their follow-up found the bootstrap leans
toward smaller p-values than it should when you don't have many samples, which is most of the
corpora here. So the project was citing a paper for the shortcut that paper was written to
validate, and reporting the more flattering of the two numbers.

Both are printed now. Where they disagree, the report takes the conservative result and leaves the
row unbolded.

---

## 6. Two completely different ways to be good at this

The most interesting thing in the results isn't that `hay` won. It's *how differently the two
winners work.*

Take the symbol `quiet` in ripgrep's own source code:

| tool | results returned |
|---|---:|
| plain ripgrep | 73 |
| `hay` | 72 |
| `ast-grep` | **11** |

*(Counted directly at the command line, so these are each tool's own defaults rather than the
flag-matched file set the scored comparison uses.)*

`ast-grep` throws away 85% of what the others return — and it's right to. It parses the code, so it
knows that `quiet` inside a comment isn't a use of the symbol, that `"--quiet"` in a string isn't
either, and that `test_quiet` is a *different word that merely contains those letters*. The text
tools can't tell any of that apart.

So there are two distinct strategies:

- **`ast-grep` filters.** It shrinks 73 candidates to 11 real ones, then hands them to you **in the
  order it happened to walk the files**. It doesn't rank; it doesn't need to, because it's given
  you so few things.
- **`hay` ranks.** It keeps all 72, including the junk, but *sorts* them so the declaration is
  first.

Both often put the answer at position 1. The gap shows up in the tail, especially on languages
where the parser patterns are incomplete. And I think the reason is this: `hay`'s position-1 is a *guarantee*
(the declaration is scored highest, so it goes first, always), while `ast-grep`'s position-1 is
*luck* (the declaration was among the 11 survivors and its file happened to sort early). When the
luck doesn't hold, `ast-grep` drops to 3rd or 5th while `hay` is still 1st.

**I want to flag that as a hypothesis, not a finding.** It's consistent with everything I measured
— same median, different mean, ast-grep returning far fewer results — but I did not run the
experiment that would prove it, which would be to record where in ast-grep's own output the
declaration sits, query by query. I'm telling you what I believe and how confident I am, which is
different from telling you what I know.

---

## 7. The bug the benchmark found, which was worth more than the benchmark

`hay` scored **below** ripgrep on the Linux kernel. That shouldn't happen. The entire idea of the
tool is that it does better.

Here's the mechanism, and it's embarrassingly simple. `hay` decides "this line declares something"
by looking for a **declaration keyword** before the symbol — words like `function`, `fn`, `class`,
`def`, `const`. In Rust that works:

```rust
pub fn ext4_read_block(x: u8) {}     ← "fn" is right there
```

In C, there is no such word:

```c
static int ext4_read_block(struct inode *inode)     ← "static"? "int"? Neither is a declaration keyword.
```

A C function declaration announces itself with a *type*, and a type is just some identifier —
indistinguishable, to a keyword-matcher, from anything else. So on C, `hay`'s central signal never
fired. Not "fired weakly". **Never fired at all.**

### The experiment that settles it

I could have argued about this. Instead:

> Run the benchmark on the kernel with the definition signal **completely switched off**.

If the signal is doing work, removing it should hurt. Result:

| configuration | MRR on the Linux kernel |
|---|---:|
| definition signal **on** | 0.8400 |
| definition signal **off** | 0.8400 |

Identical. Not close — *identical*. For four released versions, on the largest C codebase in
existence, the feature the whole tool is built around was decorative.

This is the kind of experiment worth internalising: **the strongest evidence that something does
nothing is turning it off and watching nothing happen.** It's cheap, it's unambiguous, and no
amount of reasoning about the code would have been as convincing.

### Why no test caught it

Every unit test in the project was written in Rust or TypeScript — the languages I write. The bug
existed only in the languages I don't. A test suite is a mirror; it shows you your own assumptions
in high resolution and is perfectly blind to everything outside them.

The fix adds a second rule for the "type then name then parenthesis" shape that C, C++, Java and
Objective-C all share. On the kernel it's worth **+0.081 MRR, interval [0.018, 0.148]** — real by
the rule in §5 — with no detectable harm to Rust, TypeScript, or the separate behavioural corpus.

### And a second lesson, from fixing it

The first version of that rule made Rust *worse*, significantly. I could have guessed at why. I
didn't: I ran the rule across ripgrep's entire source and **counted the word immediately before
every wrong firing**. The answer was `match` (11 times), `in` (5), `dyn` (2), and English prose
inside comments for the rest. Excluding those cut the regression five-fold, below detectability.

The counting took ten minutes. For the record, I *had* guessed first, and the guess was partly
right and confidently over-broad: it included `match`, `in` and `dyn`, but also `as`, `move`,
`mut`, `ref`, `typeof`, `instanceof` and `throw` — seven words that never fired once. And it missed
the comment-prose category completely, which turned out to be about a third of all the false
firings. Guessing got me the headline and none of the tail.

---

## 8. The traps that nearly poisoned the measurement

Every one of these was found and fixed *before* any number was published. They're listed because
each is a general lesson about measuring anything.

**`grep` was not grep.** On this machine, typing `grep` runs a shell function that resolves to
`ugrep`, a completely different program. A benchmark of "grep" would have silently measured the
wrong tool and been internally consistent about it. *Every binary is now invoked by absolute path.*
When you measure a thing, make sure you're holding the thing.

**The "deterministic" sample wasn't.** Query selection used a fixed random seed, so it should have
picked identical questions every run. It didn't: the questions came out of a hash map, which
iterates in *insertion* order, and insertion order came from `ast-grep`'s parallel file walk, which
varies. Two runs of the same binary disagreed on MRR by 0.01. Sorting before sampling fixed it.
*A fixed seed guarantees nothing if what you feed it isn't in a fixed order.*

**The timeout reported itself as "no timeout".** When a search exceeded 60 seconds I killed it —
but killing a process closes its output stream as a perfectly ordinary end-of-file, so my code saw
a normal finish and recorded `timedOut: false`. The report would have announced zero timeouts no
matter how many searches were cut off, with a timeout indistinguishable from "answer not found".
*If you don't record an event at the moment you cause it, you will report that it never happened.*

**The timeout that hangs.** Worse: the timing runs wrap each tool in `/usr/bin/time` to measure
memory. Killing the wrapper doesn't kill the search running underneath it — and the orphaned search
still holds the output pipe my code was about to read. The "timeout" would have blocked until the
thing it was supposed to interrupt finished on its own.

**Peak memory that was never a peak.** The report took memory from the first timed query and
labelled it "peak memory" across three queries. Usually a later query is larger.

**One question is not a sample.** This repository yielded exactly **one** usable query. On it,
`hay` scores 1.000 and ripgrep 0.014. Printing that beside samples of 23–30 queries would be the
precise sin this whole project exists to complain about, so any corpus under ten queries is now
marked, in the report, as *not evidence* — and no difference is flagged as detected there.

---

## 9. Where this benchmark is wrong

**It is rigged in `hay`'s favour, structurally.** The task is "find the declaration". `hay` is
built to rank declarations first. I designed a test whose right answer is the thing my tool
optimises for. That doesn't make the numbers false, but it makes them weaker than they look, and
anyone reading them should discount accordingly. The project's *other* evaluation — real agent
searches paired with the files the agent actually opened next — has no such problem, because those
answers were produced by people doing their jobs, not by me choosing a task. It is also
unreproducible by anyone else, since those transcripts are private. Neither evaluation is
sufficient alone. That's why both exist.

**The bias runs the other way too, and here's a case.** For the query `quiet`, my ground truth says
the correct answer is `crates/printer/src/summary.rs:1106`. That line is:

```rust
#[test]
fn quiet() {
```

A **test function**. The real implementation, `pub(crate) fn quiet(&self)`, lives in
`hiargs.rs:685` — and my parser patterns never saw it, because `pub(crate) fn` doesn't match the
patterns I wrote for `fn` and `pub fn`. So the benchmark declares the test to be the right answer.

And `hay` deliberately **down-ranks test files**, because when you search for a concept you usually
want the implementation, not its test. On this query, my measurement punishes `hay` for doing
exactly the right thing.

I'm not going to pretend that balances out the structural bias — it doesn't, it's one query. But it
does show the ground truth is a *parser's opinion with gaps in it*, not a fact, and the gaps aren't
politically neutral.

**Definition-finding is a small slice of searching.** An agent also asks "where is this used",
"what calls this", "where does this behaviour live" when there's no symbol to name. None of that is
measured here. A tool could win this benchmark outright and still be unhelpful.

**One machine, one operating system, one filesystem.** The machine was under variable load.
Rankings are immune to that, but the timing table is indicative and the *ratios* between tools
deserve more trust than the absolute milliseconds.

---

## 10. What I still can't explain simply

In Feynman's spirit, the honest residue:

1. **Why `hay` beats `ast-grep` specifically.** §6 gives a hypothesis (guarantee versus luck) that
   fits every number I have. I did not run the experiment that would confirm it.

2. **Why several tools score *identically*.** On ripgrep's source, `ack`, BSD `grep`, `git grep`
   and `ripgrep --sort path` all land on MRR 0.418–0.419. That's suspicious in an interesting way: it probably
   means they return the same matches in the same file order, and the tiny differences come from
   which files they skip. Probably. I haven't verified it, and "probably" is doing real work in
   that sentence.

3. **Whether 23–30 questions per corpus is enough.** No. The intervals remain wide, and an earlier
   openclaw run was small enough that two legitimate statistical tests reached opposite
   conclusions. More queries would narrow the interval. I stopped at 30
   because the kernel run already takes the better part of an hour, which is a reason and not a
   justification.

4. **Whether any of this predicts what actually matters** — tokens spent and tool calls needed for
   an agent to finish a real task. MRR is a proxy for that. It's a reasonable proxy. It has not
   been checked against the real thing, here or, as far as I can tell, anywhere in this project.

---

## 11. The one-paragraph version

Searching is easy to do and hard to grade, because grading needs answers you know in advance. I got
answers from a parser, so no tool could grade itself. I scored each result by one-over-its-position,
because position 1 versus 2 matters and position 50 versus 51 does not. I ran every tool on the
identical questions so the questions' difficulty cancels out, then resampled those results ten
thousand times to see how much the answer wobbles, then asked the same question a second way by
flipping signs at random, and I claim a difference only when both methods agree. By that standard,
`hay`'s gain over plain ripgrep is detected on all four usable corpora in the current report.
Building the test found a bug worth more than the test: `hay`'s core feature
had never once worked on C, which I proved by switching it off and watching the score not move.
