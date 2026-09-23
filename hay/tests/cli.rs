//! Contract tests against the real binary.
//!
//! The unit tests cover scoring and parsing as functions; `differential-test.sh` proves the match
//! set equals ripgrep's. Neither one runs `hay` and looks at what a caller actually receives, so
//! the exit codes, the separators, the stderr contract and the argument forms an agent types were
//! only ever checked by hand. Every case here is one that has already been wrong at least once.

use std::fs;
use std::path::Path;
use std::process::Command;

use assert_cmd::prelude::*;
use predicates::prelude::*;

/// A small tree with one obvious answer and several distractors.
fn fixture(name: &str) -> tempfile::TempDir {
    let dir = tempfile::Builder::new().prefix(name).tempdir().unwrap();
    let p = dir.path();
    fs::create_dir_all(p.join("src")).unwrap();
    fs::create_dir_all(p.join("docs/archive")).unwrap();
    write(
        p,
        "src/auth.ts",
        "import x from 'y'\nexport function validateSession(t: string) {\n  return t\n}\n",
    );
    write(
        p,
        "docs/archive/plan-v3.md",
        "we will call validateSession from the gateway\nsee validateSession notes\n",
    );
    dir
}

fn write(root: &Path, rel: &str, body: &str) {
    fs::write(root.join(rel), body).unwrap();
}

fn hay() -> Command {
    Command::cargo_bin("hay").unwrap()
}

/// Output paths use the platform separator, so `src/auth.ts` is `src\auth.ts` on Windows.
/// Asserting the literal `/` form would fail the Windows leg on correct output.
fn normalize(s: &str) -> String {
    s.replace('\\', "/")
}

#[test]
fn the_definition_outranks_an_archived_mention() {
    // The behaviour the whole tool exists for, checked end to end rather than as a scoring unit.
    let d = fixture("rank");
    let out = hay()
        .args(["-F", "validateSession", "."])
        .current_dir(d.path())
        .assert()
        .success();
    let stdout = normalize(&String::from_utf8(out.get_output().stdout.clone()).unwrap());
    let first = stdout.lines().next().unwrap();
    assert!(
        first.contains("src/auth.ts") && first.contains("export function"),
        "definition should come first, got: {first}"
    );
}

#[test]
fn exit_codes_follow_ripgrep() {
    let d = fixture("exit");
    hay()
        .args(["-F", "validateSession", "."])
        .current_dir(d.path())
        .assert()
        .code(0);
    hay()
        .args(["-F", "nothing_matches_this", "."])
        .current_dir(d.path())
        .assert()
        .code(1);
    // A mistyped path must not look like "no matches" — an earlier version exited 0 with no
    // output, which is indistinguishable from a successful empty search.
    hay()
        .args(["-F", "x", "no/such/dir"])
        .current_dir(d.path())
        .assert()
        .code(2)
        .stderr(predicate::str::contains("no such file or directory"));
}

#[test]
fn help_exits_zero_and_version_prints_the_crate_version() {
    // `--help` printing usage and exiting 1 or 2 would make a wrapper think the tool is broken;
    // a missing pattern printing help and exiting 0 falsely signalled "match".
    hay()
        .arg("--help")
        .assert()
        .code(0)
        .stdout(predicate::str::contains("ranked grep"));
    hay()
        .arg("--version")
        .assert()
        .code(0)
        .stdout(predicate::str::contains(env!("CARGO_PKG_VERSION")));
    hay()
        .assert()
        .code(2)
        .stderr(predicate::str::contains("missing PATTERN"));
}

#[test]
fn the_argument_forms_agents_actually_type_are_accepted() {
    // Measured across 3,174 transcripts: combined shorts appear 3,562 times, attached values 923,
    // `--flag=value` 61 and `--` 23. Every combined short exited 2 before `lexopt`.
    let d = fixture("forms");
    for args in [
        vec!["-inF", "validatesession", "."],
        vec!["-iF", "--max-count=5", "validatesession", "."],
        vec!["-F", "-m1", "validateSession", "."],
        vec!["-F", "--", "validateSession", "."],
    ] {
        hay()
            .args(&args)
            .current_dir(d.path())
            .assert()
            .code(0)
            .stdout(predicate::str::contains("auth.ts"));
    }
}

