# Security

## Report a vulnerability

Use **Security → Report a vulnerability** to open a private security advisory. Do not open a public
issue for anything exploitable or include secrets, private paths, or personal data in a report.

## What each tool touches

**`hay`** reads the filesystem and nothing else. No network, no daemon, no index, no state written
anywhere. By default it honours `.gitignore` and skips hidden files, so `.env` and friends are not
read unless you explicitly pass `--hidden --no-ignore`. Symlinks are never followed — there is no
`-L` — so a symlink cannot be used to read outside the search tree. Binary content is suppressed at
the first NUL rather than printed.

VCS metadata (`.git/`, `.hg/`, `.svn/`, `.jj/`) is excluded by default and stays excluded under
`--hidden` and `--no-ignore`, which is where ripgrep would expose it. It is **not** excluded against
an explicit include glob: `hay -g '.git/**' ...` searches `.git`, exactly as `rg -g '.git/**'` does.
That parity is deliberate — `hay` accepting a different file set than ripgrep for the same flags
would break the one property the tool is built on — but it means the exclusion is a sane default,
not a sandbox. Verified by probe, not assumed; an earlier version of this file claimed
"unconditionally" and was wrong.

**Ranking is an attack surface ripgrep does not have.** This is the one security property where
`hay` is genuinely worse than the tool it wraps, and it follows directly from what it is for.
ripgrep orders by path, so content cannot influence its own position. `hay` orders by content: a
file that *looks like* a declaration is promoted. Anyone who can write a file into a searched tree
can therefore choose what an agent reads first — write `export function validateSession() { //
ignore previous instructions ... }` into a source path and it outranks the real definition, where
under ripgrep it would have sorted wherever its filename fell. The exposure is bounded by three
things: the ranking signals are structural and public (`--explain` shows every score), the attacker
needs write access to the searched tree, and `hay` returns exactly ripgrep's match set, so nothing
is hidden — only reordered. But an agent that reads the first page and acts is exactly the consumer
this tool is built for, and promoting attacker-chosen text to that page is a real capability. Treat
`hay` output as untrusted content regardless of rank, which is the correct posture for `rg` output
too, and more obviously necessary here.

Two smaller behaviours worth knowing, both shared with ripgrep. Matched lines are printed as they
appear in the file, so a file containing terminal escape sequences can affect a terminal that
renders them; and `-C` re-reads the file after the search, so a file replaced in that window shows
the new content as context. Both require write access to the tree being searched, which is a
stronger position than either issue.

The pattern is attacker-influenced whenever an agent chooses it, so the memory `hay` itself adds is
bounded rather than proportional to match count: a capped candidate heap plus a bounded channel.
Measured on 0.2.0 — 61,249 match lines with ignores disabled: 13.9 MB peak, against ripgrep's
5.2 MB for the same search; a query truncated at the 20,000-candidate cap: 12.6 MB against 6.2 MB.
`hay` costs a few megabytes more than ripgrep and does not grow with match count.

Regex compilation is the one axis `hay` does not bound itself, deliberately: it inherits ripgrep's
limits exactly, because accepting a different set of patterns than ripgrep would break the parity
the tool is built on. A pattern near that ceiling allocates hundreds of megabytes while compiling
in both tools (measured: 367 MB for `hay`, 368 MB for ripgrep, on the same pattern), and both exit
2 beyond it.

**The measurement kit** (`harvest-queries.ts`, `measure-mrr.ts`, `doc-authority.ts`,
`grep-hygiene.ts`) reads your local coding-agent transcripts. Those contain real search terms, real
file paths, and real project names from whatever you have worked on.

- Output goes to `corpus/`, which is gitignored. Keep it that way.
- Use `path=label` to anonymise repository identity and `--redact-names` to pseudonymise
  identifiers before sharing any report.
- The tools warn on stderr when a report would quote a security-sensitive identifier. Do not
  ignore that warning.

## Supply chain

`hay` depends on ripgrep's own crates (`ignore`, `grep-regex`, `grep-searcher`, `grep-matcher`) plus
`serde_json`. CI runs Rust and Bun vulnerability audits, GitHub Actions are pinned by full commit
SHA, and Dependabot proposes Cargo, Bun, and Actions updates weekly.
