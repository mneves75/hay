# 05 — What is the score, and what makes it honest?

Type: grilling
Status: open
Blocked by: 01, 02, 04

## Question

Define the grep hygiene score precisely enough that two people computing it on the same repo get
the same number, and hostile enough that it cannot be gamed into meaninglessness.

Decisions to land:

- **Axes**: is it two numbers (addressability, sludge) or one composite? A composite hides which
  disease you have — which is exactly the client's mistake. Argue it out.
- **Addressability**: what is measured — hit count per exported name? A distribution statistic
  (median hits, p90, share of names above N hits)? Word count is the *proxy* modem used; is the
  real thing hits-to-definition ratio?
- **Sludge**: noise ratio per query, or a property of the repo independent of any query? A
  per-query number needs a query set, and the query set becomes a thing we have to defend.
- **Scale**: absolute or normalized to repo size? A monorepo will always have more hits; a score
  that just measures LOC is worthless.
- **Gaming**: name every way a repo could score well while remaining unreadable. If the obvious
  gaming move is "rename everything to a UUID", the metric is wrong.
- **The stability trap**: a correct, stable, unedited spec must not be scored as sludge (see 03).

## Done when

The metric is written down with its inputs, its failure modes, and at least one worked example
computed against the ticket 04 numbers.