#[test]
fn the_unranked_modes_answer_instead_of_refusing() {
    // Until 0.3.0 `-c`, `-v` and `-o` exited 2 telling the caller to go and use ripgrep. They are
    // valid ripgrep invocations; a search tool that answers only the questions it can rank is a
    // tool you have to decide about before you use it. They now run unranked, in ripgrep's
    // parallel traversal order, and `differential-test.sh` holds them to ripgrep's exact output.
    let d = fixture("unranked");
    let count = hay()
        .args(["-c", "-F", "validateSession", "."])
        .current_dir(d.path())
        .assert()
        .success();
    let stdout = normalize(&String::from_utf8(count.get_output().stdout.clone()).unwrap());
    assert!(
        stdout.contains("./src/auth.ts:1"),
        "count per file: {stdout}"
    );
    assert!(
        stdout.contains("./docs/archive/plan-v3.md:2"),
        "count per file: {stdout}"
    );
    // Deliberately NOT an assertion about order. The unranked modes use ripgrep's parallel
    // traversal, which is unordered — that is what makes them as fast as ripgrep, and asserting a
    // fixed order here would encode a design this mode does not have. What must hold is the set.
    let mut files: Vec<&str> = stdout.lines().collect();
    files.sort_unstable();
    assert_eq!(files, ["./docs/archive/plan-v3.md:2", "./src/auth.ts:1"]);

    // `-o` prints the matched substring; `-v` prints what did not match; `--stream` prints
    // everything ripgrep would, with no candidate cap and no ranking.
    hay()
        .args(["-o", "-F", "validateSession", "."])
        .current_dir(d.path())
        .assert()
        .success()
        .stdout(predicate::str::contains("validateSession"));
    hay()
        .args(["-v", "-F", "validateSession", "src/auth.ts"])
        .current_dir(d.path())
        .assert()
        .success()
        .stdout(predicate::str::contains("import x from 'y'"));
    // `normalize` first: Windows prints `src\auth.ts`, and asserting on the raw bytes made this
    // the only red leg of the matrix.
    let streamed = hay()
        .args(["--stream", "-F", "validateSession", "."])
        .current_dir(d.path())
        .assert()
        .success();
    let streamed = normalize(&String::from_utf8(streamed.get_output().stdout.clone()).unwrap());
    assert!(streamed.contains("src/auth.ts"), "streamed: {streamed}");

    // Still exit 1 for "found nothing", never 2.
    hay()
        .args(["--stream", "-F", "nothing_matches_this", "."])
        .current_dir(d.path())
        .assert()
        .code(1);
    // And `--explain` has nothing to explain here, which is said rather than faked with zeros.
    hay()
        .args(["--explain", "--stream", "-F", "validateSession", "."])
        .current_dir(d.path())
        .assert()
        .code(2)
        .stderr(predicate::str::contains("do not rank"));
}

#[test]
fn context_output_matches_ripgreps_separator_convention() {
    // `:` introduces a match line and `-` a context line. Emitting a match with `-` tells a
    // consumer a match is not one, which is how the context rewrite went wrong twice.
    let d = fixture("context");
    let out = hay()
        .args(["-C1", "-F", "validateSession", "src"])
        .current_dir(d.path())
        .assert()
        .success();
    let stdout = normalize(&String::from_utf8(out.get_output().stdout.clone()).unwrap());
    assert!(stdout.contains("src/auth.ts:2:export function validateSession(t: string) {"));
    assert!(stdout.contains("src/auth.ts-1-import x from 'y'"));
    assert!(stdout.contains("src/auth.ts-3-  return t"));
    // No line may appear twice.
    let mut lines: Vec<&str> = stdout.lines().filter(|l| *l != "--").collect();
    let before = lines.len();
    lines.sort_unstable();
    lines.dedup();
    assert_eq!(before, lines.len(), "duplicate output line:\n{stdout}");
}

