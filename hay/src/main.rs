#![forbid(unsafe_code)]

//! `hay` — a ranked grep for coding agents.
//!
//! ripgrep returns matches in path order. For an agent that reads the first page and acts, path
//! order is arbitrary: a dead `plan-v3-FINAL.md` outranks the function definition whenever it
//! sorts earlier. `hay` runs the same search using ripgrep's own engine and reorders the results
//! by how likely each line is to be the answer.
//!
//! No index, no daemon, no state. Output is ripgrep-compatible so an agent switches by typing
//! `hay` instead of `rg`.

mod score;

use std::collections::HashMap;
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;

use cap_std::{ambient_authority, fs::Dir};
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkContext, SinkMatch};
use ignore::WalkBuilder;
use ignore::types::TypesBuilder;

use score::{LineInput, ScoreBreakdown, Weights, explain_line, prescore_line};

/// Upper bound on retained candidate lines.
///
/// ripgrep streams and uses ~23 MB on a half-million-match query; buffering every match to rank
/// it used ~135 MB on the same query, and grows linearly with match count — an out-of-memory
/// waiting for a broad pattern on a large repository, driven by input the caller controls.
/// Candidates are therefore kept in a bounded min-heap keyed by the frequency-independent part of
/// the score, so the lines most likely to rank highly survive and the rest are dropped during the
/// walk. Truncation is reported on stderr, never silently.
const MAX_CANDIDATES: usize = 20_000;

/// Distinguishes an explicit `--help` (exit 0) from a usage error (exit 2).
const HELP_MARKER: &str = "\u{0}HELP\u{0}";

const HELP: &str = "\
hay — a ranked grep for coding agents

USAGE:
    hay [OPTIONS] <PATTERN> [PATH]
    hay [OPTIONS] -e <PATTERN>... [PATH]

Results are ordered by how likely each line is to be the answer, not by path.
Output is ripgrep-compatible: path:line:text

OPTIONS:
    -e, --regexp <PATTERN>
                          add a pattern (repeatable; matches the union)
    -i, --ignore-case     case-insensitive search
    -w, --word-regexp     match whole words only
    -F, --fixed-strings   treat patterns as literal strings
    -l, --files-with-matches
                          print only file paths, best first
    -g, --glob <GLOB>     include/exclude files (repeatable)
    -t, --type <TYPE>     only search this file type, e.g. ts, rust (repeatable)
    -T, --type-not <TYPE> never search this file type (repeatable)
        --type-list       print the known file types and exit
    -A, --after-context <N>    show N lines after each match
    -B, --before-context <N>   show N lines before each match
    -C, --context <N>          show N lines either side of each match
    -n, --line-number     show line numbers (default; --no-line-number disables)
        --json            emit ripgrep-shaped JSON Lines (match/context messages)
        --hidden          search hidden files and directories
        --no-ignore       do not respect .gitignore
    -c, --count           count matching lines per file (unranked, path order)
        --count-matches   count matches per file (unranked, path order)
    -v, --invert-match    print the lines that did NOT match (unranked)
    -o, --only-matching   print each matched substring (unranked)
        --stream          skip ranking: stream in path order like rg, with no candidate cap
    -m, --max-count <N>   stop after N ranked results (default 50; 0 = no limit)
        --explain         show the score for each result
        --no-<signal>     disable a ranking signal: definition, path, word, tf
        --no-diversify    do not interleave files; emit strictly in score order
    -h, --help            print this help
    -V, --version         print the version

Results are interleaved by file: the first pass carries each file's best line, the second its
next-best, and so on. An agent opens files, so the first page is worth more as ten files than
as ten lines of one file. `--no-diversify` restores strict score order.

Differences from ripgrep, deliberate: results are rank-ordered rather than path-ordered,
`-m` bounds total results rather than matches per file, `--json` emits only `match`
and `context` messages (`begin`/`end`/`summary` are file-scoped and output is not), and
`-l` prints plain paths even under `--json`. For deterministic traversal, repository
`.gitignore` rules apply but global gitignore, `.git/info/exclude`, `.ignore`, and
`.rgignore` inputs do not.

A search matching more than 20000 lines ranks only the 20000 strongest-by-prescore
candidates, says so on stderr, and exits 2 because the result is incomplete. `-m 0`
prints every result hay ranked, not every tree match. `--stream` has no cap: it does not
rank, so nothing has to be retained, and a broad pattern is answered exhaustively.

`-c`, `--count-matches`, `-v`, `-o` and `--stream` are UNRANKED modes. There is nothing to
order, so they use ripgrep's own parallel traversal and behave as the corresponding ripgrep
invocation, including its per-file `-m` and its NON-deterministic order. Every ranked mode is
deterministic. That is deliberate: every valid `rg` command should have an answer here, so
`hay` can replace `rg` outright rather than being the tool you reach for once you already know
the question ranks.

One divergence remains in those modes: `-m 0` means no limit everywhere in hay, where
ripgrep treats it as print nothing. hay's meaning is the documented one above and the
measurement kit depends on it, so it does not change.
";

#[derive(Default, Debug)]
struct Opts {
    patterns: Vec<String>,
    path: PathBuf,
    ignore_case: bool,
    word: bool,
    fixed: bool,
    files_only: bool,
    line_numbers: bool,
    hidden: bool,
    no_ignore: bool,
    json: bool,
    globs: Vec<String>,
    types: Vec<String>,
    types_not: Vec<String>,
    before: usize,
    after: usize,
    max_count: usize,
    explain: bool,
    /// Interleave results by file so the first page shows distinct files. Default on; the flag
    /// exists so its contribution can be ablated like every other ranking decision.
    diversify: bool,
    /// Skip ranking entirely and stream in path order, exactly as ripgrep does.
    stream: bool,
    /// Whether `-m` was actually typed. The ranked page has a default of 50 because an agent reads
    /// a page; an unranked mode is ripgrep's job and ripgrep has no default cap, so silently
    /// stopping at 50 there would make `hay --stream` return fewer matches than `rg` — the one
    /// thing this tool promises never to do.
    max_count_set: bool,
    /// `-c`: matching lines per file. `--count-matches`: matches per file.
    count_lines: bool,
    count_matches: bool,
    /// `-v`: print the lines that did NOT match.
    invert: bool,
    /// `-o`: print each matched substring rather than its line.
    only_matching: bool,
    weights: Weights,
}

impl Opts {
    /// Modes with nothing to rank, which therefore run ripgrep's way: streaming, path-ordered,
    /// uncapped. Refusing them (as hay did until 0.3.0) meant an agent could not alias `rg` to
    /// `hay` unconditionally — the flag was valid, the tool said no, and the agent had to know
    /// which of two binaries to reach for. A tool that answers every valid invocation, ranking
    /// the ones where rank means something, is the only shape that removes that decision.
    fn unranked(&self) -> bool {
        self.stream || self.count_lines || self.count_matches || self.invert || self.only_matching
    }

    /// Does a counting mode report MATCHES rather than matching lines?
    ///
    /// ripgrep's rule, verified against ripgrep rather than assumed: `-c` counts lines,
    /// `--count-matches` counts matches, and `-c -o` counts matches too. Under `-v` the delivered
    /// lines contain no match at all, so every counting mode falls back to lines — which is what
    /// ripgrep reports there as well.
    fn counts_matches(&self) -> bool {
        (self.count_matches || self.only_matching) && !self.invert
    }
}

