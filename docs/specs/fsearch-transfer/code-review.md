# Independent code review

Fixed point: `bb271d3`; initially reviewed commit: `baf2f89`. Both axes used fresh read-only
GPT-6.1 Sol contexts, the committed diff, relevant standards/spec, and complexity navigation.
No reviewer edited source. Their synthetic reproduction fixtures were removed.

## Standards

One demonstrated P2 breach: MCP `grep` claimed complete success after an invalid `.gitignore`
range (`[z-a]`). The content walker ignored nonfatal entry errors, violating AGENTS invariant 6.
The new completeness claim exposed an omission inherited from ordinary CLI behavior. An actual
MCP regression and streaming CLI control were red before the correction.

One P3 judgment call: three handlers repeated busy admission, cancellation watch and blocking
permit ownership. No incorrect lifecycle was demonstrated. A single internal `run_job` now
owns those operations without changing the public API or adding another service abstraction.

Disposition: both addressed. Final Standards review of `cbd2cc5` reports **0 unresolved standard
breaches and 0 unresolved judgments**. It independently ran 20 filename/MCP tests and true,
false and unset macOS Git precomposition controls. The owned permit remains inside the blocking
closure, with the cancellation watch alive across its await. No edits or fixture leftovers.

## Spec

One demonstrated P2 defect: with macOS `core.precomposeUnicode=true`, a staged decomposed
`café.txt` was absent from tracked/staged results and appeared as untracked. Git emits composed
keys; the lookup used filesystem bytes. This violated accurate Git filtering and NFC requirements.
The actual CLI regression was red before the correction; MCP and Unicode-parent controls cover
the same behavior. Mac-only key normalization follows the configured Git policy. Linux has a
distinct composed/decomposed path control and preserves raw keys.

No other missing accepted requirement or unrequested scope creep was found. Index/history
absence is explicit in the corrected spec, not a shipped acceleration claim.

Disposition: fixed. Final Spec review of `cbd2cc5` reports **0 unresolved findings**. It independently
ran all 43 CLI/filename/MCP tests, plus composed/decomposed roots, nested directories, ignored
ancestors and disabled-precomposition controls; no missing accepted requirements or scope creep.

Initial counts: Standards 1 demonstrated breach plus 1 nonblocking judgment; Spec 1 defect.
The worst issue in each axis was P2. Initial actual-binary verification independently reproduced
both defects and returned FAIL; a new full source-blind behavior context returned PASS after
the correction. See [verification.md](verification.md) for all five criteria and the separate
fresh security acceptance of the film dependency correction.