#[test]
fn json_output_is_one_valid_object_per_line() {
    let d = fixture("json");
    let out = hay()
        .args(["--json", "-F", "validateSession", "."])
        .current_dir(d.path())
        .assert()
        .success();
    let stdout = String::from_utf8(out.get_output().stdout.clone()).unwrap();
    assert!(!stdout.is_empty());
    for line in stdout.lines() {
        let v: serde_json::Value = serde_json::from_str(line).expect("each line must be JSON");
        assert_eq!(v["type"], "match");
        assert!(v["data"]["absolute_offset"].is_number());
        assert!(v["data"]["path"]["text"].is_string());
    }
}

#[test]
fn json_context_records_include_absolute_offsets() {
    let d = fixture("json-context-offset");
    let out = hay()
        .args(["--json", "-C1", "-F", "validateSession", "src/auth.ts"])
        .current_dir(d.path())
        .assert()
        .success();
    let stdout = String::from_utf8(out.get_output().stdout.clone()).unwrap();
    let records: Vec<serde_json::Value> = stdout
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let contexts: Vec<&serde_json::Value> = records
        .iter()
        .filter(|record| record["type"] == "context")
        .collect();
    assert_eq!(contexts.len(), 2);
    assert_eq!(contexts[0]["data"]["line_number"], 1);
    assert_eq!(contexts[0]["data"]["absolute_offset"], 0);
    let line_1 = "import x from 'y'\n";
    let line_2 = "export function validateSession(t: string) {\n";
    assert_eq!(contexts[1]["data"]["line_number"], 3);
    assert_eq!(
        contexts[1]["data"]["absolute_offset"],
        (line_1.len() + line_2.len()) as u64
    );
}

#[test]
fn json_preserves_zero_width_submatches() {
    let d = fixture("json-zero-width");
    for pattern in ["^", "$"] {
        let out = hay()
            .args(["--json", pattern, "src/auth.ts"])
            .current_dir(d.path())
            .assert()
            .success();
        let stdout = String::from_utf8(out.get_output().stdout.clone()).unwrap();
        for line in stdout.lines() {
            let record: serde_json::Value = serde_json::from_str(line).unwrap();
            let span = &record["data"]["submatches"][0];
            let expected = if pattern == "^" {
                0
            } else {
                record["data"]["lines"]["text"]
                    .as_str()
                    .unwrap()
                    .trim_end_matches('\n')
                    .len()
            };
            assert_eq!(span["start"], expected);
            assert_eq!(span["end"], expected);
        }
    }
}

#[test]
fn files_with_matches_prints_one_path_per_line_quoted_under_json() {
    // `--json`'s documented contract is match/context messages only, so there is no JSON form of
    // `-l` output — a lone `begin` record per file was neither that contract nor rg-shaped. `-l`
    // still wins and prints one path per line, but under `--json` the path is a JSON STRING:
    // review found that a filename containing a newline splits one line into two and forges a
    // record in a stream a consumer parses. Quoting keeps every path on one parseable line.
    let d = fixture("files-json");
    let out = hay()
        .args(["-l", "--json", "-F", "validateSession", "."])
        .current_dir(d.path())
        .assert()
        .success();
    let stdout = String::from_utf8(out.get_output().stdout.clone()).unwrap();
    let paths: Vec<String> = stdout
        .lines()
        .map(|l| {
            let unquoted: String = serde_json::from_str(l).expect("each line is a JSON string");
            normalize(&unquoted).trim_start_matches("./").into()
        })
        .collect();
    assert_eq!(paths, ["src/auth.ts", "docs/archive/plan-v3.md"]);

    // Without `--json` it is the bare path, unchanged.
    let plain = hay()
        .args(["-l", "-F", "validateSession", "."])
        .current_dir(d.path())
        .assert()
        .success();
    let stdout = normalize(&String::from_utf8(plain.get_output().stdout.clone()).unwrap());
    assert_eq!(stdout.lines().next().unwrap(), "./src/auth.ts");
}

