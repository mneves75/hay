use assert_cmd::prelude::*;
use std::{fs, process::Command};

#[cfg(target_os = "macos")]
#[test]
fn git_filters_honor_macos_precomposed_paths() {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("re\u{301}po");
    fs::create_dir(&root).unwrap();
    for args in [
        vec!["init", "-q"],
        vec!["config", "core.precomposeUnicode", "true"],
    ] {
        Command::new("git")
            .args(args)
            .current_dir(&root)
            .assert()
            .success();
    }
    fs::write(root.join("cafe\u{301}.txt"), "").unwrap();
    Command::new("git")
        .args(["add", "."])
        .current_dir(&root)
        .assert()
        .success();
    for state in ["tracked", "staged"] {
        let response = json(&root, &["--find", "café", "--git", state, "."], 0);
        assert_eq!(response["total"], 1, "{response}");
    }
    let response = json(&root, &["--find", "café", "--git", "untracked", "."], 1);
    assert_eq!(response["total"], 0);
}

#[cfg(target_os = "linux")]
#[test]
fn git_filters_preserve_distinct_unicode_byte_paths() {
    let d = tempfile::tempdir().unwrap();
    Command::new("git")
        .args(["init", "-q"])
        .current_dir(d.path())
        .assert()
        .success();
    fs::write(d.path().join("café.txt"), "").unwrap();
    fs::write(d.path().join("cafe\u{301}.txt"), "").unwrap();
    Command::new("git")
        .args(["add", "café.txt"])
        .current_dir(d.path())
        .assert()
        .success();
    let tracked = json(d.path(), &["--find", "café", "--git", "tracked", "."], 0);
    let untracked = json(d.path(), &["--find", "café", "--git", "untracked", "."], 0);
    assert_eq!(tracked["total"], 1);
    assert_eq!(untracked["total"], 1);
    assert_ne!(tracked["hits"][0]["path"], untracked["hits"][0]["path"]);
}

#[test]
fn git_filters_use_repository_paths_when_searching_a_subdirectory() {
    let d = tempfile::tempdir().unwrap();
    let git = |args: &[&str]| {
        Command::new("git")
            .args(args)
            .current_dir(d.path())
            .assert()
            .success();
    };
    git(&["init", "-q"]);
    fs::create_dir(d.path().join("src")).unwrap();
    fs::write(d.path().join("src/name-clean.rs"), "").unwrap();
    git(&["add", "."]);
    git(&[
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        "fixture",
    ]);
    fs::write(d.path().join("src/name-new.rs"), "").unwrap();
    for state in ["clean", "tracked", "untracked"] {
        let response = json(d.path(), &["--find", "name", "src", "--git", state], 0);
        assert_eq!(response["total"], 1, "{state}: {response}");
        let name = if state == "untracked" {
            "name-new.rs"
        } else {
            "name-clean.rs"
        };
        assert!(
            response["hits"][0]["path"]["text"]
                .as_str()
                .unwrap()
                .ends_with(name)
        );
    }
}

fn hay() -> Command {
    Command::cargo_bin("hay").unwrap()
}

#[test]
fn live_filename_search_ranks_exact_before_substring_and_typo() {
    let d = tempfile::tempdir().unwrap();
    for name in ["session", "session-handler.rs", "sesison"] {
        fs::write(d.path().join(name), "").unwrap();
    }
    let out = hay()
        .current_dir(d.path())
        .args(["--find", "session", "."])
        .assert()
        .success();
    let stdout = String::from_utf8(out.get_output().stdout.clone()).unwrap();
    let names: Vec<_> = stdout
        .lines()
        .map(|p| {
            std::path::Path::new(p)
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
        })
        .collect();
    assert_eq!(names, ["session", "session-handler.rs", "sesison"]);
}

