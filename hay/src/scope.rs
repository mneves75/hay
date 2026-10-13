use std::path::{Path, PathBuf};

/// Registration verifies an explicit Git working tree; it does not create an OS sandbox.
pub(crate) fn repository(root: &Path) -> Result<PathBuf, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("repository root: {e}"))?;
    if !root.is_dir() {
        return Err("repository root must be a directory".into());
    }
    let git = std::process::Command::new("git")
        .arg("-C")
        .arg(&root)
        .args(["rev-parse", "--is-inside-work-tree"])
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .map_err(|e| e.to_string())?;
    if !git.status.success() || git.stdout != b"true\n" {
        return Err("an explicit Git working-tree root is required".into());
    }
    Ok(root)
}