#[test]
fn a_newline_in_a_filename_cannot_forge_a_json_record() {
    // The defect this quoting exists for, reproduced: a file whose NAME contains a newline used
    // to end one `-l --json` line early and start a second that a consumer would read as another
    // path. Now the whole name is one JSON string on one line.
    let d = tempfile::Builder::new().prefix("forge").tempdir().unwrap();
    let evil = "we\nplan-v3.md";
    if fs::write(d.path().join(evil), "validateSession\n").is_err() {
        return; // a filesystem that rejects newlines in names has nothing to forge
    }
    let out = hay()
        .args(["-l", "--json", "-F", "validateSession", "."])
        .current_dir(d.path())
        .assert()
        .success();
    let stdout = String::from_utf8(out.get_output().stdout.clone()).unwrap();
    assert_eq!(stdout.lines().count(), 1, "one path, one line: {stdout:?}");
    let decoded: String = serde_json::from_str(stdout.lines().next().unwrap()).unwrap();
    assert!(
        decoded.contains('\n'),
        "the newline survives inside the string"
    );
}

#[test]
fn a_gitignored_file_is_not_searched_unless_asked() {
    let d = fixture("ignore");
    write(d.path(), ".gitignore", "secret.txt\n");
    write(d.path(), "secret.txt", "validateSession lives here\n");
    // `.gitignore` only applies inside a git repository — for hay as for ripgrep, verified
    // against `rg` in both states. Without this the fixture proves nothing, and the first
    // version of this test failed for that reason rather than for a defect.
    Command::new("git")
        .args(["init", "-q", "."])
        .current_dir(d.path())
        .assert()
        .success();
    // Default: honoured.
    let out = hay()
        .args(["-F", "validateSession", "."])
        .current_dir(d.path())
        .assert()
        .success();
    let stdout = String::from_utf8(out.get_output().stdout.clone()).unwrap();
    assert!(
        !stdout.contains("secret.txt"),
        "gitignore ignored:\n{stdout}"
    );
    // Explicitly overridden: searched.
    hay()
        .args(["--no-ignore", "-F", "validateSession", "."])
        .current_dir(d.path())
        .assert()
        .success()
        .stdout(predicate::str::contains("secret.txt"));
}

#[test]
fn a_broad_pattern_reports_truncation_rather_than_pretending_to_be_exhaustive() {
    // `-m 0` cannot mean "every match" above the candidate cap. Whatever the cap does, it must
    // not do it silently — that is the whole class of defect this project exists to remember.
    let d = fixture("cap");
    let mut body = String::new();
    for i in 0..25_000 {
        body.push_str(&format!("line {i} config\n"));
    }
    write(d.path(), "big.txt", &body);
    hay()
        .args(["-F", "-m", "0", "config", "."])
        .current_dir(d.path())
        .assert()
        .code(2)
        // The exact phrase is a contract: `measure-mrr.ts` matches /ranked the \d+ strongest/ on
        // stderr to count truncated evaluations. Rewording it silently zeroes that count.
        .stderr(predicate::str::is_match(r"ranked the \d+ strongest").unwrap());
}

#[test]
fn explain_prints_a_per_signal_breakdown() {
    // A total alone cannot say WHICH signal put a line where it is; error analysis reads these
    // components. The bracketed shape is the contract.
    let d = fixture("explain");
    let out = hay()
        .args(["--explain", "-F", "validateSession", "."])
        .current_dir(d.path())
        .assert()
        .success();
    let stdout = normalize(&String::from_utf8(out.get_output().stdout.clone()).unwrap());
    let first = stdout.lines().next().unwrap();
    assert!(
        predicate::str::is_match(
            r"^ *[0-9.+-]+ \[def [+-][0-9.]+ path [+-][0-9.]+ word [+-][0-9.]+ tf [+-][0-9.]+\]  "
        )
        .unwrap()
        .eval(first),
        "explain line format changed: {first}"
    );
    // The definition line carries the definition weight; the archived mention does not.
    let def = stdout.lines().find(|l| l.contains("src/auth.ts")).unwrap();
    assert!(
        def.contains("[def +6.0"),
        "definition signal missing: {def}"
    );
    let mention = stdout.lines().find(|l| l.contains("plan-v3.md")).unwrap();
    assert!(
        mention.contains("[def +0.0"),
        "mention must not score as a definition: {mention}"
    );
}

