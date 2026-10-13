# Live CLI and MCP contract (source 0.4.0)

## Filename discovery

```bash
hay --find session .
hay --find sesison -t rust .
hay --find session.rs --exact-name --json .
hay --find config --size '>1kb' --mtime '<7d' .
hay --find config --git modified .
hay --find cache --git ignored --no-ignore .
hay --find=session -ig'*.rs' -m10 .
```

This enumerates live regular files. It does not search file contents. Default PATH is `.`;
an explicit PATH avoids stdin inference. A single file PATH is also allowed. Discovered symlinks
are not followed. Repository `.gitignore`, hidden flags, VCS exclusions, `-g/-t/-T` use the same
normalized policy as content search. CLI globs are relative to the working directory, as before.

Only the basename participates in matching. Unicode names/queries are NFC normalized;
`-i/--ignore-case` additionally lowercases them (not full Unicode case folding). Ordering is exact
basename, substring (shorter names first), then optimal-string-alignment typo distance. A query
without a dot compares typos against the filename stem. One edit is allowed for queries shorter
than eight characters, two otherwise; adjacent transpositions count as one. Ties use original
pathname bytes. `--exact-name` disables substring and typo matches; the extension is significant.
This ranking is separate from content scoring and does not modify it.

`-m N/--max-count N` defaults to 50; `0` retains all filename hits. A finite page retains at most
N hits while counting the entire traversal. Text output is one original-byte path per line;
use JSON for newline-containing filenames. `--json` emits one object:

```json
{"hits":[{"path":{"text":"./src/session.rs"},"size":32,"modified":1791800000,"git_status":null}],"total":1,"complete":true,"errors":[],"truncated":false}
```

`path` is a ripgrep-style `text` or base64 `bytes` object. `size` is bytes; `modified` is Unix
seconds. `truncated` means a complete hit set exceeds the requested page, not an incomplete walk.
Exit 0 means hits; 1 means a complete search found none; 2 means invalid input or an incomplete
search, including walk/stat/Git failures. `complete:false` and `errors` accompany partial JSON.
Error lists and Git metadata grow with repository size; there is no universal process RSS limit.

Size and modification-age filters require `<`, `>` or `=` followed by an unsigned integer and
a unit. Size units: `b`, `kb`, `mb`, `gb` (powers of 1024). Age units: `s`, `m`, `h`, `d`.
Comparisons are strict; future modification times have age zero. Git filters require Git and a
repository: `tracked`, `clean`, `modified` (unstaged), `staged`, `untracked`, `ignored`, `conflict`.
A file can satisfy staged and modified together; its displayed status uses conflict, staged,
modified, ignored, clean, untracked precedence. `ignored` requires `--no-ignore` (and `--hidden`
when needed). Spaces and newlines are read through Git's NUL-delimited format. Linked worktrees
and repository subdirectories are supported. Filenames can change during any live traversal;
there is no transactionally consistent filesystem snapshot.

Content-only flags such as `-F`, `-w`, `-C`, `--stream`, `--explain` are rejected in filename mode.
`--find=-name .` treats a leading-dash query literally. Ordinary content patterns named `find`
or `mcp` remain ordinary patterns; `-e --find` and `-- --mcp` are literal content patterns.
Standalone global `--help`, `--version` and `--type-list` retain their original early exits.

## MCP configuration and tools

Configure a client with an absolute executable path and explicit repository arguments:

```json
{"mcpServers":{"hay":{"command":"/absolute/path/to/hay","args":["--mcp","--root","/absolute/repository"]}}}
```

This is stdio only, no port, autostart installer or login integration. The client owns process
lifetime. Repeat `--root` to register additional existing Git repositories/worktrees or their
subdirectories. Startup without roots fails. Tool roots must be existing directories whose
canonical path lies inside a registered canonical scope. Returned paths use that canonical root.
Relative tool roots are interpreted from the server's working directory, so absolute roots are
recommended. MCP roots are search scopes, not an OS sandbox against a hostile process changing
the filesystem concurrently. Discovered symlinks are not followed; matching still uses ambient
filesystem opens. Existing context re-reads use capability-scoped opens. Use OS isolation for
untrusted trees/clients. This server neither writes an index nor collects search/open history.

`tools/list` advertises exactly three tools with SDK-generated input schemas:

| Tool | Required arguments | Optional arguments |
|---|---|---|
| `grep` | `root`, `pattern` | `fixed`, `ignore_case`, `whole_word`, `hidden`, `no_ignore`, `globs`, `types`, `types_not`, `context`, `limit` |
| `find_files` | `root`, `query` | `ignore_case`, `exact`, `hidden`, `no_ignore`, `globs`, `types`, `types_not`, `size`, `mtime`, `git`, `limit` |
| `multi_grep` | `queries` (1–32 `grep` argument objects) | none |

Patterns are literal arguments; no automatic spelling relaxation, combined regex, query rewrite
or retry. MCP globs are relative to each requested root. To compare against CLI, run CLI from that
root with the same flags and canonical absolute PATH. Each batch member keeps its own rank,
exit code and completeness; another member's invalid regex cannot turn it into a no-match.

Successful handler payloads and search/resource failures appear both in `structuredContent` and
as serialized JSON in `content[0].text`. The SDK can return text-only `isError:true` for invalid
argument shapes; malformed JSON-RPC and unknown tools are handled by the SDK. Clients must check
`isError` and not assume every failed call has a structured payload. No output schema is advertised.

`grep` payload:

```json
{"events":[],"exit_code":1,"complete":true,"diagnostic":null,"page_limit":50,"page_truncated":false,"total_matches":0}
```

`events` contains the same ordered match/context records as CLI JSON. `total_matches` counts
matches, not context records. `complete:true` says traversal/ranking succeeded, even when
`page_truncated:true`. Invalid inputs, read errors, cancellation and limits yield exit 2,
`complete:false`, a diagnostic, and `isError:true`. `find_files` uses the filename payload above.
`multi_grep` returns `{"results":[...]}` in input query order; `isError:true` if any member failed.

### Resource and cancellation limits

- Input NDJSON frame: 1 MiB, including terminating LF, enforced before SDK decoding. Exceeding
  it closes the transport and exits 2. Aggregate serialized tool arguments: 128 KiB.
- `limit`: 1–1000 (default 50). Use CLI for unlimited pages. Pattern: 65,536 UTF-8 bytes;
  filename query: 4,096 bytes; combined glob/type filter count: 128; context: 0–100 lines.
- Structured grep: at most four walker threads, 8 MiB search buffer per thread, 8 MiB accounted
  candidate bytes, 8 MiB saved context bytes, 8 MiB encoded capture and 4,096 submatches per row.
  These are separate budgets, not an 8 MiB RSS promise. The ordinary 20,000-candidate gate remains.
- Tool payload: 8 MiB; batch members share that payload budget. JSON text and structured content
  duplicate payload data in the wire response, whose encoded size can exceed 8 MiB.
- One blocking retrieval job at a time. Overlapping calls receive an explicit busy error;
  no unbounded queued jobs. The owned capacity permit stays with the job after cancellation.
- Cancellation is cooperative at file/match boundaries; it cannot interrupt an OS read or Git
  subprocess immediately. EOF terminates the service after active blocking work settles.

These bounds prevent specific runaway inputs/results. They do not sandbox the process or cap all
Git output, traversal metadata, SDK in-flight requests, allocator overhead, or wall-clock time.
