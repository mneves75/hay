# 09 — Can a signal tell a dead document from a live one?

Type: prototype
Status: resolved
Blocked by: 03, 08

## Question

`suspectShare` guesses at document deadness from path and filename conventions and has never been
checked against anything. Ticket 03 asked for a signal that survives the case where the sludge *is*
the repo. Test the candidates against ground truth rather than adding more heuristics.

Ground truth available here and almost nowhere else: 3,144 recorded agent sessions say which prose
files an agent has ever actually opened. A document nothing has opened across thousands of sessions
is dead by revealed preference.

## Answer

**No signal is worth shipping — because the base rate makes signals unnecessary.**

`doc-authority.ts` enumerates prose files per repo, marks each one dead if no agent ever opened it,
and scores each candidate signal by precision, recall, and **lift** (precision ÷ base rate). Lift is
the honest number: where 85% of documents are dead, a signal firing at random already looks 85%
precise.

### Across the 12 measured repositories

**1,191 of 1,567 prose files (76%) were never opened by any agent in 3,144 sessions.** Per repo the
rate runs 4% to 90%.

| signal | precision | lift |
|---|---|---|
| suspect path / filename | 86% | 1.14 |
| no inbound links from any file | 85% | 1.12 |
| both together | 87% | 1.15 |

Git age was tested too and is unusable as specified: the median-age split degenerates in repos where
most files share a commit date (several repos produced a threshold of 0-7 days, firing on nothing or
everything, with lift 0.00-1.31 and no stable direction).

**Lift 1.14 means 14% better than guessing.** The path/filename heuristic that `grep-hygiene.ts`
ships as `suspectShare` is, against real behaviour, very slightly better than flagging documents at
random. It does not deserve to be a metric.

### What this changes

The framing was wrong, not just the heuristic. The project assumed dead documentation is a needle
to be found in a haystack of live documentation. It is the haystack. When three quarters of the
documents in a repository have never been opened by the thing they were ostensibly written for,
the useful output is not a cleverness score — it is **the list**, which requires no inference at
all, only observation.

That also explains why `proseShare` failed in ticket 08 from a different direction: it weights all
prose equally, and almost all prose is inert. It was measuring the size of the haystack.

### Limits

- "Never opened by an agent" is not "worthless". Humans read documentation; these transcripts cover
  one developer's agent sessions only. This measures **agent-relevance**, which is what the project
  claimed to be about, and nothing broader.
- Recently created documents have had less opportunity to be opened; no age adjustment was applied.
- Repos differ in how long they have been worked on with agent assistance, which moves the base rate
  independently of document quality.
- Inbound-link counting is a basename substring match, so a common filename (`README.md`,
  `index.md`) inflates its own inbound count.

### Follow-up worth doing

The one genuinely unoccupied gap from ticket 01 remains: DOCER handles rotten code-element
*references*, not document-level authority. But the finding here suggests the valuable artifact is
not a detector — it is a convention that lets a document declare its own status, plus the observed
never-opened list to seed it.