#[test]
fn typo_search_matches_stems_with_extensions_and_unicode_normalization() {
    let d = tempfile::tempdir().unwrap();
    fs::write(d.path().join("sesison.rs"), "").unwrap();
    hay()
        .current_dir(d.path())
        .args(["--find", "session", "."])
        .assert()
        .success();
    fs::write(d.path().join("cafe\u{301}.rs"), "").unwrap();
    hay()
        .current_dir(d.path())
        .args(["--find", "CAFÉ.RS", ".", "-i", "--exact-name"])
        .assert()
        .success();
}

fn json(root: &std::path::Path, args: &[&str], code: i32) -> serde_json::Value {
    let out = hay()
        .current_dir(root)
        .arg("--json")
        .args(args)
        .assert()
        .code(code);
    serde_json::from_slice(&out.get_output().stdout).unwrap()
}

#[test]
fn paging_reports_total_without_claiming_an_incomplete_traversal() {
    let d = tempfile::tempdir().unwrap();
    for name in ["name-a.rs", "name-b.rs", "name-c.rs"] {
        fs::write(d.path().join(name), "").unwrap();
    }
    let page = json(d.path(), &["--find", "name", ".", "-m", "1"], 0);
    assert_eq!(page["total"], 3);
    assert_eq!(page["complete"], true);
    assert_eq!(page["truncated"], true);
    assert_eq!(page["hits"].as_array().unwrap().len(), 1);
    let all = json(d.path(), &["--find", "name", ".", "-m", "0"], 0);
    assert_eq!(all["hits"].as_array().unwrap().len(), 3);
    assert_eq!(all["truncated"], false);
}

#[test]
fn attached_and_combined_options_preserve_literal_query_values() {
    let d = tempfile::tempdir().unwrap();
    fs::create_dir(d.path().join("src")).unwrap();
    fs::write(d.path().join("src/MAIN.rs"), "1234").unwrap();
    let result = json(
        d.path(),
        &["--find=main", ".", "-igsrc/*.rs", "--size=>1b", "-m1"],
        0,
    );
    assert_eq!(result["total"], 1);
    fs::write(d.path().join("-literal"), "").unwrap();
    assert_eq!(
        json(
            d.path(),
            &["--find", "-literal", "--exact-name", "--", "."],
            0
        )["total"],
        1
    );
}

#[test]
fn a_late_stronger_filename_displaces_a_weak_hit_without_losing_total() {
    let d = tempfile::tempdir().unwrap();
    fs::create_dir(d.path().join("a")).unwrap();
    fs::create_dir(d.path().join("z")).unwrap();
    for (name, body) in [
        ("a/name-weak.rs", ""),
        ("z/name", ""),
        ("z/name-more.rs", ""),
    ] {
        fs::write(d.path().join(name), body).unwrap();
    }
    let result = json(d.path(), &["--find", "name", ".", "-m", "1"], 0);
    assert_eq!(result["total"], 3);
    assert_eq!(result["hits"].as_array().unwrap().len(), 1);
    assert!(
        result["hits"][0]["path"]["text"]
            .as_str()
            .unwrap()
            .replace('\\', "/")
            .ends_with("/z/name")
    );
}

#[test]
fn live_search_observes_mutations_and_ignore_changes_without_a_cache() {
    let d = tempfile::tempdir().unwrap();
    Command::new("git")
        .args(["init", "-q"])
        .current_dir(d.path())
        .assert()
        .success();
    fs::write(d.path().join("name.json"), "{}").unwrap();
    let args = ["--find", "name", "."];
    assert_eq!(json(d.path(), &args, 0)["total"], 1);
    fs::rename(d.path().join("name.json"), d.path().join("name.lock")).unwrap();
    assert!(
        json(d.path(), &args, 0)["hits"][0]["path"]["text"]
            .as_str()
            .unwrap()
            .replace('\\', "/")
            .ends_with("/name.lock")
    );
    fs::write(d.path().join(".gitignore"), "name.lock\n").unwrap();
    assert_eq!(json(d.path(), &args, 1)["total"], 0);
    fs::write(d.path().join(".gitignore"), "").unwrap();
    assert_eq!(json(d.path(), &args, 0)["total"], 1);
    fs::remove_file(d.path().join("name.lock")).unwrap();
    assert_eq!(json(d.path(), &args, 1)["total"], 0);
}

