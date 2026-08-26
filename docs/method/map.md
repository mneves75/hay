# Map: Grep Hygiene

Label: `wayfinder:map`

> **Status 2026-08-19: effort concluded as a negative result.** The destination below was not
> reached and should not be pursued as written; see the README, which is now the deliverable.
> Original status note follows.
>
> **The original destination is invalidated.** Ticket 08 showed the score does
> not predict retrieval difficulty and ticket 01 showed the measurement framework already exists.
> The map below is kept as written so the route is legible; the destination needs redrawing before
> further work, and that is the next decision, not another ticket on the old route.

## Destination

A `grep-hygiene` repo shipping three staged artifacts: **(1)** a concept doc that defines grep
hygiene as a *measurable property of a repo*, not a moral one; **(2)** a CLI that scores any repo
on two axes — **addressability** (are identifiers unique enough to act as addresses?) and
**sludge** (what share of a concept query lands in non-authoritative paperwork?); **(3)** an agent
skill + repo conventions that apply the standard. Must work on the user's own repos on day one
*and* stand up as a public concept.

## Notes

- **Domain**: codebase discoverability / search ergonomics for coding agents. The reader is an
  agent running `rg`, with no privileged memory of where things live.
- **The framing to hold onto**: the client's "two wolves" (grep is bad / your codebase is bad) is a
  false choice. grep is *prior-free* — it ranks a dead `plan-v3.md` exactly like a function
  definition. The repo has two distinct diseases blended into one complaint: **addressability**
  (a naming problem, hard data behind it) and **sludge** (a *lifecycle* problem — docs with no
  expiry, no status, and nothing marking them non-authoritative). The third wolf nobody names:
  priors are cheap to add.
- **Sludge is central to this effort**, not a footnote (user decision, 2026-08-19).
- **Publishing rule for this effort**: repo identities in any published artifact are anonymised
  labels (`path=label`); the real mapping stays out of the tree. The measured repos are private
  client and personal work, and the destination for this effort is public.
- **Anchor evidence** (modem.dev, "How Coding Agents Read Code"): `create` → 1,585 hits / 459
  files; `createClient` → 466 / 23; `createStripeClient` → 43 / 19. ~3 words is where a name stops
  being ambiguous and starts working as an address (from 7,922 exported TS names). Following their
  discoverability rules: median **32%** token reduction (Haiku 4.5-authored), **12%** (GPT-5.6
  Sol-authored); a 4,943-line monolith refactor took bug detection from **3/8 → 8/8** under a fixed
  turn budget. Treat as the thing to *replicate and extend*, not to cite blindly — ticket 02 exists
  for exactly that.
- **Assets already owned**: an `ast-grep` kit (sgconfig.yml + rules/ + blocking pre-commit
  installer), a shared guidelines reference, and 88 local repositories that are a free corpus of
  real-world hoarding.
- **Skills every session should consult**: `/grilling` and `/domain-modeling` by default;
  `/research` for the research tickets; `/prototype` for prototype tickets. Ponytail applies —
  the first thing that works wins, and rung 1 ("does this need to exist at all?") is a live
  question the prior-art ticket must answer honestly.
- **Standing preference**: structural queries use `ast-grep`, never `rg`, unless plain text is the
  point (it sometimes *is* the point here — we are measuring what plain text does).

> **Cycle 2 route (2026-08-23):** [ticket 11](issues/11-cycle-2-plan.md) is the pre-registered
> plan — docs-track dev set first, query-conditional prior gated on its counts, then the
> rankable-deep bucket, weight fitting, external validity, and the token-outcome measure.
>
> **Release-integrity route (2026-08-25):** [ticket 12](issues/12-release-integrity.md)
> fixes the installer, private-data boundary, archive extraction, measurement provenance, and
> generated public surfaces without changing ranking or moving the failed gate.

## Decisions so far

<!-- one line per closed ticket: gist + link. Zoom the ticket for the detail. -->

- [09 — Can a signal tell a dead document from a live one?](issues/09-document-authority.md) — No,
  and it does not matter: **1,248 of 1,604 prose files (78%) were never opened by any agent across
  2,256 matching sessions**. Every candidate signal scores lift ~1.09-1.13, i.e. barely better than random,
  because nearly everything is dead. Dead documentation is the haystack, not the needle — the
  useful output is the observed never-opened list, which needs no inference.

- [08 — Does the score predict anything?](issues/08-validate-the-metric.md) — **No.** Built the
  test collection (2,508 judged queries from 3,144 agent transcripts) and measured MRR against it.
  Across 12 repos **nothing reaches significance at n=12** — and `proseShare`, the headline number,
  sits at **rho -0.035** (+0.043 size-controlled), indistinguishable from no relationship.
  `proseShare` varies 10.4x while MRR varies 2.0x. **The shipped metric does not measure what it
  claimed.** Least-bad candidate for a larger sample: `p90Hits` (-0.512 partial).
