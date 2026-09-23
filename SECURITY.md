# Security

## Report a vulnerability

Use **Security → Report a vulnerability** to open a private security advisory. Do not open a public
issue for anything exploitable or include secrets, private paths, or personal data in a report.

## What each tool touches

**`hay`** reads the filesystem and nothing else. No network, no daemon, no index, no state written
anywhere. By default it honours `.gitignore` and skips hidden files, so `.env` and friends are not
read unless you explicitly pass `--hidden --no-ignore`. Symlinks met during traversal are never
followed — there is no `-L` — so a symlink inside the tree cannot be used to read outside it. A
symlink given as PATH itself is followed, as ripgrep follows it: the caller chose that root. In a
walked file, binary content stops the search at the first NUL; a file named as PATH, or stdin,
prints ripgrep's `binary file matches` line in place of its lines after the NUL, while `-c`, `-l`
and `--json` read it to the end with NUL treated as a line break, exactly as ripgrep does.

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

Two smaller behaviours are worth knowing. Matched lines are printed as they appear in the file,
so terminal escape sequences can affect a terminal that renders them. `-C` re-reads context
through a filesystem capability anchored before the walk: replacing a file inside the tree may
change the context bytes, but a symlink or path replacement cannot escape the search root.
A failed or rejected re-read exits 2 rather than returning partial context. Both attacks require
write access to the searched tree.

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
`grep-hygiene.ts`) reads your local coding-agent transcripts. Those contain real search terms,
real file paths, and real project names from whatever you have worked on.

- Transcript-derived output and paired-query dumps only go beneath the real, gitignored
  `corpus/` directory of this checkout. It is anchored to the tool's own location rather than the
  shell's working directory, so running a tool from another repository cannot write private data
  into a tree whose ignore rules nobody checked. Directories are 0700, files are 0600, and traversal or symlinked parents are
  rejected. Files are replaced atomically so an existing hard link is not truncated. There is no
  override for writing private pairs elsewhere.
- Private task hints (used only to reproduce the deleted `--hint` measurement) come only from
  messages a human typed. Subagent prompts, skill bodies,
  compaction summaries, task notifications, and captured command output share the transcript's
  user-message shape and are refused explicitly, each with a planted selftest row.
- Use `path=label` to anonymise repository identity and `--redact-names` to pseudonymise
  identifiers before sharing any aggregate report.
- The tools warn on stderr when a report would quote a security-sensitive identifier. Do not
  ignore that warning.

`swe-explore.ts` is the one networked measurement tool. It reads fixed HTTPS endpoints on
Hugging Face and GitHub and extracts archives with the maintained `tar` package rather than a
shell command or hand-rolled parser. Remote instance IDs, GitHub owner/repository slugs, and
40-hex commit IDs are validated before they can name a cache path or archive URL. Ground-truth
file names are normalized as Git paths; absolute paths, parent traversal, NULs, and
platform-specific separators are rejected before a filesystem probe. Downloads and expanded
contents have independent byte caps; decompression ratio, member count, path depth, links, special
entries, and unsafe member paths are bounded or rejected. The first violated archive limit aborts
the compressed input stream and the parser's decompressor. Extraction occurs in a private
temporary directory promoted only after complete validation. The tool never executes downloaded code.

`install.sh` resolves `HAY_REF` exactly as a branch, tag, or commit and refuses an unresolved
ref rather than falling back to `main`. It installs with `cargo install --locked` and
smoke-tests the binary at Cargo's actual install path, so an older `hay` on `PATH` cannot fake
success. Prefer a versioned script URL and matching `HAY_REF`; inspect any downloaded installer
before running it.

## Supply chain

`hay` depends on ripgrep's own crates (`ignore`, `grep-regex`, `grep-searcher`, `grep-matcher`),
`serde_json`, and the Bytecode Alliance's `cap-std` for capability-scoped context reads. The
measurement kit's sole runtime dependency is the locked, audited `tar` parser used at the untrusted
archive boundary. CI runs
Rust and Bun vulnerability audits, GitHub Actions are pinned by full commit SHA, and Dependabot
proposes Cargo, Bun, and Actions updates weekly. Release archives have SHA-256 checksums and
GitHub artifact attestations bound to the release workflow, protected `main`, and the exact
source commit. For releases produced by the 0.3.1+ policy, verify both before installing:

```bash
shasum -a 256 -c hay-vX.Y.Z-<target>.tar.gz.sha256
source_sha="$(gh api repos/mneves75/hay/git/ref/tags/vX.Y.Z --jq .object.sha)"
gh attestation verify hay-vX.Y.Z-<target>.tar.gz -R mneves75/hay \
  --signer-workflow mneves75/hay/.github/workflows/release-dispatch.yml \
  --source-ref refs/heads/main --source-digest "$source_sha"
```

Releases through 0.3.0 used the tag-triggered `release.yml` and therefore attest `refs/tags/vX.Y.Z`;
that historical statement describes their provenance but does not provide the 0.3.1+ rollback
protection.

### Release control plane

Releases are cut from `main` only, by two separate acts:

1. The maintainer creates a **lightweight** tag `vX.Y.Z` or `vX.Y.Z-betaN` at a `main` commit
   whose push CI succeeded, and whose `hay/Cargo.toml` version is `X.Y.Z`.
2. The maintainer dispatches `release-dispatch.yml` **from `main`** with that tag as input.

The workflow is loaded from `main`, never from the tag, so a tag aimed at older history cannot
run an older copy of the policy. `release-policy.sh verify` requires the dispatch ref to be
`refs/heads/main`, the dispatch SHA to still be contained in `origin/main`, a successful completed
push CI run for that exact SHA, the tag's base version to match Cargo metadata, and the tag to be a
lightweight tag naming exactly the dispatch SHA. The build checks out that SHA and refuses an
archive whose binary reports another version. The draft job attests the archives from
`refs/heads/main`, verifies that attestation with the exact source digest, re-checks that the tag
still names the built commit, refuses a pre-existing draft holding any asset this run did not
build, and only then uploads to a **draft**. Publishing the draft is a separate explicit act, and
immutable releases are enabled, so a published release's assets and tag cannot change afterwards.

The in-workflow attestation check verifies a statement the same job just signed, so it catches a
misconfigured signer identity, not substituted bytes. Provenance is established where it matters,
by the consumer: `brew-formula.sh` and the verification command above check the downloaded bytes
against the workflow, `refs/heads/main`, and the tag's source digest.

Repository controls, configured through the GitHub API and read back when they change (the release
journal in `memory/` records each readback). Nothing in the workflow re-reads them; they are
defence in depth behind the checks above, not inputs to them:

- `main` branch ruleset: deletion and non-fast-forward updates are blocked.
- `v*` tag ruleset: creation, update, and deletion are blocked for everyone except the repository
  admin role, so no workflow token can create or move a release tag.
- The old `.github/workflows/release.yml` workflow identity is **disabled**. GitHub runs a pushed
  tag's workflow from the tagged commit, so while it was active a `v*` tag at older history ran
  the old, ungated, tag-triggered release — and deleting the file did not stop that: a negative
  test on 2026-09-15 started the old workflow from a tag at the pre-0.3.1 commit. GitHub only
  disables a workflow whose file exists on the default branch, so an inert stub stays at that path
  (manual dispatch only, no permissions, a job that refuses) and the path is disabled. The selftest
  fails if the stub is deleted or regains a trigger, permissions, or real work.
- `release` environment: deployments are admitted from `main` only. `draft-release` is the only
  job granted `contents: write`; every other job, and the workflow default, is read-only.

Threat model, stated plainly: this is a single-maintainer repository, and a compromised admin
account can change any of these controls. They exist to make an accidental or workflow-originated
release impossible and every real release traceable, not to defend against the admin.
`release-policy.sh --selftest` fails if the workflow regains a tag trigger, drops the verifier,
the tag re-check, or the environment gate, or grants contents write to any other job.