#[test]
fn file_filters_apply_to_the_same_live_names() {
    let d = tempfile::tempdir().unwrap();
    fs::create_dir(d.path().join("src")).unwrap();
    fs::write(d.path().join("src/name.rs"), "12345").unwrap();
    fs::write(d.path().join("name.ts"), "123").unwrap();
    let rs = json(d.path(), &["--find", "name", ".", "-t", "rust"], 0);
    assert_eq!(rs["total"], 1);
    let size = json(d.path(), &["--find", "name", ".", "--size", "=3b"], 0);
    assert_eq!(size["total"], 1);
    let glob = json(d.path(), &["--find", "name", ".", "-g", "src/*.rs"], 0);
    assert_eq!(glob["total"], 1);
    let recent = json(
        d.path(),
        &["--find", "name", ".", "--mtime", "<1d", "-T", "rust"],
        0,
    );
    assert_eq!(recent["total"], 1);
}

#[test]
fn invalid_filters_and_incompatible_content_flags_fail_loudly() {
    let d = tempfile::tempdir().unwrap();
    for filter in [
        "1kb",
        "<1.2kb",
        ">18446744073709551615gb",
        "=1",
        "=1KB",
        "=+1b",
    ] {
        hay()
            .current_dir(d.path())
            .args(["--find", "name", "--size", filter])
            .assert()
            .code(2);
    }
    for args in [
        vec!["--find", ""],
        vec!["--find", "name", "--git", "ignored"],
        vec!["--find", "name", "--git", "bogus"],
        vec!["--find", "name", "-w"],
        vec!["--find", "name", "--max-count", "-1"],
        vec!["--find", "name", "--mtime", "=1b"],
    ] {
        hay().current_dir(d.path()).args(args).assert().code(2);
    }
    hay()
        .current_dir(d.path())
        .args(["--find", "name", "missing-directory"])
        .assert()
        .code(2);
    hay()
        .current_dir(d.path())
        .args(["--find", "name", "--git", "clean"])
        .assert()
        .code(2);
}

#[test]
fn filtered_search_preserves_normalized_ignore_inputs_and_user_vcs_overrides() {
    let d = tempfile::tempdir().unwrap();
    Command::new("git")
        .args(["init", "-q"])
        .current_dir(d.path())
        .assert()
        .success();
    fs::write(d.path().join("name.rs"), "").unwrap();
    fs::write(d.path().join(".ignore"), "name.rs\n").unwrap();
    fs::write(d.path().join(".git/info/exclude"), "name.rs\n").unwrap();
    fs::write(d.path().join(".name-hidden.rs"), "").unwrap();
    fs::write(d.path().join(".git/name.rs"), "").unwrap();
    assert_eq!(json(d.path(), &["--find", "name", "."], 0)["total"], 1);
    assert_eq!(
        json(d.path(), &["--find", "name", ".", "--hidden"], 0)["total"],
        2
    );
    assert_eq!(
        json(
            d.path(),
            &["--find", "name", ".", "--hidden", "-g", ".git/**"],
            0
        )["total"],
        1
    );
}