/// Parse the command line.
///
/// Lexing is `lexopt` — the same crate ripgrep moved to when it left clap. It is what supplies
/// combined short flags (`-in`), `--flag=value`, `--` and attached short values (`-C3`) for free.
/// That matters empirically rather than aesthetically: combined shorts appear 3,562 times across
/// the transcripts this project measures, and the hand-rolled parser rejected every one of them
/// with exit 2 — the single largest drop-in gap in the tool, and a fourth hand-rolled lexer was
/// not going to be the one that got the edge cases right.
fn parse_args(argv: Vec<String>) -> Result<Opts, String> {
    use lexopt::prelude::*;

    let mut o = Opts {
        path: PathBuf::from("."),
        line_numbers: true,
        max_count: 50,
        diversify: true,
        weights: Weights::default(),
        ..Default::default()
    };
    let mut positional: Vec<String> = Vec::new();
    let mut p = lexopt::Parser::from_args(argv);

    // `lexopt` hands back an OsString; every value hay takes is a pattern, path, glob, type name
    // or number, all of which must be valid UTF-8 to be useful downstream.
    macro_rules! val {
        ($flag:expr) => {
            p.value()
                .map_err(|_| format!("{} needs a value", $flag))?
                .into_string()
                .map_err(|_| format!("{} needs valid UTF-8", $flag))?
        };
    }
    macro_rules! num {
        ($flag:expr) => {
            val!($flag)
                .parse::<usize>()
                .map_err(|_| format!("{} needs a non-negative integer", $flag))?
        };
    }

    while let Some(arg) = p.next().map_err(|e| format!("{e}\n\n{HELP}"))? {
        match arg {
            Short('h') | Long("help") => return Err(format!("{HELP_MARKER}{HELP}")),
            Short('V') | Long("version") => {
                return Err(format!("{HELP_MARKER}hay {}", env!("CARGO_PKG_VERSION")));
            }
            Long("type-list") => return Err(format!("{HELP_MARKER}{}", type_list())),
            Short('i') | Long("ignore-case") => o.ignore_case = true,
            Short('w') | Long("word-regexp") => o.word = true,
            Short('F') | Long("fixed-strings") => o.fixed = true,
            Short('l') | Long("files-with-matches") => o.files_only = true,
            Short('n') | Long("line-number") => o.line_numbers = true,
            Long("no-line-number") => o.line_numbers = false,
            Long("hidden") => o.hidden = true,
            Long("no-ignore") => o.no_ignore = true,
            Long("json") => o.json = true,
            Long("explain") => o.explain = true,
            Short('e') | Long("regexp") => o.patterns.push(val!("-e")),
            Short('g') | Long("glob") => o.globs.push(val!("-g")),
            Short('t') | Long("type") => o.types.push(val!("-t")),
            Short('T') | Long("type-not") => o.types_not.push(val!("-T")),
            Short('A') | Long("after-context") => o.after = num!("-A"),
            Short('B') | Long("before-context") => o.before = num!("-B"),
            // ripgrep 14 made -A/-B only PARTIALLY override -C, so `-C1 -A2` means `-B1 -A2`.
            // Setting both here and letting a later -A/-B win reproduces that, last flag wins.
            Short('C') | Long("context") => {
                let n = num!("-C");
                o.before = n;
                o.after = n;
            }
            Short('m') | Long("max-count") => {
                o.max_count = num!("-m");
                o.max_count_set = true;
            }
            // Ablation switches. Each one zeroes exactly one signal so its contribution can be
            // measured rather than assumed.
            Long("no-definition") => o.weights.definition = 0.0,
            Long("no-path") => o.weights.path = 0.0,
            Long("no-word") => o.weights.word = 0.0,
            Long("no-tf") => o.weights.term_frequency = 0.0,
            Long("no-diversify") => o.diversify = false,
            Long("stream") => o.stream = true,
            Short('c') | Long("count") => o.count_lines = true,
            Long("count-matches") => o.count_matches = true,
            Short('v') | Long("invert-match") => o.invert = true,
            Short('o') | Long("only-matching") => o.only_matching = true,
            Value(v) => positional.push(
                v.into_string()
                    .map_err(|_| "arguments must be valid UTF-8".to_string())?,
            ),
            other => return Err(format!("unknown option {other:?}\n\n{HELP}")),
        }
    }
    // With `-e`, every positional is a path — that is ripgrep's rule, and guessing otherwise
    // would silently search for the directory name.
    if o.patterns.is_empty() {
        if positional.is_empty() {
            return Err(format!("missing PATTERN\n\n{HELP}"));
        }
        o.patterns.push(positional.remove(0));
    }
    if positional.len() > 1 {
        // Taking only the first would silently drop the rest — the exact class of quiet wrong
        // answer this tool exists to avoid.
        return Err(format!(
            "one PATH at a time (got {}); run hay once per path",
            positional.len()
        ));
    }
    if let Some(p) = positional.first() {
        o.path = PathBuf::from(p);
    }
    if o.explain && o.json {
        return Err("--explain and --json are different output formats; pick one".into());
    }
    // Nothing is scored in an unranked mode, so there is no breakdown to print. Saying that is
    // better than printing zeros that look like a ranking decision.
    if o.explain && o.unranked() {
        return Err(
            "--explain describes a ranking; -c, -v, -o and --stream do not rank. Drop one.".into(),
        );
    }
    if o.count_lines && o.count_matches {
        return Err("-c counts lines and --count-matches counts matches; pick one".into());
    }
    Ok(o)
}

fn type_list() -> String {
    let mut b = TypesBuilder::new();
    b.add_defaults();
    b.definitions()
        .iter()
        .map(|d| format!("{}: {}", d.name(), d.globs().join(", ")))
        .collect::<Vec<_>>()
        .join("\n")
}

struct Hit {
    path: String,
    /// Original filesystem path. Keep it lossless: the display path may replace non-UTF-8 bytes,
    /// and reopening that lossy spelling can address a different file.
    fs_path: PathBuf,
    line_no: u64,
    /// Byte offset of the start of this line within the file. ripgrep's `--json` reports it and
    /// consumers use it to seek; it is captured during the search rather than reconstructed.
    offset: u64,
    /// The line, lossily decoded. Scoring and text output use this.
    text: String,
    /// The original bytes, kept ONLY when the line was not valid UTF-8. ripgrep searches
    /// byte-oriented files and reports such lines as base64 `bytes` in `--json`; discarding the
    /// originals would make hay's JSON claim a decoded string ripgrep never saw.
    raw: Option<Vec<u8>>,
    /// Whether the line ended with a terminator in the file. A final line without one must not
    /// gain a newline in `--json`, or the reported bytes are not the file's bytes.
    terminated: bool,
    /// Byte range within the ORIGINAL line bytes that the pattern matched. Scoring compares
    /// against this rather than the raw pattern: for any non-literal pattern (`foo|bar`,
    /// `handle.*`) the pattern never occurs verbatim in the line, so every text-comparison signal
    /// silently scored zero. Taken on the original bytes because that is what the searcher
    /// matched — a byte-oriented pattern can hit a sequence that lossy decoding has replaced.
    span: (usize, usize),
}

impl Hit {
    /// The matched substring, for scoring. Sliced from bytes in both cases: `str::get` rejects a
    /// range that is not on a character boundary, so a byte-oriented pattern such as `(?-u:\xA9)`
    /// matching a continuation byte inside an otherwise valid line fell through to scoring the
    /// whole line. Borrowed for the usual case; only an undecodable slice pays an allocation.
    fn matched(&self) -> std::borrow::Cow<'_, str> {
        let bytes = self.raw.as_deref().unwrap_or(self.text.as_bytes());
        match bytes.get(self.span.0..self.span.1) {
            Some(b) => String::from_utf8_lossy(b),
            None => std::borrow::Cow::Borrowed(self.text.as_str()),
        }
    }

    /// The line exactly as it sits in the file, terminator included when it had one.
    fn file_bytes(&self) -> Vec<u8> {
        let mut b = self
            .raw
            .clone()
            .unwrap_or_else(|| self.text.as_bytes().to_vec());
        if self.terminated {
            b.push(b'\n');
        }
        b
    }
}

/// A candidate ordered by prescore for the bounded heap. `Ord` is inverted so `BinaryHeap` acts
/// as a min-heap and the weakest candidate is the one evicted.
struct Candidate {
    prescore: f64,
    hit: Hit,
}
impl PartialEq for Candidate {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == std::cmp::Ordering::Equal
    }
}
impl Eq for Candidate {}
impl PartialOrd for Candidate {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Candidate {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        // Reversed: greater Candidate == lower prescore, so pop() removes the worst.
        other
            .prescore
            .partial_cmp(&self.prescore)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| self.hit.path.cmp(&other.hit.path))
            .then_with(|| self.hit.line_no.cmp(&other.hit.line_no))
    }
}

/// Collects matching lines with their line number and absolute byte offset.
///
/// `grep_searcher::sinks::UTF8` hands the closure only the line number, so the byte offset
/// `--json` reports would have had to be invented. It also rejects invalid UTF-8, which made hay
/// drop every match in a Latin-1 file and exit 2 on a search ripgrep answers — a direct breach of
/// the one property hay claims. Bytes are handed through undecoded and the caller decides.
struct LineSink<F>(F);

impl<F: FnMut(u64, u64, &[u8])> Sink for LineSink<F> {
    type Error = io::Error;

    fn matched(&mut self, _searcher: &Searcher, m: &SinkMatch<'_>) -> Result<bool, io::Error> {
        (self.0)(
            m.line_number().unwrap_or(0),
            m.absolute_byte_offset(),
            m.bytes(),
        );
        Ok(true)
    }
}