- [01 — Does this already exist?](issues/01-prior-art-survey.md) — Largely yes. Retrieval
  measurement is standardised (CodeSearchNet: MRR/NDCG, 4,026 relevance judgments) — do not invent
  a metric; it also independently confirms the naming thesis (MRR 0.809 → 0.419 when identifiers
  are normalised). Indexing/priors is occupied by funded teams reporting ~10x token reduction — do
  not build a retriever. DOCER covers rotten *references* in docs but not document-level authority.
  Agent-exclusion conventions are fragmented and non-standard. **The one unoccupied idea is
  inverting the benchmark: fix the retriever, vary the corpus** — plus document authority.

- [04 — Does the noise actually show up in a number?](issues/04-probe-real-repos.md) — Yes, ~29×
  spread across five of the user's own repos (3.2% → 92.3% of concept-query result lines landing in
  prose, on an identical 14-query set — ~29×). The two axes proved **independent**, so the score ships as two numbers,
  not a composite; doc-to-code *file ratio* predicts almost nothing (`platform-workspace` has more
  prose files than code and scores 14.6%); and the path/filename `suspect` heuristic collapses both
  when the sludge *is* the repo and against domain-word collision. Tool built: `grep-hygiene.ts`,
  evidence in `evidence/2026-08-19-five-repos.json`. Survived a Codex P3 review and a security pass
  — 23 defects fixed and re-measured across eight review rounds; seven changed the published
  numbers, one halving the headline spread and one revealing that the score was machine-dependent.

## Not yet specified

- **CLI shape (stage 2)** — partially answered by 04: a working single-file `bun` + `rg` scorer
  exists and is fast (sub-second on a 1,400-file repo). Still open: how it composes with
  `ast-grep-kit`, output format for CI, and whether **hits-to-definition** (how many hits you read
  before reaching the authoritative one) becomes the third number — it is the metric closest to
  what an agent actually pays, and 04 did not measure it.
- **The agent skill (stage 3)** — what "hygiene-aware search" concretely does: a ranked `rg`
  wrapper? path priors? a generated `AGENTS.md` map? Depends on both the metric and the sludge rule.
- **Does vendored third-party source count?** `runtime-monorepo` commits 12,961 tracked files of
  someone else's code; they dominate its score. An agent really does grep them, so excluding them
  is not obviously right — but including them means the number describes another project's naming.
  Ticket 05 has to rule on this; there is no reliable "vendored" signal a tool can detect.
- **Structural declaration extraction** — the addressability axis extracts declarations with a
  regex plus a comment/quote heuristic. `ast-grep` is installed and is this workspace's standing
  preference for structural queries; moving extraction onto it removes a whole false-positive
  class. Deferred because it needs a per-language node-kind contract decided first, which is
  ticket 05's territory, not a review patch.
- **The third file class** — `platform-workspace` carries 1,926 files that are neither code nor prose
  (JSON, YAML, fixtures, generated output). Both axes currently ignore them, and an agent grepping
  a concept hits them too. Worth a look once the two main axes are settled.
- **Remediation vs measurement** — does the tool only score, or also fix (codemod renames, doc
  archival)? Only worth asking once the score is proven to discriminate.
- ~~Redraw the destination.~~ **Resolved by doing all three.** (a) The within-repo diagnostic is
  built and is the one frame that survived — `measure-mrr.ts <repo>` lists the expensive searches.
  (b) Document authority was tested in ticket 09 and the heuristic approach is dead; what remains
  worth building is a *status convention*, not a detector. (c) The negative result is written up in
  the README, which is now the deliverable.
- **The remaining open question**, if anyone continues: a portable way for a document to declare
  itself non-authoritative, seeded from the observed never-opened list. Ticket 01 found this is the
  only genuinely unoccupied gap, and ticket 09 found the list is trivially obtainable.
- **Outcome validation** — MRR is still a proxy. The field's accepted measures are tokens and tool
  calls per resolved task. Nothing here has been tested against those.
- **Naming and publication vehicle** — is "grep hygiene" the term we ship? README, blog post, talk?
  Hangs on the position ticket.

## Out of scope

<!-- ruled beyond the destination; never graduates -->

- Building a code search engine, index, or embeddings product. This measures and shapes repos; it
  does not compete with Sourcegraph/Zoekt.
- Actually cleaning any specific client repo. That is the client's execution against the standard,
  not this effort.
