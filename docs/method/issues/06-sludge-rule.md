# 06 — What is the one rule a repo adopts?

Type: grilling
Status: open
Blocked by: 03, 04

## Question

The client offered "just move the plans out of the codebase" as the escape hatch. Decide whether
that is the rule we ship, or whether it is the lazy version of a better one.

- **Taxonomy**: what categories of in-repo prose exist, and which are authoritative? (Live spec,
  superseded spec, plan for work not started, plan for work shipped, research note, changelog,
  ADR, agent scratch.) The categories are the deliverable here — get them right and the rule
  writes itself.
- **The rule**: exile (move plans to a tracker/wiki), or quarantine (keep in-repo, mark status,
  exclude from the agent's search surface)? Exile costs the co-located context that made docs
  in-repo attractive; quarantine costs discipline nobody sustains. Take a side and say why.
- **Enforcement**: what makes it stick — a pre-commit hook (we own the installer), a CI check,
  a periodic score, or nothing but convention?
- **The migration**: what does a repo with three years of hoard actually do on day one? A rule
  with no first step is a rant.

## Done when

The taxonomy is written, one rule is chosen with its cost stated plainly, and the day-one
migration is a numbered list someone could follow without us.