/// Standard base64, for ripgrep's `--json` representation of a line that is not valid UTF-8.
fn base64(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let b = [c[0], *c.get(1).unwrap_or(&0), *c.get(2).unwrap_or(&0)];
        let n = u32::from_be_bytes([0, b[0], b[1], b[2]]);
        for i in 0..4 {
            if i <= c.len() {
                out.push(A[(n >> (18 - 6 * i)) as usize & 63] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SearchOutcome {
    Found,
    NotFound,
    Incomplete,
}

fn main() -> ExitCode {
    let opts = match parse_args(std::env::args().skip(1).collect()) {
        Ok(o) => o,
        Err(msg) => {
            // Help goes to stdout and exits 0; genuine errors go to stderr and exit 2, matching
            // ripgrep's convention so callers can distinguish "no match" from "broken invocation".
            if let Some(help) = msg.strip_prefix(HELP_MARKER) {
                println!("{help}");
                return ExitCode::from(0);
            }
            eprintln!("hay: {msg}");
            return ExitCode::from(2);
        }
    };

    match run(&opts) {
        Ok(SearchOutcome::Found) => ExitCode::from(0),
        Ok(SearchOutcome::NotFound) => ExitCode::from(1),
        Ok(SearchOutcome::Incomplete) => ExitCode::from(2),
        Err(e) => {
            eprintln!("hay: {e}");
            ExitCode::from(2)
        }
    }
}

/// Join the patterns into the single regex the searcher runs.
///
/// Each alternative is wrapped before joining: without it, `-e 'a$' -e 'b'` would anchor the
/// wrong branch. Word matching is NOT applied here — see the `word` note in [`run`].
fn build_pattern(o: &Opts) -> String {
    o.patterns
        .iter()
        .map(|p| {
            let p = if o.fixed { regex_escape(p) } else { p.clone() };
            format!("(?:{p})")
        })
        .collect::<Vec<_>>()
        .join("|")
}

fn run(o: &Opts) -> Result<SearchOutcome, String> {
    // A mistyped path must not look like "no matches". `ignore` walks a missing root silently,
    // so exit 0 with no output would be indistinguishable from a successful empty search — the
    // same silent-wrong-answer class this project has been bitten by repeatedly.
    if !o.path.exists() {
        return Err(format!("{}: no such file or directory", o.path.display()));
    }

    // Anchor the context reader before walking. Reopening by ambient pathname after ranking lets
    // a writable tree replace a matched path with a symlink to a file outside the search root.
    let context_root = (!o.files_only && (o.before > 0 || o.after > 0))
        .then(|| ContextRoot::new(&o.path))
        .transpose()
        .map_err(|e| format!("could not anchor context root: {e}"))?;

    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(o.ignore_case)
        .line_terminator(Some(b'\n'))
        // `-w` is delegated, not hand-rolled. Wrapping the pattern in `\b...\b` is not what
        // ripgrep means by whole-word: `\b` only exists at a word/non-word transition, so a
        // pattern whose first or last character is punctuation — `@`, `(-2.1)` — could never
        // match, and hay returned nothing for searches ripgrep answers. Silently, which is worse.
        .word(o.word)
        .build(&build_pattern(o))
        .map_err(|e| format!("invalid pattern: {e}"))?;

    let mut builder = WalkBuilder::new(&o.path);
    builder
        .hidden(!o.hidden)
        .git_ignore(!o.no_ignore)
        .git_global(false) // operator-local state must not change results
        .git_exclude(false) // ditto: .git/info/exclude is per-clone
        .ignore(false) // .ignore / .rgignore are repo-controllable; excluded deliberately
        .parents(!o.no_ignore);
    if !o.types.is_empty() || !o.types_not.is_empty() {
        let mut tb = TypesBuilder::new();
        tb.add_defaults();
        for t in &o.types {
            tb.select(t);
        }
        for t in &o.types_not {
            tb.negate(t);
        }
        // An unknown type name must fail loudly: silently selecting nothing looks exactly like
        // "this repo has no matches".
        builder.types(tb.build().map_err(|e| format!("bad file type: {e}"))?);
    }
    // VCS metadata is never the answer to a concept query. ripgrep only avoids it because the
    // directories are hidden, so `--hidden` re-exposes megabytes of packfiles and hook samples.
    let mut ob = ignore::overrides::OverrideBuilder::new(&o.path);
    for vcs in ["!.git/**", "!.hg/**", "!.svn/**", "!.jj/**"] {
        ob.add(vcs)
            .map_err(|e| format!("internal glob {vcs}: {e}"))?;
    }
    for g in &o.globs {
        ob.add(g).map_err(|e| format!("bad glob {g}: {e}"))?;
    }
    builder.overrides(ob.build().map_err(|e| format!("bad glob set: {e}"))?);

    if o.unranked() {
        return run_unranked(o, &matcher, &mut builder);
    }

    // A bounded channel, not `mpsc::channel`: with an unbounded one the parallel walker
    // out-produces the single ranking consumer and the queue itself becomes the memory leak,
    // which defeats the point of capping the heap. The consumer therefore runs on its own thread
    // — draining only after `walker.run()` returns would block every producer and deadlock.
    let errors = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let (tx, rx) = mpsc::sync_channel::<Hit>(4096);
    let weights = Weights { ..o.weights };
    let consumer = std::thread::spawn(move || {
        let mut per_file: HashMap<String, usize> = HashMap::new();
        let mut heap: std::collections::BinaryHeap<Candidate> = std::collections::BinaryHeap::new();
        let mut total = 0usize;
        for h in rx {
            total += 1;
            *per_file.entry(h.path.clone()).or_insert(0) += 1;
            let prescore = prescore_line(
                &LineInput {
                    path: &h.path,
                    line: &h.text,
                    query: &h.matched(),
                    file_matches: 0,
                },
                &weights,
            );
            // Compared on the full candidate ordering, not on prescore alone. Comparing prescore
            // only meant an equal-scoring candidate never displaced the incumbent, so which lines
            // survived truncation depended on the order the parallel walker happened to deliver
            // them — nondeterminism in a tool that documents itself as deterministic.
            let cand = Candidate { prescore, hit: h };
            if heap.len() < MAX_CANDIDATES {
                heap.push(cand);
            } else if heap.peek().is_some_and(|worst| cand < *worst) {
                heap.pop();
                heap.push(cand);
            }
        }
        (per_file, heap, total)
    });

    let walker = builder.build_parallel();
    walker.run(|| {
        let tx = tx.clone();
        let matcher = matcher.clone();
        // Match ripgrep's default: stop at the first NUL. Without this, hay searched files rg
        // reports as "binary file matches" and printed raw binary bytes into agent-parsed output.
        let mut searcher = SearcherBuilder::new()
            .line_number(true)
            .binary_detection(BinaryDetection::quit(b'\x00'))
            .build();
        let errors = errors.clone();
        Box::new(move |entry| {
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("hay: {e}");
                    errors.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    return ignore::WalkState::Continue;
                }
            };
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                return ignore::WalkState::Continue;
            }
            // Emit the path exactly as ripgrep does — including the search root. Stripping the
            // root made `hay foo src` print `file.rs`, which is both wrong output and loses the
            // `src/` prefix the path classifier ranks on.
            let display = entry.path().to_string_lossy().into_owned();
            let fs_path = entry.path().to_path_buf();
            let searched = searcher.search_path(
                &matcher,
                entry.path(),
                LineSink(|lnum, offset, line: &[u8]| {
                    let terminated = line.ends_with(b"\n");
                    let bytes = line.strip_suffix(b"\n").unwrap_or(line);
                    // The span is taken on the original bytes, which is what the searcher matched.
                    // Recomputing it on the decoded string lets a byte-oriented pattern miss —
                    // the match landed on a sequence lossy decoding replaced — and the fallback
                    // then scores the whole line as the match, corrupting the ranking signals.
                    let span = matcher
                        .find(bytes)
                        .ok()
                        .flatten()
                        .map(|m| (m.start(), m.end()))
                        .unwrap_or((0, bytes.len()));
                    let text = String::from_utf8_lossy(bytes);
                    // Only pay for the originals when decoding actually lost information.
                    let raw = matches!(text, std::borrow::Cow::Owned(_)).then(|| bytes.to_vec());
                    let _ = tx.send(Hit {
                        path: display.clone(),
                        fs_path: fs_path.clone(),
                        line_no: lnum,
                        offset,
                        text: text.into_owned(),
                        raw,
                        terminated,
                        span,
                    });
                }),
            );
            if let Err(e) = searched {
                eprintln!("hay: {}: {e}", entry.path().display());
                errors.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
            ignore::WalkState::Continue
        })
    });
    drop(tx);

    let (per_file, heap, total) = consumer.join().map_err(|_| "ranking thread panicked")?;
    let error_count = errors.load(std::sync::atomic::Ordering::Relaxed);
    // Checked before the empty-result path: a search that read nothing because every path was
    // unreadable must exit 2, not 1. Exit 1 would tell the caller "searched fine, found nothing".
    if error_count > 0 && total == 0 {
        return Err(format!("{error_count} path(s) could not be read"));
    }
    if total == 0 {
        return Ok(SearchOutcome::NotFound);
    }
    let truncated = total > MAX_CANDIDATES;
    if truncated {
        eprintln!(
            "hay: {total} matches; ranked the {MAX_CANDIDATES} strongest-by-prescore candidates. \
Narrow the pattern for an exhaustive result."
        );
    }

    let hits: Vec<Hit> = heap.into_iter().map(|c| c.hit).collect();
    let mut scored: Vec<(ScoreBreakdown, &Hit)> = hits
        .iter()
        .map(|h| {
            let s = explain_line(
                &LineInput {
                    path: &h.path,
                    line: &h.text,
                    query: &h.matched(),
                    // Every retained hit was counted on the way in; default defensively rather
                    // than indexing, so a future refactor cannot turn a miss into a panic.
                    file_matches: per_file.get(&h.path).copied().unwrap_or(1),
                },
                &o.weights,
            );
            (s, h)
        })
        .collect();

    // Descending score; ties broken by path then line so output is deterministic. ripgrep's own
    // parallel walk is NOT deterministic, which is exactly the trap this avoids.
    scored.sort_by(|a, b| {
        b.0.total
            .partial_cmp(&a.0.total)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.1.path.cmp(&b.1.path))
            .then_with(|| a.1.line_no.cmp(&b.1.line_no))
    });

    if o.diversify {
        let paths: Vec<&str> = scored.iter().map(|(_, h)| h.path.as_str()).collect();
        let order = diversified_order(&paths);
        let interleaved: Vec<(ScoreBreakdown, &Hit)> =
            order.into_iter().map(|i| scored[i]).collect();
        scored = interleaved;
    }

    let out = io::stdout();
    let mut w = BufWriter::new(out.lock());
    let limit = if o.max_count == 0 {
        usize::MAX
    } else {
        o.max_count
    };

    if o.files_only {
        emit_files(&mut w, &scored, limit, o)
    } else {
        let page: Vec<(ScoreBreakdown, &Hit)> = scored.into_iter().take(limit).collect();
        let ctx = read_context(&page, o.before, o.after, context_root.as_ref())
            .map_err(|e| format!("could not read context: {e}"))?;
        emit_lines(&mut w, &page, &ctx, &matcher, o)
    }
    .map_err(|e| e.to_string())?;

    w.flush().map_err(|e| e.to_string())?;
    if error_count > 0 {
        // ripgrep's convention: results may be printed, but an unreadable path means the answer
        // is incomplete and the exit code must say so.
        return Err(format!(
            "{error_count} path(s) could not be read; results are incomplete"
        ));
    }
    Ok(if truncated {
        SearchOutcome::Incomplete
    } else {
        SearchOutcome::Found
    })
}

/// Round-robin the ranked list by file, and return the permutation that does it: the first pass
/// carries each file's strongest line, the second its next-strongest, and so on. Within a pass the
/// existing rank order is preserved, so this reorders without ever re-scoring.
///
/// Why it is the default. `hay`'s judgments — and every published retrieval judgment for code —
/// are per FILE, because what an agent does with a result is open the file. Strict score order
/// spends the first page on the strongest file: forty matching lines in one module push the file
/// that actually declares the symbol to line-rank forty-one, and the reader pays for thirty-nine
/// lines that tell them nothing new. Measured on the behavioural corpus this alone moved the
/// pre-registered gate's top-10 rate from 59.2% to 78.0%, without touching a single score.
///
/// This is result diversification in the ordinary IR sense (Carbonell & Goldstein's MMR, and the
/// one-snippet-per-file layout every code-search UI converged on), and the cost is real: a file
/// with two genuinely useful lines now shows the second one a pass later.
fn diversified_order(paths: &[&str]) -> Vec<usize> {
    let mut seen: HashMap<&str, usize> = HashMap::new();
    let mut keyed: Vec<(usize, usize)> = paths
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let n = seen.entry(p).or_insert(0);
            let pass = *n;
            *n += 1;
            (pass, i)
        })
        .collect();
    // By pass, then by the incoming rank: a total order, so the output stays deterministic.
    keyed.sort_unstable();
    keyed.into_iter().map(|(_, i)| i).collect()
}