#[test]
fn a_non_ascii_query_does_not_crash_the_ranker() {
    // Found in review and reproduced here first: scanning a line for a multibyte query advanced
    // one BYTE past a rejected occurrence, so `hay -F -e 'éé'` over `let x = aéé` sliced inside a
    // character and exited 2 with "ranking thread panicked" — on a search ripgrep answers.
    let d = tempfile::Builder::new().prefix("utf8").tempdir().unwrap();
    write(d.path(), "f.txt", "let x = aéé\n");
    hay()
        .args(["-F", "-e", "éé", "."])
        .current_dir(d.path())
        .assert()
        .success()
        .stdout(predicate::str::contains("aéé"))
        .stderr(predicate::str::contains("panic").not());
}

#[test]
fn results_are_interleaved_by_file_and_the_flag_turns_it_off() {
    // The first page is worth more as several files than as several lines of one file: an agent
    // opens files. `--no-diversify` must restore strict score order, or the signal could not be
    // ablated like every other ranking decision.
    let d = tempfile::Builder::new()
        .prefix("diversify")
        .tempdir()
        .unwrap();
    fs::create_dir_all(d.path().join("src")).unwrap();
    write(
        d.path(),
        "src/a.ts",
        "const session = 1\nuse(session)\nuse(session)\n",
    );
    write(d.path(), "src/b.ts", "use(session)\n");
    let files = |args: &[&str]| -> Vec<String> {
        let out = hay().args(args).current_dir(d.path()).assert().success();
        normalize(&String::from_utf8(out.get_output().stdout.clone()).unwrap())
            .lines()
            .map(|l| l.split(':').next().unwrap().to_string())
            .collect()
    };
    let interleaved = files(&["-F", "session", "."]);
    assert_eq!(
        interleaved[1], "./src/b.ts",
        "b.ts must not wait behind a.ts: {interleaved:?}"
    );
    let strict = files(&["--no-diversify", "-F", "session", "."]);
    assert_eq!(
        strict[1], "./src/a.ts",
        "--no-diversify keeps score order: {strict:?}"
    );
    // `-l` prints the same file order either way: diversification is a layout, not a re-ranking.
    assert_eq!(
        files(&["-l", "-F", "session", "."]),
        files(&["-l", "--no-diversify", "-F", "session", "."])
    );
}

#[test]
fn piped_stdin_is_the_input_when_no_path_is_given() {
    // ripgrep's rule. hay searched the working directory instead, so `cmd | hay x` answered a
    // different question and exited 1 — "searched fine, found nothing".
    let d = fixture("stdin");
    assert_cmd::Command::cargo_bin("hay")
        .unwrap()
        .arg("zzz")
        .current_dir(d.path())
        .write_stdin("zzz piped\nnot this\n")
        .assert()
        .success()
        .stdout("<stdin>:1:zzz piped\n");
    assert_cmd::Command::cargo_bin("hay")
        .unwrap()
        .args(["zzz", "-"])
        .current_dir(d.path())
        .write_stdin("no match here\n")
        .assert()
        .code(1);
}

#[test]
fn a_binary_file_named_on_the_command_line_reports_its_match() {
    // A walked file is abandoned at its first NUL; a named one is searched with NUL converted,
    // as ripgrep does. Quitting there too made hay exit 1 on a file ripgrep reports as matching.
    let d = tempfile::tempdir().unwrap();
    fs::write(d.path().join("bin.dat"), b"foo before nul\n\0\nfoo after\n").unwrap();
    hay()
        .args(["foo", "bin.dat"])
        .current_dir(d.path())
        .assert()
        .success()
        .stdout("bin.dat: binary file matches (found \"\\0\" byte around offset 15)\n");
    hay()
        .args(["-c", "foo", "bin.dat"])
        .current_dir(d.path())
        .assert()
        .success()
        .stdout("bin.dat:2\n");
}

#[test]
fn invert_with_max_count_stops_at_the_cap() {
    // `-m` is the searcher's cap. Returning false from the sink under `-v` let grep-searcher
    // resume after the next matching line, so `-v -m 1` printed two lines.
    let d = tempfile::tempdir().unwrap();
    fs::write(d.path().join("c.txt"), "a1\nfoo\na3\n").unwrap();
    hay()
        .args(["-v", "-m", "1", "foo", "c.txt"])
        .current_dir(d.path())
        .assert()
        .success()
        .stdout("c.txt:1:a1\n");
}

