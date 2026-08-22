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
fn declined_flags_explain_themselves_instead_of_looking_nonexistent() {
    for flag in ["-v", "-c", "-o"] {
        hay()
            .args([flag, "x"])
            .assert()
            .code(2)
            .stderr(predicate::str::contains("rg ").and(predicate::str::contains("unknown").not()));
    }
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
fn files_with_matches_prints_plain_paths_even_under_json() {
    // `--json`'s documented contract is match/context messages only, so there is no JSON form
    // of `-l` output — a lone `begin` record per file was neither that contract nor rg-shaped.
    // `-l` wins and prints exactly what plain `-l` prints.
    let d = fixture("files-json");
    let out = hay()
        .args(["-l", "--json", "-F", "validateSession", "."])
        .current_dir(d.path())
        .assert()
        .success();
    let stdout = String::from_utf8(out.get_output().stdout.clone()).unwrap();
    let paths: Vec<String> = stdout
        .lines()
        .map(|l| normalize(l).trim_start_matches("./").into())
        .collect();
    assert_eq!(paths, ["src/auth.ts", "docs/archive/plan-v3.md"]);
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
        .success()
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
            r"^ *[0-9.+-]+ \[def [+-][0-9.]+ path [+-][0-9.]+ tf [+-][0-9.]+\]  "
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
