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

Disposition: both addressed. The corrected walkers count/report ignore errors; the job runner
retains its owned permit inside the blocking closure. Final source review follows below.

## Spec

One demonstrated P2 defect: with macOS `core.precomposeUnicode=true`, a staged decomposed
`café.txt` was absent from tracked/staged results and appeared as untracked. Git emits composed
keys; the lookup used filesystem bytes. This violated accurate Git filtering and NFC requirements.
The actual CLI regression was red before the correction; MCP and Unicode-parent controls cover
the same behavior. Mac-only key normalization follows the configured Git policy. Linux has a
distinct composed/decomposed path control and preserves raw keys.

No other missing accepted requirement or unrequested scope creep was found. Index/history
absence is explicit in the corrected spec, not a shipped acceleration claim.

Disposition: fixed. Final source review follows below.

Initial counts: Standards 1 demonstrated breach plus 1 nonblocking judgment; Spec 1 defect.
The worst issue in each axis was P2. Initial actual-binary verification independently reproduced
both defects and returned FAIL; the correction is followed by a new full behavior context.