#[cfg(unix)]
#[test]
fn a_pattern_that_is_not_utf8_is_an_error_not_a_panic() {
    // `std::env::args` panicked (exit 101) on such an argument: neither "no match" nor "error".
    use std::os::unix::ffi::OsStrExt;
    hay()
        .arg(std::ffi::OsStr::from_bytes(b"\xff"))
        .arg(".")
        .assert()
        .code(2)
        .stderr(predicate::str::contains("PATTERN must be valid UTF-8"));
}

#[test]
fn vcs_metadata_is_excluded_at_any_depth_unless_a_glob_asks_for_it() {
    // The exclusion covers a nested checkout's `.git` (the differential harness gives ripgrep
    // `-g '!.git/'`), yet stays a default an explicit include glob can override, as SECURITY.md
    // promises: pruning `.git` as a directory made `--hidden -g '.git/**'` return nothing.
    let d = tempfile::tempdir().unwrap();
    for rel in [".git", "n/.git", "src"] {
        fs::create_dir_all(d.path().join(rel)).unwrap();
    }
    write(d.path(), ".git/config", "foo top\n");
    write(d.path(), "n/.git/config", "foo nested\n");
    write(d.path(), "src/a.rs", "foo src\n");
    let files = |args: &[&str]| -> String {
        let out = hay().args(args).current_dir(d.path()).assert().success();
        normalize(&String::from_utf8(out.get_output().stdout.clone()).unwrap())
    };
    assert_eq!(files(&["--hidden", "-l", "foo", "."]), "./src/a.rs\n");
    assert_eq!(
        files(&["--hidden", "-g", ".git/**", "-l", "foo", "."]),
        "./.git/config\n"
    );
}

#[test]
fn json_context_in_a_named_binary_file_counts_lines_as_the_searcher_does() {
    // The searcher numbers a named file with NUL converted to a line break; re-reading context
    // by `\n` alone then printed the wrong lines after the NUL, and the NUL as a line's content.
    let d = tempfile::tempdir().unwrap();
    fs::write(
        d.path().join("b.dat"),
        b"a0\nfoo before\n\0\nctx x\nfoo after\nctx y\n",
    )
    .unwrap();
    let out = hay()
        .args(["--json", "-C1", "foo", "b.dat"])
        .current_dir(d.path())
        .assert()
        .success();
    let mut got: Vec<(u64, String)> = String::from_utf8(out.get_output().stdout.clone())
        .unwrap()
        .lines()
        .map(|l| {
            let v: serde_json::Value = serde_json::from_str(l).unwrap();
            (
                v["data"]["line_number"].as_u64().unwrap(),
                v["data"]["lines"]["text"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    got.sort();
    let want: Vec<(u64, String)> = [
        (1, "a0\n"),
        (2, "foo before\n"),
        (3, "\n"),
        (5, "ctx x\n"),
        (6, "foo after\n"),
        (7, "ctx y\n"),
    ]
    .iter()
    .map(|&(n, t)| (n, t.to_string()))
    .collect();
    assert_eq!(got, want);
}

// Linux only: macOS (APFS) refuses to create a file whose name is not UTF-8.
#[cfg(target_os = "linux")]
#[test]
fn a_filename_that_is_not_utf8_is_printed_as_ripgrep_prints_it() {
    use std::os::unix::ffi::OsStrExt;
    let d = tempfile::tempdir().unwrap();
    let name = std::ffi::OsStr::from_bytes(b"caf\xe9.txt");
    fs::write(d.path().join(name), "foo\n").unwrap();
    let out = hay()
        .args(["-l", "foo", "."])
        .current_dir(d.path())
        .assert()
        .success();
    assert_eq!(out.get_output().stdout, b"./caf\xe9.txt\n");
    // And as PATH, which `args_os` now accepts: the printed name must be the file's name.
    let out = hay()
        .arg("foo")
        .arg(name)
        .current_dir(d.path())
        .assert()
        .success();
    assert_eq!(out.get_output().stdout, b"caf\xe9.txt:1:foo\n");
}