#[test]
fn git_filters_work_in_a_linked_worktree() {
    let source = tempfile::tempdir().unwrap();
    let checkout_parent = tempfile::tempdir().unwrap();
    let checkout = checkout_parent.path().join("checkout");
    let git = |args: &[&std::ffi::OsStr]| {
        Command::new("git")
            .args(args)
            .current_dir(source.path())
            .assert()
            .success();
    };
    git(&["init".as_ref(), "-q".as_ref()]);
    fs::write(source.path().join("name.rs"), "original").unwrap();
    git(&["add".as_ref(), ".".as_ref()]);
    git(&[
        "-c".as_ref(),
        "user.name=Test".as_ref(),
        "-c".as_ref(),
        "user.email=test@example.invalid".as_ref(),
        "commit".as_ref(),
        "-qm".as_ref(),
        "fixture".as_ref(),
    ]);
    git(&["worktree".as_ref(), "list".as_ref()]);
    git(&[
        "worktree".as_ref(),
        "add".as_ref(),
        "-q".as_ref(),
        "--detach".as_ref(),
        checkout.as_os_str(),
    ]);
    assert!(checkout.join(".git").is_file());
    assert_eq!(
        json(&checkout, &["--find", "name", ".", "--git", "clean"], 0)["total"],
        1
    );
    fs::write(checkout.join("name.rs"), "changed").unwrap();
    assert_eq!(
        json(&checkout, &["--find", "name", ".", "--git", "modified"], 0)["total"],
        1
    );
    // Remove the file mutation before asking Git to clean up this test-owned worktree.
    fs::write(checkout.join("name.rs"), "original").unwrap();
    git(&["worktree".as_ref(), "remove".as_ref(), checkout.as_os_str()]);
}

#[test]
fn git_filters_preserve_spaces_and_newlines_and_report_real_status() {
    let d = tempfile::tempdir().unwrap();
    let git = |args: &[&str]| {
        Command::new("git")
            .args(args)
            .current_dir(d.path())
            .assert()
            .success();
    };
    git(&["init", "-q"]);
    let staged = "name staged.rs";
    let modified = if cfg!(unix) {
        "name\nmodified.rs"
    } else {
        "name modified.rs"
    };
    for name in [staged, modified, "name-clean.rs"] {
        fs::write(d.path().join(name), "original").unwrap();
    }
    git(&["add", "."]);
    git(&[
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.invalid",
        "commit",
        "-qm",
        "fixture",
    ]);
    fs::write(d.path().join(staged), "staged").unwrap();
    git(&["add", staged]);
    fs::write(d.path().join(modified), "modified").unwrap();
    fs::write(d.path().join("name-untracked.rs"), "").unwrap();
    fs::write(
        d.path().join(".gitignore"),
        "name-ignored.rs\nignored-dir/\n",
    )
    .unwrap();
    fs::write(d.path().join("name-ignored.rs"), "").unwrap();
    fs::create_dir(d.path().join("ignored-dir")).unwrap();
    fs::write(d.path().join("ignored-dir/name-nested.rs"), "").unwrap();
    for status in ["staged", "modified", "clean"] {
        let result = json(d.path(), &["--find", "name", ".", "--git", status], 0);
        assert_eq!(result["total"], 1, "status {status}: {result}");
        assert_eq!(result["hits"][0]["git_status"], status);
    }
    assert_eq!(
        json(d.path(), &["--find", "name", ".", "--git", "tracked"], 0)["total"],
        3
    );
    assert_eq!(
        json(d.path(), &["--find", "name", ".", "--git", "untracked"], 0)["total"],
        1
    );
    assert_eq!(
        json(
            d.path(),
            &["--find", "name", ".", "--git", "ignored", "--no-ignore"],
            0
        )["total"],
        2
    );
}

// macOS APFS rejects invalid UTF-8 filenames before hay can observe them.
#[cfg(target_os = "linux")]
#[test]
fn invalid_utf8_names_are_discovered_without_changing_their_bytes() {
    use std::os::unix::ffi::OsStringExt;
    let d = tempfile::tempdir().unwrap();
    fs::write(
        d.path()
            .join(std::ffi::OsString::from_vec(b"name-\xff.rs".to_vec())),
        "",
    )
    .unwrap();
    let result = json(d.path(), &["--find", "name", "."], 0);
    assert_eq!(result["total"], 1);
    assert!(result["hits"][0]["path"]["bytes"].is_string());
    fs::write(d.path().join("name-\u{fffd}.rs"), "").unwrap();
    let exact = json(
        d.path(),
        &["--find", "name-\u{fffd}.rs", "--exact-name", "."],
        0,
    );
    assert_eq!(
        exact["total"], 1,
        "lossy display cannot forge an exact name"
    );
    assert!(exact["hits"][0]["path"]["text"].is_string());
}
