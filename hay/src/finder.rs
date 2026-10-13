//! Live filename discovery. Indexes never decide which files exist in this mode.
use std::{ffi::OsString, path::PathBuf};
use unicode_normalization::UnicodeNormalization;

#[derive(Clone, Debug)]
pub struct FindRequest {
    pub query: String,
    pub root: PathBuf,
    pub globs: Vec<String>,
    pub types: Vec<String>,
    pub types_not: Vec<String>,
    pub hidden: bool,
    pub no_ignore: bool,
    pub ignore_case: bool,
    pub exact: bool,
    pub limit: usize,
    pub size: Option<String>,
    pub mtime: Option<String>,
    pub git: Option<String>,
}

impl Default for FindRequest {
    fn default() -> Self {
        Self {
            query: String::new(),
            root: PathBuf::from("."),
            globs: vec![],
            types: vec![],
            types_not: vec![],
            hidden: false,
            no_ignore: false,
            ignore_case: false,
            exact: false,
            limit: 50,
            size: None,
            mtime: None,
            git: None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct FindHit {
    pub path: PathBuf,
    pub size: u64,
    pub modified: u64,
    pub git_status: Option<String>,
}

#[derive(Clone, Debug)]
pub struct FindResponse {
    pub hits: Vec<FindHit>,
    pub total: usize,
    pub complete: bool,
    pub errors: Vec<String>,
}

pub fn parse_cli(args: Vec<OsString>) -> Result<(FindRequest, bool), String> {
    use lexopt::prelude::*;
    let mut request = FindRequest::default();
    let mut json = false;
    let mut query = false;
    let mut root = false;
    let mut parser = lexopt::Parser::from_args(args);
    while let Some(arg) = parser.next().map_err(|e| e.to_string())? {
        match arg {
            Long("find") if !query => {
                request.query = value(&mut parser, "--find")?;
                query = true;
            }
            Short('g') | Long("glob") => request.globs.push(value(&mut parser, "--glob")?),
            Short('t') | Long("type") => request.types.push(value(&mut parser, "--type")?),
            Short('T') | Long("type-not") => {
                request.types_not.push(value(&mut parser, "--type-not")?)
            }
            Long("hidden") => request.hidden = true,
            Long("no-ignore") => request.no_ignore = true,
            Short('i') | Long("ignore-case") => request.ignore_case = true,
            Long("exact-name") => request.exact = true,
            Long("json") => json = true,
            Short('m') | Long("max-count") => {
                let count = value(&mut parser, "--max-count")?;
                if count.is_empty() || !count.bytes().all(|b| b.is_ascii_digit()) {
                    return Err("invalid --max-count".into());
                }
                request.limit = count.parse().map_err(|_| "invalid --max-count")?;
            }
            Long("size") => request.size = Some(value(&mut parser, "--size")?),
            Long("mtime") => request.mtime = Some(value(&mut parser, "--mtime")?),
            Long("git") => request.git = Some(value(&mut parser, "--git")?),
            Value(arg) if !root => {
                request.root = arg.into();
                root = true;
            }
            Value(_) => return Err("multiple filename roots".into()),
            option => return Err(format!("unsupported filename-search option: {option:?}")),
        }
    }
    if !query || request.query.is_empty() {
        return Err("missing filename QUERY".into());
    }
    validate(&request)?;
    Ok((request, json))
}

fn value(parser: &mut lexopt::Parser, flag: &str) -> Result<String, String> {
    parser
        .value()
        .map_err(|e| format!("{flag}: {e}"))?
        .into_string()
        .map_err(|_| format!("{flag} requires UTF-8"))
}

// The heap root is the weakest retained hit. Its key includes original pathname bytes,
// so a page has the same deterministic order as an exhaustive search.
struct RankedHit {
    score: (u8, usize),
    hit: FindHit,
}
impl Ord for RankedHit {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.score.cmp(&other.score).then_with(|| {
            self.hit
                .path
                .as_os_str()
                .as_encoded_bytes()
                .cmp(other.hit.path.as_os_str().as_encoded_bytes())
        })
    }
}
impl PartialOrd for RankedHit {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl PartialEq for RankedHit {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other).is_eq()
    }
}
impl Eq for RankedHit {}

fn normalized(s: &str, insensitive: bool) -> String {
    let n: String = s.nfc().collect();
    if insensitive { n.to_lowercase() } else { n }
}

fn rank(name: &str, query: &str, exact: bool) -> Option<(u8, usize)> {
    if name == query {
        return Some((0, 0));
    }
    if exact {
        return None;
    }
    if name.contains(query) {
        return Some((1, name.chars().count()));
    }
    // A conceptual filename query usually omits the extension. Keep exact/substring
    // precedence above, but let a typo match the stem without charging for `.rs`.
    let fuzzy_name = if query.contains('.') {
        name
    } else {
        name.rsplit_once('.')
            .filter(|(stem, _)| !stem.is_empty())
            .map_or(name, |(stem, _)| stem)
    };
    let a: Vec<_> = fuzzy_name.chars().collect();
    let b: Vec<_> = query.chars().collect();
    let threshold = if b.len() >= 8 { 2 } else { 1 };
    if a.len().abs_diff(b.len()) > threshold {
        return None;
    }
    // Optimal-string-alignment distance permits the adjacent transposition typical of typos.
    let mut previous: Vec<_> = (0..=b.len()).collect();
    let mut before = previous.clone();
    for (i, ac) in a.iter().enumerate() {
        let mut current = vec![i + 1; b.len() + 1];
        for (j, bc) in b.iter().enumerate() {
            current[j + 1] = (previous[j + 1] + 1)
                .min(current[j] + 1)
                .min(previous[j] + usize::from(ac != bc));
            if i > 0 && j > 0 && a[i] == b[j - 1] && a[i - 1] == b[j] {
                current[j + 1] = current[j + 1].min(before[j - 1] + 1);
            }
        }
        before = previous;
        previous = current;
    }
    let distance = previous[b.len()];
    (distance <= threshold).then_some((2, distance))
}

fn validate(request: &FindRequest) -> Result<(), String> {
    if request.query.is_empty() {
        return Err("missing filename QUERY".into());
    }
    if let Some(s) = &request.size {
        Filter::parse(s, false)?;
    }
    if let Some(s) = &request.mtime {
        Filter::parse(s, true)?;
    }
    if let Some(git) = request.git.as_deref() {
        if ![
            "modified",
            "staged",
            "untracked",
            "clean",
            "tracked",
            "ignored",
            "conflict",
        ]
        .contains(&git)
        {
            return Err(format!("invalid --git status: {git}"));
        }
        if git == "ignored" && !request.no_ignore {
            return Err("--git ignored requires --no-ignore".into());
        }
    }
    Ok(())
}

struct Filter {
    op: u8,
    value: u64,
}
impl Filter {
    fn parse(input: &str, time: bool) -> Result<Self, String> {
        let bad = || {
            format!(
                "invalid {} filter: {input}",
                if time { "mtime" } else { "size" }
            )
        };
        let op = *input.as_bytes().first().ok_or_else(bad)?;
        if !b"<>=".contains(&op) {
            return Err(bad());
        }
        let rest = &input[1..];
        let end = rest.bytes().take_while(u8::is_ascii_digit).count();
        if end == 0 {
            return Err(bad());
        }
        let number: u64 = rest[..end].parse().map_err(|_| bad())?;
        let factor = match (&rest[end..], time) {
            ("s", true) | ("b", false) => 1,
            ("m", true) => 60,
            ("h", true) => 3600,
            ("d", true) => 86400,
            ("kb", false) => 1024,
            ("mb", false) => 1024 * 1024,
            ("gb", false) => 1024 * 1024 * 1024,
            _ => return Err(bad()),
        };
        Ok(Self {
            op,
            value: number.checked_mul(factor).ok_or_else(bad)?,
        })
    }
    fn matches(&self, actual: u64) -> bool {
        match self.op {
            b'<' => actual < self.value,
            b'>' => actual > self.value,
            _ => actual == self.value,
        }
    }
}

pub fn find(request: &FindRequest) -> Result<FindResponse, String> {
    find_cancellable(request, None)
}

pub(crate) fn find_cancellable(
    request: &FindRequest,
    cancelled: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
) -> Result<FindResponse, String> {
    validate(request)?;
    let size = request
        .size
        .as_deref()
        .map(|s| Filter::parse(s, false))
        .transpose()?;
    let mtime = request
        .mtime
        .as_deref()
        .map(|s| Filter::parse(s, true))
        .transpose()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let git = request
        .git
        .as_ref()
        .map(|_| GitState::read(&request.root))
        .transpose()?;
    let walker = crate::walk::builder(
        &request.root,
        crate::walk::Filters {
            hidden: request.hidden,
            no_ignore: request.no_ignore,
            types: &request.types,
            types_not: &request.types_not,
            globs: &request.globs,
            glob_root: cancelled.is_some().then_some(request.root.as_path()),
        },
    )?;
    let query = normalized(&request.query, request.ignore_case);
    let mut errors = Vec::new();
    let mut ranked = std::collections::BinaryHeap::new();
    let mut total = 0;
    for entry in walker.build() {
        if cancelled
            .as_ref()
            .is_some_and(|c| c.load(std::sync::atomic::Ordering::Relaxed))
        {
            errors.push("filename search cancelled; results incomplete".into());
            break;
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                errors.push(e.to_string());
                continue;
            }
        };
        if let Some(e) = entry.error() {
            errors.push(e.to_string());
        }
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let raw_name = entry.file_name().to_str();
        if request.exact && raw_name.is_none() {
            continue; // A UTF-8 query cannot exactly name an invalid-UTF-8 basename.
        }
        // Invalid UTF-8 paths remain discoverable by a Unicode query matching their valid
        // prefix; ranking is deterministic on the original path, not this display conversion.
        let name = normalized(
            &raw_name.map_or_else(
                || entry.file_name().to_string_lossy().into_owned(),
                str::to_owned,
            ),
            request.ignore_case,
        );
        let Some(score) = rank(&name, &query, request.exact) else {
            continue;
        };
        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(e) => {
                errors.push(e.to_string());
                continue;
            }
        };
        let modified = match metadata.modified().and_then(|m| {
            m.duration_since(std::time::UNIX_EPOCH)
                .map_err(std::io::Error::other)
        }) {
            Ok(t) => t.as_secs(),
            Err(e) => {
                errors.push(format!("{}: {e}", entry.path().display()));
                continue;
            }
        };
        if size.as_ref().is_some_and(|f| !f.matches(metadata.len()))
            || mtime
                .as_ref()
                .is_some_and(|f| !f.matches(now.saturating_sub(modified)))
        {
            continue;
        }
        let git_status = if let Some(state) = &git {
            let flags = state.flags(entry.path())?;
            if !flags.matches(request.git.as_deref().unwrap()) {
                continue;
            }
            Some(flags.label().to_owned())
        } else {
            None
        };
        total += 1;
        let candidate = RankedHit {
            score,
            hit: FindHit {
                path: entry.into_path(),
                size: metadata.len(),
                modified,
                git_status,
            },
        };
        if request.limit == 0 || ranked.len() < request.limit {
            ranked.push(candidate);
        } else if ranked.peek().is_some_and(|worst| candidate < *worst) {
            // Replace through the guard so the heap repairs itself on drop.
            *ranked.peek_mut().unwrap() = candidate;
        }
    }
    Ok(FindResponse {
        hits: ranked
            .into_sorted_vec()
            .into_iter()
            .map(|ranked| ranked.hit)
            .collect(),
        total,
        complete: errors.is_empty(),
        errors,
    })
}