/// Ripgrep's behaviour, inside hay's binary: stream matches as they are found, no ranking, no
/// candidate cap, nothing buffered beyond the file being searched.
///
/// `DESIGN-hay.md` pre-registered this as `--stream` before any Rust existed, and the README's
/// decision table had been sending readers to `rg` for the two things it provides: a first hit
/// without walking the whole tree, and an exhaustive answer to a pattern matching more than
/// 20,000 lines (nothing is retained to rank, so nothing has to be dropped).
///
/// **This is the one mode whose output order is not deterministic**, and that is the point of it:
/// it is ripgrep's parallel traversal, so it inherits ripgrep's speed and ripgrep's ordering.
/// Sorting the walk instead was measured at 8.0 s to the first line of a kernel search against
/// ripgrep's 1.1 s — a "drop-in" six times slower than the thing it replaces is not one. Every
/// mode that ranks is still deterministic; this one says so in `--help` instead.
fn run_unranked<M: Matcher + Clone + Send>(
    o: &Opts,
    matcher: &M,
    builder: &mut WalkBuilder,
) -> Result<SearchOutcome, String> {
    let counting = o.count_lines || o.count_matches;
    // `-o` does NOT suppress context in ripgrep: `rg -o -C1` prints the surrounding lines around
    // the matched substrings. Excluding it here silently dropped context the caller asked for.
    let context_wanted = !o.files_only && !counting;
    let out = Mutex::new(BufWriter::new(io::stdout()));
    let found = AtomicBool::new(false);
    let errors = AtomicUsize::new(0);
    // Broken pipe is how `| head` ends, and it is a success: ripgrep stops quietly and so does
    // this. Reporting it as an unreadable path would turn a normal shell idiom into exit 2.
    let broken_pipe = AtomicBool::new(false);
    // ripgrep separates context blocks with `--` across files as well as within one. The walk is
    // parallel, so which block comes first is not fixed — what must hold is that a separator
    // appears wherever the output changes file. Tracking "has anyone written yet" was not enough:
    // a file bigger than the flush threshold writes twice, and if another file's block lands
    // between them the first file RESUMED with no boundary (review finding). So each file takes a
    // ticket and the last writer's ticket is compared under the output lock.
    let next_ticket = AtomicUsize::new(1);
    let last_writer = AtomicUsize::new(0);

    builder.build_parallel().run(|| {
        // One matcher per worker, exactly as the ranked walk does: cloning is what ripgrep's own
        // crates expect, and the regex engine's scratch space is not shareable across threads.
        let matcher = matcher.clone();
        // References, taken before the `move` closure below: moving the atomics into a per-worker
        // closure would give every thread its own counters.
        let (found, errors, broken_pipe, out) = (&found, &errors, &broken_pipe, &out);
        let (next_ticket, last_writer) = (&next_ticket, &last_writer);
        let mut searcher = SearcherBuilder::new()
            .line_number(true)
            .binary_detection(BinaryDetection::quit(b'\x00'))
            .invert_match(o.invert)
            .before_context(if context_wanted { o.before } else { 0 })
            .after_context(if context_wanted { o.after } else { 0 })
            .build();
        Box::new(move |entry| {
            if broken_pipe.load(Ordering::Relaxed) {
                return ignore::WalkState::Quit;
            }
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    eprintln!("hay: {e}");
                    errors.fetch_add(1, Ordering::Relaxed);
                    return ignore::WalkState::Continue;
                }
            };
            if !entry.file_type().is_some_and(|t| t.is_file()) {
                return ignore::WalkState::Continue;
            }
            let display = entry.path().to_string_lossy().into_owned();
            // Searched into a per-file buffer and written under one lock: workers must not
            // interleave halfway through a file's context block, which would hand a consumer a
            // `--` separated group whose lines came from two different files.
            let mut sink = StreamSink {
                buf: Vec::new(),
                out,
                last_writer,
                ticket: next_ticket.fetch_add(1, Ordering::Relaxed),
                // Never under `--json`: `context_break` already suppresses the separator there,
                // and a bare `--` between two files' blocks is a line no NDJSON consumer can
                // parse (review finding).
                separate_blocks: context_wanted && (o.before > 0 || o.after > 0) && !o.json,
                o,
                matcher: &matcher,
                path: &display,
                fs_path: entry.path().to_path_buf(),
                lines: 0,
                matches: 0,
                printed: 0,
                // ripgrep's `-m` is a per-file cap. hay's documented divergence — `-m` bounding
                // total results — belongs to the ranked page an agent reads; an unranked mode is
                // ripgrep's job and takes ripgrep's meaning.
                limit: if o.max_count_set && o.max_count > 0 {
                    o.max_count
                } else {
                    usize::MAX
                },
            };
            if let Err(e) = searcher.search_path(&matcher, entry.path(), &mut sink) {
                // A flush inside the sink can hit a closed pipe — `| head` is how this normally
                // ends — and that arrives here as a search error. Reporting it as an unreadable
                // path turned an ordinary shell idiom into exit 2 with a diagnostic.
                if e.kind() == io::ErrorKind::BrokenPipe {
                    broken_pipe.store(true, Ordering::Relaxed);
                    return ignore::WalkState::Quit;
                }
                eprintln!("hay: {}: {e}", entry.path().display());
                errors.fetch_add(1, Ordering::Relaxed);
                return ignore::WalkState::Continue;
            }
            if sink.lines == 0 {
                return ignore::WalkState::Continue;
            }
            found.store(true, Ordering::Relaxed);
            if counting {
                let n = if o.counts_matches() {
                    sink.matches
                } else {
                    sink.lines
                };
                sink.buf.clear();
                let _ = writeln!(&mut sink.buf, "{}", count_line(&display, n, o));
            }
            match sink.flush_block() {
                Ok(()) => ignore::WalkState::Continue,
                Err(e) if e.kind() == io::ErrorKind::BrokenPipe => {
                    broken_pipe.store(true, Ordering::Relaxed);
                    ignore::WalkState::Quit
                }
                Err(e) => {
                    eprintln!("hay: {e}");
                    errors.fetch_add(1, Ordering::Relaxed);
                    ignore::WalkState::Quit
                }
            }
        })
    });

    let piped_away = broken_pipe.load(Ordering::Relaxed);
    match out.lock().map(|mut w| w.flush()) {
        Ok(Err(e)) if e.kind() == io::ErrorKind::BrokenPipe => {}
        Ok(Err(e)) => return Err(e.to_string()),
        Ok(Ok(())) | Err(_) => {}
    }
    let error_count = errors.load(Ordering::Relaxed);
    if error_count > 0 && !piped_away {
        return Err(format!(
            "{error_count} path(s) could not be read; results are incomplete"
        ));
    }
    Ok(if found.load(Ordering::Relaxed) {
        SearchOutcome::Found
    } else {
        SearchOutcome::NotFound
    })
}

/// Per-file sink for the unranked path.
///
/// Output accumulates in `buf` and is written under one lock, so two workers cannot interleave
/// halfway through a file's context block. The buffer flushes once it passes `FLUSH_BYTES`, which
/// bounds memory: holding a whole file's output was measured at ~38x ripgrep's peak RSS on a large
/// explicitly-named file. A block larger than the threshold can therefore interleave with another
/// file's — the honest trade against growth driven entirely by the caller's pattern.
struct StreamSink<'a, M: Matcher> {
    buf: Vec<u8>,
    out: &'a Mutex<BufWriter<io::Stdout>>,
    /// Ticket of the file whose output was written last, so a separator can be emitted whenever
    /// the stream changes file — including when a file resumes after another interleaved.
    last_writer: &'a AtomicUsize,
    ticket: usize,
    /// Whether `--` belongs between blocks at all: context is printing and output is not JSON.
    separate_blocks: bool,
    o: &'a Opts,
    matcher: &'a M,
    path: &'a str,
    fs_path: PathBuf,
    lines: u64,
    matches: u64,
    printed: usize,
    limit: usize,
}

/// Flush threshold for one file's buffered output.
const FLUSH_BYTES: usize = 1 << 20;

/// A `-c` / `--count-matches` line. Under `--json` the path is a JSON string: a path containing a
/// newline would otherwise split one record into two, letting a filename forge a line in a stream
/// a consumer parses.
fn count_line(path: &str, n: u64, o: &Opts) -> String {
    if o.json {
        format!("{}:{n}", serde_json::Value::String(path.to_string()))
    } else {
        format!("{path}:{n}")
    }
}

