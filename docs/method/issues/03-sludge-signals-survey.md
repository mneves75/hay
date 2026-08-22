# 03 — What signal distinguishes a live doc from sludge?

Type: research
Status: open
Blocked by: —

## Question

The sludge axis needs a *machine-readable* answer to "is this file authoritative?". A human knows
`plan-v3-FINAL.md` is dead; grep does not. Survey how the world already marks this, and judge each
convention on whether a tool could read it without heuristics:

- **Status front-matter**: ADR conventions (`Status: Accepted | Superseded by ADR-012`), RFC
  lifecycles (draft/active/obsolete), Python PEP status headers.
- **Location as signal**: `docs/archive/`, `.scratch/`, `rfcs/closed/`, dated directories. Is
  path the strongest available signal in practice?
- **Git as signal**: last-modified age, orphaned files no commit has touched in N months, files
  never referenced by any other file. Is "nothing links to it and nothing changed it" a usable
  proxy for dead?
- **Explicit exclusion**: `.aiexclude`, `.cursorignore`, `.claudeignore`, `.gitattributes
  linguist-generated`, `AGENTS.md` conventions. Who honors which, and does any of it affect `rg`?
- **Anti-signal**: what makes a doc look dead but be load-bearing? (A stable spec nobody edits
  because it is correct.) The metric must not punish stability — this is the sharpest failure mode.

## Done when

A shortlist of candidate signals, each rated on availability (does it exist in real repos today?),
readability (can a CLI read it without guessing?), and false-positive risk against the
stable-but-live case.