#[derive(Default)]
struct GitFlags {
    tracked: bool,
    staged: bool,
    modified: bool,
    ignored: bool,
    conflict: bool,
}
impl GitFlags {
    fn matches(&self, query: &str) -> bool {
        match query {
            "tracked" => self.tracked,
            "clean" => self.tracked && !self.modified && !self.staged && !self.conflict,
            "modified" => self.modified,
            "staged" => self.staged,
            "ignored" => self.ignored,
            "untracked" => !self.tracked && !self.ignored,
            "conflict" => self.conflict,
            _ => false,
        }
    }
    fn label(&self) -> &str {
        if self.conflict {
            "conflict"
        } else if self.staged {
            "staged"
        } else if self.modified {
            "modified"
        } else if self.ignored {
            "ignored"
        } else if self.tracked {
            "clean"
        } else {
            "untracked"
        }
    }
}

struct GitState {
    root: PathBuf,
    paths: std::collections::HashMap<PathBuf, GitFlags>,
    #[cfg(target_os = "macos")]
    precompose_unicode: bool,
}
impl GitState {
    fn read(root: &std::path::Path) -> Result<Self, String> {
        let dir = if root.is_file() {
            root.parent().unwrap_or(std::path::Path::new("."))
        } else {
            root
        };
        let base = git_output(dir, &["rev-parse", "--show-toplevel"])?;
        // Git emits one terminating LF; removing only that byte preserves newlines in paths.
        let base = base.strip_suffix(b"\n").unwrap_or(&base);
        // Both sides must use canonical paths, including Windows' extended path prefix.
        let root = std::fs::canonicalize(PathBuf::from(bytes_os(base)?))
            .map_err(|e| format!("Git repository root: {e}"))?;
        let mut state = Self {
            root,
            paths: Default::default(),
            #[cfg(target_os = "macos")]
            precompose_unicode: git_output(
                dir,
                &[
                    "config",
                    "--bool",
                    "--default=false",
                    "--get",
                    "core.precomposeUnicode",
                ],
            )?
            .strip_suffix(b"\n")
            .is_some_and(|value| value == b"true"),
        };
        for name in git_output(dir, &["ls-files", "--full-name", "-z"])?
            .split(|b| *b == 0)
            .filter(|p| !p.is_empty())
        {
            let key = state.key(&PathBuf::from(bytes_os(name)?));
            state.paths.entry(key).or_default().tracked = true;
        }
        // Explicit files are emitted even for ignored directories; no lossy pathname parsing.
        let status = git_output(
            dir,
            &[
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
                "--ignored=matching",
            ],
        )?;
        let mut rows = status.split(|b| *b == 0).filter(|p| !p.is_empty());
        while let Some(row) = rows.next() {
            if row.len() < 4 {
                return Err("malformed Git status".into());
            }
            let x = row[0];
            let y = row[1];
            let key = state.key(&PathBuf::from(bytes_os(&row[3..])?));
            let flag = state.paths.entry(key).or_default();
            if x == b'!' && y == b'!' {
                flag.ignored = true;
            } else if x != b'?' {
                flag.tracked = true;
                flag.staged = x != b' ';
                flag.modified = y != b' ';
                flag.conflict = x == b'U' || y == b'U' || &row[..2] == b"AA" || &row[..2] == b"DD";
            }
            if x == b'R' || x == b'C' || y == b'R' || y == b'C' {
                rows.next().ok_or("missing Git rename source")?;
            }
        }
        Ok(state)
    }
    fn key(&self, path: &std::path::Path) -> PathBuf {
        // Git on macOS can precompose names that the filesystem returns decomposed.
        // Match that configured policy only there: Linux may hold both byte spellings.
        #[cfg(target_os = "macos")]
        if self.precompose_unicode
            && let Some(text) = path.to_str()
        {
            return PathBuf::from(text.nfc().collect::<String>());
        }
        path.to_path_buf()
    }
    fn flags(&self, path: &std::path::Path) -> Result<&GitFlags, String> {
        let absolute =
            std::fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let relative = absolute
            .strip_prefix(&self.root)
            .map_err(|_| "file outside Git repository")?;
        let relative = self.key(relative);
        if let Some(flags) = self.paths.get(&relative) {
            return Ok(flags);
        }
        // Porcelain represents ignored directories as one row with a trailing slash.
        for ancestor in relative.ancestors().skip(1) {
            if let Some(flags) = self.paths.get(ancestor).filter(|f| f.ignored) {
                return Ok(flags);
            }
        }
        static UNTRACKED: GitFlags = GitFlags {
            tracked: false,
            staged: false,
            modified: false,
            ignored: false,
            conflict: false,
        };
        Ok(&UNTRACKED)
    }
}

fn git_output(dir: &std::path::Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "Git filename filter: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(out.stdout)
}

#[cfg(unix)]
fn bytes_os(bytes: &[u8]) -> Result<OsString, String> {
    use std::os::unix::ffi::OsStringExt;
    Ok(OsString::from_vec(bytes.to_vec()))
}
#[cfg(not(unix))]
fn bytes_os(bytes: &[u8]) -> Result<OsString, String> {
    String::from_utf8(bytes.to_vec())
        .map(OsString::from)
        .map_err(|_| "Git pathname is not UTF-8".into())
}