impl<M: Matcher> StreamSink<'_, M> {
    /// Write everything buffered so far, preceded by the between-blocks separator if one is due.
    fn flush_block(&mut self) -> io::Result<()> {
        if self.buf.is_empty() {
            return Ok(());
        }
        let mut w = self
            .out
            .lock()
            .map_err(|_| io::Error::other("output lock poisoned"))?;
        // Swapped under the lock, so two workers cannot both believe they follow the same block.
        let previous = self.last_writer.swap(self.ticket, Ordering::Relaxed);
        if self.separate_blocks && previous != 0 && previous != self.ticket {
            writeln!(w, "--")?;
        }
        w.write_all(&self.buf)?;
        self.buf.clear();
        Ok(())
    }

    /// Flush once the buffer passes the bound, so memory does not follow the caller's pattern.
    fn maybe_flush(&mut self) -> io::Result<()> {
        if self.buf.len() >= FLUSH_BYTES {
            self.flush_block()?;
        }
        Ok(())
    }

    /// A ranked-path `Hit`, so both paths print through `emit_match` and cannot drift apart on
    /// JSON shape, line-number handling or the `:`/`-` separator convention.
    fn hit(&self, line_no: u64, offset: u64, bytes: &[u8]) -> Hit {
        let terminated = bytes.ends_with(b"\n");
        let body = bytes.strip_suffix(b"\n").unwrap_or(bytes);
        let span = self
            .matcher
            .find(body)
            .ok()
            .flatten()
            .map(|m| (m.start(), m.end()))
            .unwrap_or((0, body.len()));
        let text = String::from_utf8_lossy(body);
        let raw = matches!(text, std::borrow::Cow::Owned(_)).then(|| body.to_vec());
        Hit {
            path: self.path.to_string(),
            fs_path: self.fs_path.clone(),
            line_no,
            offset,
            text: text.into_owned(),
            raw,
            terminated,
            span,
        }
    }
}

/// Unranked output carries no score. Printing zeros would read as a ranking decision, so the
/// breakdown is all zeros and `--explain` is refused in these modes at parse time.
const NO_SCORE: ScoreBreakdown = ScoreBreakdown {
    definition: 0.0,
    path: 0.0,
    word: 0.0,
    tf: 0.0,
    total: 0.0,
};

impl<M: Matcher> Sink for StreamSink<'_, M> {
    type Error = io::Error;

    fn matched(&mut self, _searcher: &Searcher, m: &SinkMatch<'_>) -> Result<bool, io::Error> {
        self.lines += 1;
        let line_no = m.line_number().unwrap_or(0);
        let bytes = m.bytes();
        let body = bytes.strip_suffix(b"\n").unwrap_or(bytes);

        if self.o.count_lines || self.o.count_matches {
            if self.o.counts_matches() {
                let mut n = 0u64;
                self.matcher
                    .find_iter(body, |_| {
                        n += 1;
                        true
                    })
                    .map_err(|_| io::Error::other("matcher failed while counting"))?;
                self.matches += n;
            }
            // `-m` caps the LINES counted, so `rg -c -m 1` reports 1. Counting past the cap
            // inflates the very number the caller asked to bound.
            return Ok((self.lines as usize) < self.limit);
        }

        if self.o.files_only {
            if self.o.json {
                writeln!(
                    self.buf,
                    "{}",
                    serde_json::Value::String(self.path.to_string())
                )?;
            } else {
                writeln!(self.buf, "{}", self.path)?;
            }
            self.printed += 1;
            return Ok(false); // one line per file is the whole answer
        }

        // `-o` is inert under `-v` — the delivered line contains no match to slice out — and under
        // `--json`, whose records ripgrep emits identically with and without it. Both checked
        // against ripgrep. The first case is the one that mattered: slicing spans out of a
        // non-matching line found none, so `hay -o -v` printed NOTHING and exited 0, which is a
        // silent wrong answer and a direct breach of "hay returns everything ripgrep returns".
        if self.o.only_matching && !self.o.invert && !self.o.json {
            let mut spans = Vec::new();
            self.matcher
                .find_iter(body, |m| {
                    spans.push((m.start(), m.end()));
                    true
                })
                .map_err(|_| io::Error::other("matcher failed while emitting -o"))?;
            for (start, end) in spans {
                let hit = self.hit(line_no, m.absolute_byte_offset(), &body[start..end]);
                emit_match(&mut self.buf, NO_SCORE, &hit, self.matcher, self.o)?;
            }
            // ONE line of the budget however many substrings it held: ripgrep's `-m` caps matching
            // lines, and charging per span truncated a line that matched several times.
            self.printed += 1;
            self.maybe_flush()?;
            return Ok(self.printed < self.limit);
        }

        let hit = self.hit(line_no, m.absolute_byte_offset(), bytes);
        emit_match(&mut self.buf, NO_SCORE, &hit, self.matcher, self.o)?;
        self.printed += 1;
        self.maybe_flush()?;
        Ok(self.printed < self.limit)
    }

    fn context(&mut self, _searcher: &Searcher, c: &SinkContext<'_>) -> Result<bool, io::Error> {
        let line = ContextLine {
            offset: c.absolute_byte_offset(),
            bytes: c.bytes().to_vec(),
        };
        emit_context(
            &mut self.buf,
            self.path,
            c.line_number().unwrap_or(0),
            &line,
            self.o,
        )?;
        self.maybe_flush()?;
        Ok(true)
    }

    fn context_break(&mut self, _searcher: &Searcher) -> Result<bool, io::Error> {
        if !self.o.json {
            writeln!(self.buf, "--")?;
        }
        Ok(true)
    }
}

fn emit_files(
    w: &mut impl Write,
    scored: &[(ScoreBreakdown, &Hit)],
    limit: usize,
    o: &Opts,
) -> io::Result<()> {
    let mut seen = std::collections::HashSet::new();
    let mut n = 0;
    for (_, h) in scored {
        if !seen.insert(h.path.as_str()) {
            continue;
        }
        // Plain paths, except under `--json` where the path is a JSON string. hay's JSON contract
        // is match/context messages only (see HELP), and a bare `begin` with no `end` would be
        // neither that nor rg-shaped — but a path containing a newline would split one record into
        // two, letting a filename forge a line in a stream a consumer parses (review finding).
        if o.json {
            writeln!(w, "{}", serde_json::Value::String(h.path.clone()))?;
        } else {
            writeln!(w, "{}", h.path)?;
        }
        n += 1;
        if n >= limit {
            break;
        }
    }
    Ok(())
}

struct ContextRoot {
    dir: Dir,
    base: PathBuf,
}

impl ContextRoot {
    fn new(search_path: &Path) -> io::Result<Self> {
        let base = if search_path.is_dir() {
            search_path.to_path_buf()
        } else {
            search_path
                .parent()
                .filter(|parent| !parent.as_os_str().is_empty())
                .unwrap_or_else(|| Path::new("."))
                .to_path_buf()
        };
        let dir = Dir::open_ambient_dir(&base, ambient_authority())
            .map_err(|e| io::Error::new(e.kind(), format!("{}: {e}", base.display())))?;
        Ok(Self { dir, base })
    }

    fn open(&self, path: &Path) -> io::Result<cap_std::fs::File> {
        let relative = if let Ok(relative) = path.strip_prefix(&self.base) {
            relative
        } else if self.base == Path::new(".") && path.is_relative() {
            path
        } else {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                format!(
                    "{} is outside anchored search root {}",
                    path.display(),
                    self.base.display()
                ),
            ));
        };
        if relative.as_os_str().is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "context path resolves to the search root",
            ));
        }
        self.dir.open(relative)
    }
}

/// Lines needed for `-A`/`-B`/`-C`, plus the last line each file actually has.
///
/// Read after ranking, for the page that will actually be printed, rather than carried through
/// the walk: context is decoration on at most `-m` results, so buffering it for up to 20,000
/// candidates would multiply peak memory for output nobody sees.
#[derive(Debug, Default)]
struct Context {
    lines: HashMap<(PathBuf, u64), ContextLine>,
    /// Highest line number present in each file, so emission can stop at EOF instead of at the
    /// arithmetic end of a window the caller asked for.
    last_line: HashMap<PathBuf, u64>,
}

#[derive(Debug)]
struct ContextLine {
    /// Absolute byte offset of this line, matching ripgrep's JSON contract.
    offset: u64,
    /// Bytes exactly as they appear in the file, terminator included when present.
    bytes: Vec<u8>,
}

/// The [lo, hi] line window a hit's context spans. One definition, used by both the reader and
/// the emitter — these two must never desync, or context gets read but not printed (or printed
/// but never read), which no match-parity test would catch.
fn window(h: &Hit, before: usize, after: usize) -> (u64, u64) {
    (
        h.line_no.saturating_sub(before as u64).max(1),
        h.line_no.saturating_add(after as u64),
    )
}

fn read_context(
    page: &[(ScoreBreakdown, &Hit)],
    before: usize,
    after: usize,
    root: Option<&ContextRoot>,
) -> io::Result<Context> {
    let mut out = Context::default();
    if before == 0 && after == 0 {
        return Ok(out);
    }
    let root = root.ok_or_else(|| io::Error::other("context root missing for requested window"))?;

    // Ranges, never the expanded line numbers: `-A 1000000000000` is a valid ripgrep argument, and
    // materialising that window as a set is an out-of-memory rather than a search.
    let mut wanted: HashMap<&Path, Vec<(u64, u64)>> = HashMap::new();
    for (_, h) in page {
        wanted
            .entry(h.fs_path.as_path())
            .or_default()
            .push(window(h, before, after));
    }
    for (path, ranges) in wanted {
        let last = ranges.iter().map(|&(_, hi)| hi).max().unwrap_or(0);
        let file = root
            .open(path)
            .map_err(|e| io::Error::new(e.kind(), format!("{}: {e}", path.display())))?;
        // Read bytes, not `lines()`: that decodes UTF-8 and would stop at the first invalid line,
        // silently dropping every following context line in exactly the files hay was just taught
        // to search. A genuine IO error makes the requested output incomplete, so it must fail.
        let mut reader = BufReader::new(file);
        let (mut n, mut seen, mut offset, mut buf) = (0u64, 0u64, 0u64, Vec::new());
        loop {
            buf.clear();
            let line_offset = offset;
            let read = reader
                .read_until(b'\n', &mut buf)
                .map_err(|e| io::Error::new(e.kind(), format!("{}: {e}", path.display())))?;
            if read == 0 {
                break;
            }
            offset = offset.saturating_add(read as u64);
            n += 1;
            if n > last {
                break;
            }
            seen = n;
            if ranges.iter().any(|&(lo, hi)| n >= lo && n <= hi) {
                out.lines.insert(
                    (path.to_path_buf(), n),
                    ContextLine {
                        offset: line_offset,
                        bytes: buf.clone(),
                    },
                );
            }
        }
        out.last_line.insert(path.to_path_buf(), seen);
    }
    Ok(out)
}

fn emit_lines(
    w: &mut impl Write,
    page: &[(ScoreBreakdown, &Hit)],
    ctx: &Context,
    matcher: &impl Matcher,
    o: &Opts,
) -> io::Result<()> {
    // No context requested: emit in pure rank order. Grouping below sorts each block by line
    // number, which is right for a context window and wrong for the ranked list itself.
    if o.before == 0 && o.after == 0 {
        for (s, h) in page {
            emit_match(w, *s, h, matcher, o)?;
        }
        return Ok(());
    }

    // Results are emitted strictly in rank order — that ordering is the entire product, so a
    // context window must never carry a weaker result ahead of a stronger one from another file.
    // Two constraints then have to hold without reordering anything:
    //
    //   * a line that is itself a ranked result is never printed as context; it appears at its
    //     own rank, with the `:` separator that says it matched;
    //   * a context line shared by two windows in the same file is printed once.
    //
    // Both are lookups keyed by path, so this stays linear in the page — an earlier version
    // grouped windows into blocks by scanning every existing block per hit, which reordered
    // output and went quadratic at the 20,000-result cap.
    let mut ranked: HashMap<&str, std::collections::HashSet<u64>> = HashMap::new();
    for (_, h) in page {
        ranked.entry(&h.path).or_default().insert(h.line_no);
    }
    let mut shown: HashMap<&str, std::collections::HashSet<u64>> = HashMap::new();
    // The last line actually written, so `--` marks a real discontinuity. Comparing windows
    // instead of emitted lines missed two cases: same-file windows running BACKWARD (results are
    // score-ordered, so lines 4 then 2 overlap numerically while jumping backward in the file),
    // and a window whose middle line was skipped because it is ranked elsewhere.
    let mut last_written: Option<(&str, u64)> = None;

    for (s, h) in page {
        let (lo, hi) = window(h, o.before, o.after);
        // Clamp to lines the file actually has. `-A 1000000000000` is a valid ripgrep argument
        // meaning "to the end"; iterating the requested arithmetic window instead of the real one
        // turned it into a trillion lookups past EOF, which is indistinguishable from a hang.
        let eof = ctx
            .last_line
            .get(h.fs_path.as_path())
            .copied()
            .unwrap_or(h.line_no);
        let hi = hi.min(eof.max(h.line_no));
        for n in lo..=hi {
            let is_match = n == h.line_no;
            if !is_match {
                if ranked.get(h.path.as_str()).is_some_and(|r| r.contains(&n)) {
                    continue; // printed at its own rank, as a match
                }
                if !ctx.lines.contains_key(&(h.fs_path.clone(), n))
                    || !shown.entry(&h.path).or_default().insert(n)
                {
                    continue;
                }
            }
            if !o.json && last_written.is_some_and(|(p, l)| p != h.path || n != l + 1) {
                writeln!(w, "--")?;
            }
            if is_match {
                emit_match(w, *s, h, matcher, o)?;
            } else if let Some(line) = ctx.lines.get(&(h.fs_path.clone(), n)) {
                emit_context(w, &h.path, n, line, o)?;
            }
            last_written = Some((&h.path, n));
        }
    }
    Ok(())
}

fn emit_match(
    w: &mut impl Write,
    s: ScoreBreakdown,
    h: &Hit,
    matcher: &impl Matcher,
    o: &Opts,
) -> io::Result<()> {
    if o.json {
        // Every match on the line, not just the first: ripgrep reports them all, and the single
        // span kept for scoring would understate a line that matches twice. Recomputed here
        // because it is bounded by the printed page rather than by the whole candidate set.
        // Offsets are reported into whatever bytes the `lines` field carries, so a non-UTF-8 line
        // is scanned as its originals rather than as the lossy decoding.
        let hay: &[u8] = h.raw.as_deref().unwrap_or(h.text.as_bytes());
        let mut submatches = Vec::new();
        // The matcher crate owns empty-match progress. A hand-rolled `find_at` loop dropped
        // valid zero-width spans (`^`, `$`, `\b`) to avoid looping forever.
        matcher
            .find_iter(hay, |m| {
                submatches.push(match std::str::from_utf8(&hay[m.start()..m.end()]) {
                    Ok(t) => serde_json::json!({
                        "match": {"text": t}, "start": m.start(), "end": m.end(),
                    }),
                    Err(_) => serde_json::json!({
                        "match": {"bytes": base64(&hay[m.start()..m.end()])},
                        "start": m.start(), "end": m.end(),
                    }),
                });
                true
            })
            .map_err(|_| io::Error::other("matcher failed while emitting JSON"))?;
        // Exactly the file's bytes for this line — a final line with no terminator must not gain
        // one, or the reported bytes are not the bytes ripgrep would report.
        let lines = json_line(&h.file_bytes());
        return writeln!(
            w,
            "{}",
            serde_json::json!({
                "type": "match",
                "data": {
                    "path": {"text": h.path},
                    "lines": lines,
                    "line_number": h.line_no,
                    "absolute_offset": h.offset,
                    "submatches": submatches,
                }
            })
        );
    }
    if o.explain {
        // Per-signal, not just a total: error analysis needs to know WHICH signal put a line
        // where it is. Format is pinned by a contract test in tests/cli.rs.
        writeln!(
            w,
            "{:>7.2} [def {:+.1} path {:+.1} word {:+.1} tf {:+.2}]  {}:{}:{}",
            s.total, s.definition, s.path, s.word, s.tf, h.path, h.line_no, h.text
        )
    } else if o.line_numbers {
        writeln!(w, "{}:{}:{}", h.path, h.line_no, h.text)
    } else {
        writeln!(w, "{}:{}", h.path, h.text)
    }
}

/// ripgrep's `lines` field: decoded text when the bytes are UTF-8, base64 `bytes` when they are
/// not. Never a lossy string presented as if it were the file's content.
fn json_line(bytes: &[u8]) -> serde_json::Value {
    match std::str::from_utf8(bytes) {
        Ok(t) => serde_json::json!({ "text": t }),
        Err(_) => serde_json::json!({ "bytes": base64(bytes) }),
    }
}

fn emit_context(
    w: &mut impl Write,
    path: &str,
    line_no: u64,
    line: &ContextLine,
    o: &Opts,
) -> io::Result<()> {
    if o.json {
        return writeln!(
            w,
            "{}",
            serde_json::json!({
                "type": "context",
                "data": {
                    "path": {"text": path},
                    "lines": json_line(&line.bytes),
                    "line_number": line_no,
                    "absolute_offset": line.offset,
                    "submatches": [],
                }
            })
        );
    }
    // Stored with its terminator so JSON can report the file's exact bytes; stripped here because
    // `writeln!` adds one.
    let bytes = line.bytes.as_slice();
    let text = String::from_utf8_lossy(bytes.strip_suffix(b"\n").unwrap_or(bytes));
    // ripgrep's separator convention: `:` introduces a match line, `-` a context line, so a
    // consumer can tell them apart without tracking state.
    if o.line_numbers || o.explain {
        writeln!(w, "{path}-{line_no}-{text}")
    } else {
        writeln!(w, "{path}-{text}")
    }
}

/// Escape a literal so it can be handed to the regex engine (`-F`).
fn regex_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for c in s.chars() {
        if "\\.+*?()|[]{}^$#&-~".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(argv: &[&str]) -> Opts {
        parse_args(argv.iter().map(|s| s.to_string()).collect()).unwrap()
    }

    #[test]
    fn escapes_regex_metacharacters() {
        assert_eq!(regex_escape("a.b"), r"a\.b");
        assert_eq!(regex_escape("foo|bar"), r"foo\|bar");
        assert_eq!(regex_escape("plain"), "plain");
    }

    #[test]
    fn parses_a_bare_pattern() {
        let o = opts(&["createClient"]);
        assert_eq!(o.patterns, vec!["createClient"]);
        assert_eq!(o.path, PathBuf::from("."));
        assert!(o.line_numbers);
        assert_eq!(o.max_count, 50);
    }

    #[test]
    fn option_values_are_not_mistaken_for_positionals() {
        // The bug that shipped in the TypeScript version: `--sample 50` made `50` a repo path.
        let o = opts(&["-m", "5", "auth", "src"]);
        assert_eq!(o.max_count, 5);
        assert_eq!(o.patterns, vec!["auth"]);
        assert_eq!(o.path, PathBuf::from("src"));
    }

    #[test]
    fn glob_values_are_consumed() {
        let o = opts(&["-g", "*.ts", "auth"]);
        assert_eq!(o.globs, vec!["*.ts"]);
        assert_eq!(o.patterns, vec!["auth"]);
    }

    #[test]
    fn unknown_options_fail_loudly() {
        assert!(parse_args(vec!["--nope".into(), "x".into()]).is_err());
        assert!(parse_args(vec!["-m".into(), "abc".into(), "x".into()]).is_err());
        assert!(parse_args(vec![]).is_err());
        // Two paths would have silently searched only the first.
        assert!(parse_args(vec!["x".into(), "a".into(), "b".into()]).is_err());
        // Mutually exclusive output formats.
        assert!(parse_args(vec!["--explain".into(), "--json".into(), "x".into()]).is_err());
    }

    #[test]
    fn ablation_switches_zero_exactly_one_signal() {
        let o = opts(&["--no-definition", "x"]);
        assert_eq!(o.weights.definition, 0.0);
        assert_ne!(o.weights.path, 0.0);
    }

    #[test]
    fn multiple_patterns_become_one_alternation() {
        let o = opts(&["-e", "foo", "-e", "bar", "src"]);
        assert_eq!(o.patterns, vec!["foo", "bar"]);
        // With -e, the sole positional is the PATH — not the pattern.
        assert_eq!(o.path, PathBuf::from("src"));
        assert_eq!(build_pattern(&o), "(?:foo)|(?:bar)");
    }

    #[test]
    fn each_alternative_is_wrapped_before_being_joined() {
        // Unwrapped, `a$|b` anchors only the first branch.
        let o = opts(&["-e", "a$", "-e", "b"]);
        assert_eq!(build_pattern(&o), "(?:a$)|(?:b)");
        let o = opts(&["-F", "-e", "a.b", "-e", "c+d"]);
        assert_eq!(build_pattern(&o), r"(?:a\.b)|(?:c\+d)");
    }

    #[test]
    fn word_matching_is_delegated_to_the_matcher() {
        // Hand-rolled `\b...\b` cannot match a pattern whose edges are punctuation, so hay
        // silently returned nothing for `-w -F '@'` while ripgrep matched it. The pattern must
        // stay unadorned and `-w` must reach RegexMatcherBuilder::word.
        let o = opts(&["-w", "-F", "-e", "@"]);
        assert_eq!(build_pattern(&o), "(?:@)");
        assert!(o.word);
        let m = RegexMatcherBuilder::new()
            .word(o.word)
            .build(&build_pattern(&o))
            .unwrap();
        assert!(m.find(b"an @ sign").unwrap().is_some());
        assert!(m.find(b"email@example.com").unwrap().is_none());
    }

    #[test]
    fn context_flags_parse_in_glued_and_separate_form() {
        let o = opts(&["-C", "3", "x"]);
        assert_eq!((o.before, o.after), (3, 3));
        let o = opts(&["-C3", "x"]);
        assert_eq!((o.before, o.after), (3, 3));
        let o = opts(&["-A2", "-B1", "x"]);
        assert_eq!((o.before, o.after), (1, 2));
        // A glued value on a flag that takes none is still an unknown option, not a silent no-op.
        assert!(parse_args(vec!["-i3".into(), "x".into()]).is_err());
    }

    #[test]
    fn glued_values_do_not_swallow_long_options() {
        assert_eq!(opts(&["-tts", "x"]).types, vec!["ts"]);
        assert_eq!(opts(&["--type=ts", "x"]).types, vec!["ts"]);
    }

    #[test]
    fn combined_short_flags_are_accepted() {
        // 3,562 occurrences across 3,174 measured transcripts, and the hand-rolled parser exited
        // 2 on every one of them. This is the single largest drop-in gap hay had.
        let o = opts(&["-inF", "auth"]);
        assert!(o.ignore_case && o.line_numbers && o.fixed);
        assert_eq!(o.patterns, vec!["auth"]);
        // A value-taking flag may end a cluster, with the value attached or separate.
        let o = opts(&["-iC3", "auth"]);
        assert!(o.ignore_case);
        assert_eq!((o.before, o.after), (3, 3));
        let o = opts(&["-im", "5", "auth"]);
        assert!(o.ignore_case);
        assert_eq!(o.max_count, 5);
    }

    #[test]
    fn long_flags_take_an_equals_value() {
        let o = opts(&["--max-count=7", "--glob=*.ts", "auth"]);
        assert_eq!(o.max_count, 7);
        assert_eq!(o.globs, vec!["*.ts"]);
    }

    #[test]
    fn double_dash_ends_option_parsing() {
        // ripgrep fixed exactly this (BUG #270): a pattern that begins with `-`. Without `--`
        // the only route was `-e`, and `hay -- -foo` exited 2 on a valid ripgrep invocation.
        let o = opts(&["--", "-foo"]);
        assert_eq!(o.patterns, vec!["-foo"]);
        let o = opts(&["-i", "--", "-foo", "src"]);
        assert!(o.ignore_case);
        assert_eq!(o.patterns, vec!["-foo"]);
        assert_eq!(o.path, PathBuf::from("src"));
    }

    #[test]
    fn the_flags_hay_used_to_refuse_now_run_unranked() {
        // Until 0.3.0 these exited 2 with "use `rg`". They are valid ripgrep invocations, and a
        // tool you can only reach for once you know the question ranks is not a replacement for
        // the tool you would otherwise type. They now parse, and they select the unranked path.
        for argv in [
            vec!["-v", "x"],
            vec!["-c", "x"],
            vec!["--count-matches", "x"],
            vec!["-o", "x"],
            vec!["--stream", "x"],
        ] {
            let o = parse_args(argv.iter().map(|s| s.to_string()).collect())
                .unwrap_or_else(|e| panic!("{argv:?} should parse: {e}"));
            assert!(o.unranked(), "{argv:?} must select the unranked path");
        }
        // Ranked by default, which is the whole product.
        assert!(!opts(&["auth"]).unranked());
        // Two counting modes at once is a question with two answers; so is explaining a
        // ranking that did not happen.
        assert!(parse_args(vec!["-c".into(), "--count-matches".into(), "x".into()]).is_err());
        assert!(parse_args(vec!["--explain".into(), "--stream".into(), "x".into()]).is_err());
    }

    #[test]
    fn max_count_defaults_to_ripgreps_in_unranked_modes() {
        // The ranked page stops at 50 because an agent reads a page. ripgrep has no default cap,
        // so an unranked mode that quietly stopped at 50 would return FEWER matches than `rg` —
        // the one thing this tool promises never to do. An explicit `-m` still applies.
        let streamed = opts(&["--stream", "x"]);
        assert_eq!(streamed.max_count, 50, "the field keeps its default");
        assert!(!streamed.max_count_set, "but nothing asked for it");
        assert!(opts(&["--stream", "-m", "5", "x"]).max_count_set);
    }

    fn hit(path: &str, line_no: u64, text: &str) -> Hit {
        Hit {
            path: path.into(),
            line_no,
            fs_path: path.into(),
            offset: 0,
            text: text.into(),
            raw: None,
            terminated: true,
            span: (0, text.len()),
        }
    }

    /// `scores` lets a test put a different file's result between two results in the same file,
    /// which is the ordering that broke neighbour-only merging.
    fn render_scored(
        hits: &[Hit],
        scores: &[f64],
        ctx: &[(&str, u64, &str)],
        argv: &[&str],
    ) -> String {
        let o = opts(argv);
        let page: Vec<(ScoreBreakdown, &Hit)> = hits
            .iter()
            .enumerate()
            .map(|(i, h)| {
                let total = scores.get(i).copied().unwrap_or(1.0);
                (
                    ScoreBreakdown {
                        definition: 0.0,
                        path: 0.0,
                        word: 0.0,
                        tf: 0.0,
                        total,
                    },
                    h,
                )
            })
            .collect();
        let mut c = Context::default();
        for (p, n, t) in ctx {
            c.lines.insert(
                (PathBuf::from(p), *n),
                ContextLine {
                    offset: 0,
                    bytes: format!("{t}\n").into_bytes(),
                },
            );
            let e = c.last_line.entry(PathBuf::from(p)).or_insert(0);
            *e = (*e).max(*n);
        }
        // Every hit's own line exists too, or clamping would cut the window at the last context
        // line rather than at the end of the file.
        for h in hits {
            let e = c.last_line.entry(h.fs_path.clone()).or_insert(0);
            *e = (*e).max(h.line_no);
        }
        let m = RegexMatcherBuilder::new().build("x").unwrap();
        let mut buf = Vec::new();
        emit_lines(&mut buf, &page, &c, &m, &o).unwrap();
        String::from_utf8(buf).unwrap()
    }

    fn render(hits: &[Hit], ctx: &[(&str, u64, &str)], argv: &[&str]) -> String {
        render_scored(hits, &[], ctx, argv)
    }

    #[test]
    fn context_read_errors_are_not_silent() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("removed-after-search.txt");
        let h = hit(&missing.to_string_lossy(), 1, "x");
        let score = ScoreBreakdown {
            definition: 0.0,
            path: 0.0,
            word: 0.0,
            tf: 0.0,
            total: 1.0,
        };
        let page = [(score, &h)];
        let root = ContextRoot::new(dir.path()).unwrap();
        let err =
            read_context(&page, 1, 1, Some(&root)).expect_err("missing context file must fail");
        assert_eq!(err.kind(), io::ErrorKind::NotFound);
        assert!(
            err.to_string().contains("removed-after-search.txt"),
            "error should identify the incomplete file: {err}"
        );
    }

    #[test]
    fn context_root_rejects_paths_outside_the_search_tree() {
        let root_dir = tempfile::tempdir().unwrap();
        let outside_dir = tempfile::tempdir().unwrap();
        let allowed = root_dir.path().join("allowed.txt");
        let outside = outside_dir.path().join("secret.txt");
        std::fs::write(&allowed, b"allowed\n").unwrap();
        std::fs::write(&outside, b"secret\n").unwrap();

        let root = ContextRoot::new(root_dir.path()).unwrap();
        assert!(root.open(&allowed).unwrap().metadata().unwrap().is_file());
        let err = root
            .open(&outside)
            .expect_err("an anchored context reader must reject an outside path");
        assert_eq!(err.kind(), io::ErrorKind::PermissionDenied);
    }

    #[cfg(unix)]
    #[test]
    fn context_reread_cannot_follow_a_symlink_outside_the_search_tree() {
        use std::os::unix::fs::symlink;

        let root_dir = tempfile::tempdir().unwrap();
        let outside_dir = tempfile::tempdir().unwrap();
        let matched = root_dir.path().join("matched.txt");
        let outside = outside_dir.path().join("secret.txt");
        std::fs::write(&matched, b"safe\n").unwrap();
        std::fs::write(&outside, b"secret\n").unwrap();

        let root = ContextRoot::new(root_dir.path()).unwrap();
        let h = hit(&matched.to_string_lossy(), 1, "safe");
        let score = ScoreBreakdown {
            definition: 0.0,
            path: 0.0,
            word: 0.0,
            tf: 0.0,
            total: 1.0,
        };
        let page = [(score, &h)];
        let before = read_context(&page, 1, 0, Some(&root)).unwrap();
        assert_eq!(before.lines[&(matched.clone(), 1)].bytes, b"safe\n");

        std::fs::remove_file(&matched).unwrap();
        symlink(&outside, &matched).unwrap();
        let err = read_context(&page, 1, 0, Some(&root))
            .expect_err("context must not escape through a replaced symlink");
        assert_eq!(err.kind(), io::ErrorKind::PermissionDenied);
    }

    #[test]
    fn overlapping_context_windows_print_each_line_once() {
        let hits = [hit("a.txt", 2, "beta"), hit("a.txt", 3, "gamma")];
        let ctx = [("a.txt", 1, "alpha"), ("a.txt", 4, "delta")];
        // Both matches keep `:`. Printing gamma's window separately would emit line 3 a second
        // time with the `-` separator, which tells a consumer that a match is not a match.
        assert_eq!(
            render(&hits, &ctx, &["-C1", "x"]),
            "a.txt-1-alpha\na.txt:2:beta\na.txt:3:gamma\na.txt-4-delta\n"
        );
    }

    #[test]
    fn disjoint_windows_stay_separate_blocks() {
        let hits = [hit("a.txt", 1, "alpha"), hit("a.txt", 5, "epsilon")];
        let ctx = [("a.txt", 2, "beta"), ("a.txt", 4, "delta")];
        assert_eq!(
            render(&hits, &ctx, &["-C1", "x"]),
            "a.txt:1:alpha\na.txt-2-beta\n--\na.txt-4-delta\na.txt:5:epsilon\n"
        );
        // Different files never merge, however close the line numbers.
        let hits = [hit("a.txt", 2, "beta"), hit("b.txt", 2, "beta")];
        assert!(render(&hits, &[], &["-C1", "x"]).contains("--"));
    }

    #[test]
    fn without_context_rank_order_is_untouched() {
        // Line-number order within a block is right for a context window and wrong for the
        // ranked list: here the weaker-ranked line 1 must still print second.
        let hits = [hit("a.txt", 4, "delta"), hit("a.txt", 1, "alpha")];
        assert_eq!(render(&hits, &[], &["x"]), "a.txt:4:delta\na.txt:1:alpha\n");
    }

    #[test]
    fn equal_scoring_candidates_have_a_total_order() {
        // Truncation keeps the best MAX_CANDIDATES. If equal prescores compared Equal, which of
        // them survived would depend on the order the parallel walker delivered them, so the
        // same search over the same tree could return different lines on different runs.
        let a = Candidate {
            prescore: 1.0,
            hit: hit("a.txt", 9, "x"),
        };
        let b = Candidate {
            prescore: 1.0,
            hit: hit("b.txt", 1, "x"),
        };
        assert!(a < b, "equal prescores must still order by path");
        let c = Candidate {
            prescore: 1.0,
            hit: hit("a.txt", 10, "x"),
        };
        assert!(a < c, "same path and prescore must order by line");
        // And a higher prescore always wins regardless of path.
        let d = Candidate {
            prescore: 2.0,
            hit: hit("z.txt", 99, "x"),
        };
        assert!(d < a);
    }

    #[test]
    fn diversification_shows_each_file_once_before_showing_any_file_twice() {
        // Score order in, round-robin out. The third file must not wait behind a.txt's tail.
        let order = diversified_order(&["a.txt", "a.txt", "b.txt", "a.txt", "c.txt"]);
        assert_eq!(order, vec![0, 2, 4, 1, 3]);
        // Rank order is preserved inside each pass, so the result is still deterministic and
        // still monotone in score within a file.
        assert_eq!(diversified_order(&["a", "b", "c"]), vec![0, 1, 2]);
        assert_eq!(diversified_order(&[]), Vec::<usize>::new());
        assert_eq!(diversified_order(&["a", "a", "a"]), vec![0, 1, 2]);
    }

    #[test]
    fn diversification_cannot_change_which_file_comes_first() {
        // A file's first appearance is at its strongest line, so the sequence of DISTINCT files —
        // which is what `-l` prints and what a file-level judgment scores — is untouched. If this
        // ever failed, diversification would be re-ranking rather than re-laying-out.
        let paths = ["b.rs", "a.rs", "b.rs", "c.rs", "a.rs"];
        fn first_seen<'a>(xs: &[&'a str]) -> Vec<&'a str> {
            let mut seen: Vec<&'a str> = Vec::new();
            for p in xs {
                if !seen.contains(p) {
                    seen.push(p);
                }
            }
            seen
        }
        let after: Vec<&str> = diversified_order(&paths)
            .into_iter()
            .map(|i| paths[i])
            .collect();
        assert_eq!(first_seen(&paths), first_seen(&after));
    }

    #[test]
    fn matched_span_survives_a_non_ascii_line() {
        // `is_whole_word` once advanced a byte at a time and panicked here.
        let h = Hit {
            path: "src/a.rs".into(),
            fs_path: "src/a.rs".into(),
            line_no: 1,
            offset: 0,
            text: "let café = createClient()".into(),
            raw: None,
            terminated: true,
            span: (12, 24),
        };
        assert_eq!(h.matched(), "createClient");
        // A byte-oriented pattern can legitimately match one continuation byte of `é`. That must
        // score as the byte it matched, lossily decoded — not as the whole line, which is what a
        // char-boundary-checked `str::get` fell back to, corrupting every ranking signal.
        let inside = Hit { span: (7, 8), ..h };
        assert_eq!(inside.matched(), "\u{FFFD}");
        // Only a span outside the line at all falls back, and it still must not panic.
        let out_of_range = Hit {
            span: (900, 901),
            ..inside
        };
        assert_eq!(out_of_range.matched(), out_of_range.text);
    }

    #[test]
    fn a_shared_context_line_prints_once_without_reordering_results() {
        // Score order, not line order: m.txt sits between the two a.txt results, whose context
        // windows overlap at line 3. Two wrong answers were possible and both happened: printing
        // line 3 in each window, then merging the windows into one block, which dragged a -0.95
        // result ahead of a 4.85 one. Rank order is the product; it wins.
        let hits = [
            hit("a.txt", 2, "function target() {"),
            hit("m.txt", 1, "function target() {"),
            hit("a.txt", 4, "  call target(x)"),
        ];
        let ctx = [("a.txt", 1, "l1"), ("a.txt", 3, "l3"), ("a.txt", 5, "l5")];
        let out = render_scored(&hits, &[5.05, 4.85, -0.95], &ctx, &["-C1", "x"]);
        assert_eq!(out.matches("l3").count(), 1, "line 3 printed twice:\n{out}");
        assert_eq!(
            out,
            "a.txt-1-l1\na.txt:2:function target() {\na.txt-3-l3\n\
             --\nm.txt:1:function target() {\n\
             --\na.txt:4:  call target(x)\na.txt-5-l5\n"
        );
        // Descending score order, not file order.
        let order: Vec<&str> = out.lines().filter(|l| l.contains(':')).collect();
        assert_eq!(
            order,
            vec![
                "a.txt:2:function target() {",
                "m.txt:1:function target() {",
                "a.txt:4:  call target(x)",
            ]
        );
    }

    #[test]
    fn windows_running_backward_still_get_a_separator() {
        // Results are score-ordered, so the same file can be visited at line 4 and then line 2.
        // The windows overlap numerically, so a contiguity test based on window arithmetic saw
        // them as one block and printed lines 3,4,5 immediately followed by 1,2 with no `--` —
        // presenting a backward jump as continuous context.
        let hits = [hit("a.txt", 4, "four"), hit("a.txt", 2, "two")];
        let ctx = [("a.txt", 1, "l1"), ("a.txt", 3, "l3"), ("a.txt", 5, "l5")];
        let out = render_scored(&hits, &[9.0, 1.0], &ctx, &["-C1", "x"]);
        assert_eq!(
            out,
            "a.txt-3-l3\na.txt:4:four\na.txt-5-l5\n--\na.txt-1-l1\na.txt:2:two\n"
        );
    }

    #[test]
    fn a_ranked_line_is_never_printed_as_context() {
        // a.txt:3 is itself a result, so a.txt:2's window must not print it with the `-`
        // separator that tells a consumer it did not match.
        let hits = [hit("a.txt", 2, "beta"), hit("a.txt", 3, "gamma")];
        let out = render(&hits, &[("a.txt", 3, "gamma")], &["-C1", "x"]);
        assert!(
            !out.contains("a.txt-3-"),
            "match emitted as context:\n{out}"
        );
        assert_eq!(out.matches("gamma").count(), 1, "{out}");
    }

    #[test]
    fn a_huge_context_window_stops_at_the_end_of_the_file() {
        // `-A 1000000000000` is a valid ripgrep argument. Iterating the arithmetic window instead
        // of the file's real extent was a trillion lookups past EOF — indistinguishable from a
        // hang — and `hi + 1` overflowed once saturation reached u64::MAX.
        let hits = [hit("a.txt", 1, "only")];
        let ctx = [("a.txt", 2, "second")];
        let out = render(&hits, &ctx, &["-A", "1000000000000", "x"]);
        assert_eq!(out, "a.txt:1:only\na.txt-2-second\n");
        let out = render(
            &hits,
            &ctx,
            &[
                "-B",
                &usize::MAX.to_string(),
                "-A",
                &usize::MAX.to_string(),
                "x",
            ],
        );
        assert_eq!(out, "a.txt:1:only\na.txt-2-second\n");
    }

    #[test]
    fn base64_matches_the_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        // The byte that made hay reject a Latin-1 line outright.
        assert_eq!(base64(&[0xe9]), "6Q==");
    }
}
