//! Ranking. Pure functions over already-collected matches, so every signal is unit-testable
//! without touching the filesystem.
//!
//! A note on BM25, because the design doc got this wrong: for a SINGLE-term query the inverse
//! document frequency is identical for every candidate file, so it contributes nothing to the
//! ordering. BM25 here degenerates to term-frequency saturation with length normalisation. The
//! discriminating work is therefore done almost entirely by the structural signals below, and
//! term frequency is kept only as a weak tie-breaker.

/// Where a path sits in the hierarchy of "likely to be the answer".
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PathClass {
    /// src/, lib/, app/, packages/ — implementation.
    Source,
    /// Anything not otherwise classified.
    Neutral,
    /// Tests: usually about the answer rather than being it.
    Test,
    /// Prose: docs, plans, notes.
    Prose,
    /// Generated or bulk data: lockfiles, snapshots, fixtures, JSON dumps. Almost never the
    /// answer to a concept query, and dangerous because bulk data can contain a term hundreds of
    /// times and win on frequency alone. Observed: an evidence JSON outranked the source file.
    Data,
    /// archive/, .scratch/, vendor/, dist/ — deliberately not the answer.
    Buried,
}

pub fn classify_path(path: &str) -> PathClass {
    let p = path.to_ascii_lowercase().replace('\\', "/");

    // A marker matches anywhere in the path, or at its root when written without a leading
    // slash (`src/foo.rs` has no `/` before `src`). One predicate for every table so they can
    // never drift apart; the old SOURCE spelling re-allocated `format!("/{d}")` per path on
    // the hot scoring path.
    fn hits_marker(p: &str, marker: &str) -> bool {
        p.contains(marker) || p.starts_with(marker.trim_start_matches('/'))
    }

    // Buried wins over everything: a vendored or archived test is still buried.
    const BURIED: [&str; 12] = [
        "/archive/",
        "/archived/",
        "/.scratch/",
        "/vendor/",
        "/dist/",
        "/build/",
        "/node_modules/",
        "/target/",
        "/.next/",
        "/coverage/",
        "/generated/",
        "/superseded/",
    ];
    if BURIED.iter().any(|d| hits_marker(&p, d)) {
        return PathClass::Buried;
    }

    const TEST: [&str; 8] = [
        "/test/",
        "/tests/",
        "/__tests__/",
        "/spec/",
        ".test.",
        ".spec.",
        "_test.",
        "/e2e/",
    ];
    if TEST.iter().any(|d| hits_marker(&p, d)) {
        return PathClass::Test;
    }

    if is_data(&p) {
        return PathClass::Data;
    }
    if is_prose(&p) {
        return PathClass::Prose;
    }

    const SOURCE: [&str; 5] = ["/src/", "/lib/", "/app/", "/packages/", "/crates/"];
    if SOURCE.iter().any(|d| hits_marker(&p, d)) {
        return PathClass::Source;
    }
    PathClass::Neutral
}

pub fn is_data(path_lower: &str) -> bool {
    const EXT: [&str; 11] = [
        ".json", ".lock", ".csv", ".tsv", ".snap", ".ndjson", ".jsonl", ".min.js", ".map",
        ".sqlite", ".parquet",
    ];
    EXT.iter().any(|e| path_lower.ends_with(e))
        || path_lower.contains("/fixtures/")
        || path_lower.contains("/__snapshots__/")
}

pub fn is_prose(path_lower: &str) -> bool {
    const EXT: [&str; 5] = [".md", ".mdx", ".txt", ".rst", ".adoc"];
    EXT.iter().any(|e| path_lower.ends_with(e))
}

/// Weight applied to every line in a file of this class.
fn path_weight(c: PathClass) -> f64 {
    match c {
        PathClass::Source => 1.0,
        PathClass::Neutral => 0.0,
        PathClass::Test => -1.0,
        PathClass::Prose => -1.5,
        PathClass::Data => -3.0,
        PathClass::Buried => -4.0,
    }
}

/// Declaration keywords across the languages agents actually search. Deliberately broad: a false
/// positive costs one rank position, a false negative buries the answer.
const DECL_KEYWORDS: [&str; 21] = [
    "function",
    "const",
    "let",
    "var",
    "class",
    "interface",
    "type",
    "enum",
    "struct",
    "trait",
    "impl",
    "protocol",
    "module",
    "def",
    "func",
    "fn",
    "fun",
    "record",
    "object",
    "package",
    "namespace",
];

/// Identifier character, spelled once: three sites across the definition heuristics must agree
/// on what separates one name from the next. (`looks_like_definition`'s boundary scan works on
/// ASCII bytes and keeps its own deliberately ASCII-only check.)
fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Where to resume a `find` scan after a rejected occurrence at byte `i`.
///
/// `i + 1` is the obvious spelling and it PANICS: on `a\u{e9}\u{e9}` searching for `\u{e9}\u{e9}`,
/// the first occurrence starts inside a word so the scan advances to a byte in the middle of a
/// two-byte character, and slicing there aborts the ranking thread. Reproduced with
/// `hay -F -e 'éé'` on a line containing `aéé`: exit 2, "ranking thread panicked", on a search
/// ripgrep answers normally. Every scan of this shape must step by a whole character.
fn next_scan_start(s: &str, i: usize) -> usize {
    i + s[i..].chars().next().map_or(1, char::len_utf8)
}

/// Does this line look like it *declares* the query rather than merely mentioning it?
///
/// Scans tokens before the match for a declaration keyword. Also treats `query:` / `query =` at
/// the start of a line as a definition-ish shape (object literals, YAML keys, struct fields).
pub fn looks_like_definition(line: &str, query: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    let q = query.to_ascii_lowercase();
    // The first occurrence AT A WORD BOUNDARY: a match that starts mid-identifier
    // (`Semantic⟨fingerprint⟩`) is a substring of some other name and can never be that name's
    // declaration — without this, `let semantic = SemanticFingerprint(x)` passed the
    // typed-declaration shape with the identifier's own prefix playing the "return type".
    // A prefix match (`⟨fingerprint⟩Cache`) still counts: the declared name starts with the
    // query, which is the shape symbol search ranks highest.
    let mut at = None;
    let mut from = 0;
    while let Some(i) = lower[from..].find(&q).map(|i| i + from) {
        let prev = (i > 0).then(|| lower.as_bytes()[i - 1]);
        if !prev.is_some_and(|b| b.is_ascii_alphanumeric() || b == b'_') {
            at = Some(i);
            break;
        }
        from = next_scan_start(&lower, i);
    }
    let Some(at) = at else {
        return false;
    };

    let before = &lower[..at];
    // A declaration keyword preceding the match, allowing modifiers between — but the keyword
    // must be declaring THIS name. `const body = await readOptionalJsonBody(...)` has `const`
    // in the window, and `const` declares `body`: the match is a call on the right of an `=`.
    // Likewise `const results: Array<FeedSource>` puts the match in type position after a `:`.
    // Counted in the 2026-08-20 error taxonomy (issue 10): thirteen identical call-site
    // "definitions" outranked one real answer, and the same shape (`let x = SomeType(...)`)
    // drove most of the Swift miss bucket. A `=` or `:` between keyword and match ends the
    // keyword's declaration before the match — EXCEPT inside braces, where the colon is an
    // aliasing binding, not a type position: in `const { remoteName: localName } = value` the
    // keyword really does declare `localName`. Review caught the first version rejecting that.
    let mut tokens: Vec<(usize, &str)> = Vec::new();
    let mut start: Option<usize> = None;
    for (i, c) in before.char_indices() {
        if is_ident_char(c) {
            start.get_or_insert(i);
        } else if let Some(s) = start.take() {
            tokens.push((s, &before[s..i]));
        }
    }
    if let Some(s) = start {
        tokens.push((s, &before[s..]));
    }
    let declaration_continues = |segment: &str| {
        let mut depth = 0u32;
        for c in segment.chars() {
            match c {
                '{' => depth += 1,
                '}' => depth = depth.saturating_sub(1),
                '=' | ':' if depth == 0 => return false,
                _ => {}
            }
        }
        true
    };
    let has_kw =
        tokens.iter().rev().take(4).any(|&(s, t)| {
            DECL_KEYWORDS.contains(&t) && declaration_continues(&before[s + t.len()..])
        });
    if has_kw {
        return true;
    }

    // `foo:` or `foo =` where foo is the query and the line starts with it (after indentation).
    let trimmed = lower.trim_start();
    if trimmed.starts_with(&q) {
        let rest = trimmed[q.len()..].trim_start();
        // `foo(` deliberately excluded: at the start of a line that is a CALL, not a
        // declaration. Languages that declare with a bare name plus parens (`def foo(`) are
        // already covered by the keyword scan above. Caught by a ranking test.
        //
        // `foo?:` counts like `foo:` — a TypeScript optional property IS the declaration, and
        // without it `APPLE_CLIENT_ID?: string;` scored zero while the test fixtures assigning
        // that key scored as definitions (issue 10): the declaration lost to its own fixtures
        // on a one-character technicality. `?.` (optional chaining) must not match.
        if rest.starts_with(':') || rest.starts_with('=') || rest.starts_with("?:") {
            return true;
        }
    }

    looks_like_typed_declaration(&lower, at, &q)
}

/// `[modifiers] Type name(args)` — a declaration with no keyword to key on.
///
/// C, C++, Java and Objective-C all declare this way, and the keyword scan cannot see any of them:
/// `static int ext4_read_block(struct inode *inode)` contains no word from `DECL_KEYWORDS`, so on C
/// the definition signal never fired at all and a definition scored exactly what its call sites
/// scored. Measured on the Linux kernel before this existed, `hay` scored MRR 0.633 against
/// ripgrep's 0.640 — on the largest C codebase in the world the entire product advantage was
/// missing, and no test caught it because every test was written in Rust or TypeScript.
fn looks_like_typed_declaration(lower: &str, at: usize, q: &str) -> bool {
    let line = lower.trim_end();
    // A definition's line does not terminate a statement. `int foo(void);` is a prototype and
    // `x = foo(a);` is a call; neither is the implementation someone searching wants.
    if line.ends_with(';') {
        return false;
    }
    // English prose has the same shape as a typed declaration — "the parse(x) helper" puts an
    // identifier before a name before a paren — and comments are where this rule produced most of
    // its false positives on Rust. `#` is deliberately not a comment marker here: `#define foo(x)`
    // is a real declaration, while `# foo(x)` with a space is a shell or Python comment.
    let start = line.trim_start();
    if start.starts_with("//")
        || start.starts_with("/*")
        || start.starts_with('*')
        || start.starts_with("--")
        || start.starts_with("# ")
    {
        return false;
    }
    // The match has to be the thing being declared, i.e. immediately followed by its parameters.
    if !lower[at + q.len()..].trim_start().starts_with('(') {
        return false;
    }
    // Something must precede it on the line, and that something must look like a return type:
    // an identifier. This is what separates `static int foo(` from `x = foo(`, `if (foo(`,
    // `a->foo(` and `int main(void) { foo(` — in each of those the character before the match is
    // punctuation, not the tail of a type name.
    let before = lower[..at].trim_end();
    if !before.ends_with(|c: char| is_ident_char(c)) {
        return false;
    }
    let prev = before
        .rsplit(|c: char| !is_ident_char(c))
        .find(|t| !t.is_empty())
        .unwrap_or("");
    // Words that put an identifier immediately before a call without declaring anything. Chosen
    // by counting what actually preceded each firing across a Rust corpus, not by imagination:
    // `match` fired 11 times, `in` 5, `dyn` 2, and those three were most of the regression this
    // rule caused on Rust before they were excluded.
    const CONTROL: [&str; 22] = [
        "if",
        "for",
        "while",
        "switch",
        "return",
        "else",
        "case",
        "do",
        "sizeof",
        "catch",
        "await",
        "match",
        "in",
        "dyn",
        "as",
        "move",
        "mut",
        "ref",
        "new",
        "typeof",
        "instanceof",
        "throw",
    ];
    !CONTROL.contains(&prev)
}

/// How exactly the match sits inside the line's identifiers.
///
/// Pre-registered in DESIGN-hay.md ("exact case/word match > substring — free from the matcher")
/// and never implemented until 0.2.0. Under the case-insensitive substring search agents actually
/// run, `auth` matches `oauthToken`, `authenticate` and `auth`; only the last is the concept the
/// query names, and the middle one at least starts with it.
///
/// 1.0 for a whole identifier, 0.5 when the query starts one, 0 when it is buried inside a longer
/// name. Never negative: bounded retention drops candidates on prescore, and a signal that can
/// subtract would make a dropped line able to outrank a kept one.
pub fn word_affinity(line: &str, query: &str) -> f64 {
    let lower = line.to_ascii_lowercase();
    let q = query.to_ascii_lowercase();
    if q.is_empty() {
        return 0.0;
    }
    let mut best: f64 = 0.0;
    let mut from = 0;
    while let Some(i) = lower[from..].find(&q).map(|i| i + from) {
        let end = i + q.len();
        let before_is_ident = lower[..i].chars().next_back().is_some_and(is_ident_char);
        let after_is_ident = lower[end..].chars().next().is_some_and(is_ident_char);
        if !before_is_ident {
            best = best.max(if after_is_ident { 0.5 } else { 1.0 });
        }
        if best >= 1.0 {
            break;
        }
        from = next_scan_start(&lower, i);
    }
    best
}

/// Weights. Named constants rather than magic numbers so ablation can zero them individually.
/// Only signals that measurably improve MRR are here. `exact_case` (matching the query's own
/// casing) and `comment_penalty` (down-ranking comment lines) were implemented, ablated against
/// the real test collection, contributed +0.000 each, and were deleted rather than kept because
/// they sounded sensible.
///
/// `filename` — a bonus for a file whose own name is the query — was added in this cycle, ablated
/// on both public sets, and deleted: +0.008 MRR on openclaw, +0.000 on ripgrep, -0.002 on
/// alamofire, and **-0.014 on SWE-Explore**, the one public agent-shaped benchmark. It is the
/// highest-weighted field in every published lexical code retriever (BM25F over filename), it
/// scored +0.033 in a simulation on the private evaluation corpus, and it still does not ship,
/// because the evaluation set does not get a vote and the development sets said no.
#[derive(Debug)]
pub struct Weights {
    pub definition: f64,
    pub path: f64,
    pub word: f64,
    pub term_frequency: f64,
}

impl Default for Weights {
    fn default() -> Self {
        Self {
            definition: 6.0,
            path: 1.0,
            word: 1.0,
            term_frequency: 0.5,
        }
    }
}

pub struct LineInput<'a> {
    pub path: &'a str,
    pub line: &'a str,
    pub query: &'a str,
    /// Matches for this query in this file. Saturating, so a file with 200 mentions does not
    /// swamp the file that defines it once.
    pub file_matches: usize,
}

/// Per-signal decomposition of one line's score. `--explain` prints it, and error analysis
/// depends on it: a total alone cannot say WHICH signal put a wrong line on top.
#[derive(Debug, Clone, Copy)]
pub struct ScoreBreakdown {
    pub definition: f64,
    pub path: f64,
    pub word: f64,
    pub tf: f64,
    pub total: f64,
}

/// The single scoring source of truth: `prescore_line` and `score_line` are views of this, so the
/// printed breakdown can never drift from the score it explains.
pub fn explain_line(inp: &LineInput, w: &Weights) -> ScoreBreakdown {
    let definition = if looks_like_definition(inp.line, inp.query) {
        w.definition
    } else {
        0.0
    };
    let path = w.path * path_weight(classify_path(inp.path));
    let word = w.word * word_affinity(inp.line, inp.query);
    // Saturating AND capped. Uncapped, ln(1+n) on a half-million-match query reaches ~6.5 and can
    // outweigh the definition signal (6.0) — which would also make bounded retention by prescore
    // unsound, since a dropped candidate could out-score a kept one purely on frequency.
    const TF_CAP: f64 = 2.0;
    let tf = w.term_frequency * (1.0 + inp.file_matches as f64).ln().min(TF_CAP);
    ScoreBreakdown {
        definition,
        path,
        word,
        tf,
        total: definition + path + word + tf,
    }
}

/// Everything except term frequency. Computable from one line in isolation, which is what makes
/// bounded retention possible: candidates can be kept or dropped during the walk, before the
/// per-file counts are known.
pub fn prescore_line(inp: &LineInput, w: &Weights) -> f64 {
    explain_line(
        &LineInput {
            path: inp.path,
            line: inp.line,
            query: inp.query,
            // ln(1 + 0) = 0: zero matches zeroes the frequency term exactly.
            file_matches: 0,
        },
        w,
    )
    .total
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The full score is `explain_line(..).total`; named here so the ranking tests read as
    /// statements about scores rather than about the breakdown plumbing.
    fn score_line(inp: &LineInput, w: &Weights) -> f64 {
        explain_line(inp, w).total
    }

    #[test]
    fn path_classification() {
        assert_eq!(classify_path("src/auth/session.ts"), PathClass::Source);
        assert_eq!(classify_path("packages/core/src/x.ts"), PathClass::Source);
        assert_eq!(classify_path("README.md"), PathClass::Prose);
        assert_eq!(classify_path("docs/archive/old.md"), PathClass::Buried);
        assert_eq!(classify_path("src/__tests__/a.test.ts"), PathClass::Test);
        assert_eq!(classify_path("vendor/lib/x.go"), PathClass::Buried);
        assert_eq!(classify_path("main.go"), PathClass::Neutral);
        // Buried beats test: a vendored test is still not the answer.
        assert_eq!(
            classify_path("vendor/pkg/__tests__/x.ts"),
            PathClass::Buried
        );
        // Windows separators must classify identically.
        assert_eq!(classify_path("docs\\archive\\old.md"), PathClass::Buried);
        // Generated/bulk data: observed outranking source because it repeats a term hundreds
        // of times, which the frequency term rewards.
        assert_eq!(classify_path("evidence/run.json"), PathClass::Data);
        assert_eq!(classify_path("bun.lock"), PathClass::Data);
        assert_eq!(classify_path("src/__snapshots__/a.snap"), PathClass::Data);
        assert_eq!(classify_path("src/index.ts"), PathClass::Source);
    }

    #[test]
    fn definition_detection() {
        assert!(looks_like_definition(
            "export const createClient = () => {}",
            "createClient"
        ));
        assert!(looks_like_definition(
            "  function handleAuth(req) {",
            "handleAuth"
        ));
        assert!(looks_like_definition(
            "pub fn score_line(x: u8) {}",
            "score_line"
        ));
        assert!(looks_like_definition(
            "class SessionStore {",
            "SessionStore"
        ));
        assert!(looks_like_definition("def retry_policy():", "retry_policy"));
        assert!(!looks_like_definition(
            "  return createClient(cfg)",
            "createClient"
        ));
        assert!(!looks_like_definition(
            "// see createClient for details",
            "createClient"
        ));
        // Object-literal / YAML shape counts as a definition.
        assert!(looks_like_definition("  timeout: 30", "timeout"));
        assert!(!looks_like_definition("if (timeout > 30)", "timeout"));
        // A TS optional property is a declaration; optional chaining is not.
        assert!(looks_like_definition(
            "  APPLE_CLIENT_ID?: string;",
            "APPLE_CLIENT_ID"
        ));
        assert!(!looks_like_definition("  config?.timeout", "config"));
        // A call at the start of a line is not a declaration.
        assert!(!looks_like_definition("  handleAuth(req)", "handleAuth"));
        assert!(looks_like_definition("def handleAuth(req):", "handleAuth"));
    }

    /// The keyword must be declaring THE MATCHED NAME. Counted in issue 10: `const x = f(...)`
    /// shapes were the largest single false-positive source across two languages, and a type
    /// annotation puts the match after a `:` where nothing is being declared by that keyword.
    #[test]
    fn a_keyword_declaring_something_else_is_not_a_definition() {
        // The keyword's declaration ended at `=`; the match is a call on the right-hand side.
        assert!(!looks_like_definition(
            "const body = await readOptionalJsonBody(request)",
            "readOptionalJsonBody"
        ));
        assert!(!looks_like_definition(
            "let semantic = SemanticFingerprint(subject)",
            "fingerprint"
        ));
        assert!(!looks_like_definition(
            "  var updated = returnedRows(result)",
            "returnedRows"
        ));
        // Type position: `results` is declared, the match is its type parameter.
        assert!(!looks_like_definition(
            "const results: Array<FeedSource> = [];",
            "FeedSource"
        ));
        // But the declared name itself still counts, with or without an annotation or value.
        assert!(looks_like_definition(
            "const results: Array<FeedSource> = [];",
            "results"
        ));
        assert!(looks_like_definition(
            "let fingerprint = toHex(digest)",
            "fingerprint"
        ));
        // Go methods put a receiver between `func` and the name — no `=`/`:`, still declared.
        assert!(looks_like_definition(
            "func (s *server) handleConn(c net.Conn) error {",
            "handleConn"
        ));
        // Aliased destructuring: the colon is inside braces, and `localName` IS being declared.
        // Review caught the first version of the colon rule rejecting this.
        assert!(looks_like_definition(
            "const { remoteName: localName } = value",
            "localName"
        ));
        assert!(looks_like_definition(
            "function render({ label: text }: Props) {",
            "text"
        ));
        // But a type annotation's colon is outside braces and still disqualifies.
        assert!(!looks_like_definition(
            "const results: Array<{ item: FeedSource }> = [];",
            "FeedSource"
        ));
    }

    #[test]
    fn typed_declarations_without_a_keyword_are_definitions() {
        // C: the shape that made hay's definition signal inert on the entire Linux kernel.
        assert!(looks_like_definition(
            "static int ext4_read_block(struct inode *inode)",
            "ext4_read_block"
        ));
        assert!(looks_like_definition(
            "void setup_arch(char **cmdline_p)",
            "setup_arch"
        ));
        assert!(looks_like_definition("int foo(void) {", "foo"));
        // Multi-line kernel signatures continue with a comma and are still definitions.
        assert!(looks_like_definition(
            "static ssize_t foo(struct file *f,",
            "foo"
        ));
        // Java/C++ member declarations share the shape.
        assert!(looks_like_definition(
            "public String getName() {",
            "getName"
        ));

        // And the things that merely look like it must not be.
        assert!(
            !looks_like_definition("int foo(void);", "foo"),
            "prototype is not the definition"
        );
        assert!(!looks_like_definition(
            "  ret = ext4_read_block(inode);",
            "ext4_read_block"
        ));
        assert!(!looks_like_definition("  if (foo(x)) {", "foo"));
        assert!(!looks_like_definition("  return foo(x)", "foo"));
        assert!(!looks_like_definition("  obj->foo(x)", "foo"));
        assert!(!looks_like_definition("  obj.foo(x)", "foo"));
        assert!(!looks_like_definition("int main(void) { foo(); }", "foo"));
        assert!(
            !looks_like_definition("  foo(bar)", "foo"),
            "a bare call is still not a definition"
        );

        // Counted, not imagined: these are the tokens that actually preceded the rule's false
        // positives across a Rust corpus, and prose inside comments was most of the rest.
        assert!(!looks_like_definition(
            "    match parse_thing(x) {",
            "parse_thing"
        ));
        assert!(!looks_like_definition(
            "    for x in parse_thing(y) {",
            "parse_thing"
        ));
        // No `let` here: with it, the pre-existing keyword rule fires first and this would be
        // testing that rule rather than this one.
        assert!(!looks_like_definition(
            "    f: Box<dyn parse_thing(u8)>",
            "parse_thing"
        ));
        assert!(!looks_like_definition(
            "    a = new parse_thing(1)",
            "parse_thing"
        ));
        assert!(!looks_like_definition(
            "// the parse_thing(x) helper",
            "parse_thing"
        ));
        assert!(!looks_like_definition(
            "   * see parse_thing(x) for details",
            "parse_thing"
        ));
        assert!(!looks_like_definition(
            "-- calls parse_thing(x)",
            "parse_thing"
        ));
        assert!(!looks_like_definition(
            "# see parse_thing(x)",
            "parse_thing"
        ));
        // But a C preprocessor directive IS a declaration, and starts with the same character.
        assert!(looks_like_definition(
            "#define parse_thing(x) ((x) + 1)",
            "parse_thing"
        ));
    }

    #[test]
    fn frequency_term_cannot_outweigh_a_definition() {
        let w = Weights::default();
        let def = score_line(
            &LineInput {
                path: "src/a.ts",
                line: "export function foo() {}",
                query: "foo",
                file_matches: 1,
            },
            &w,
        );
        let bulk = score_line(
            &LineInput {
                path: "src/b.ts",
                line: "  foo(bar)",
                query: "foo",
                file_matches: 500_000,
            },
            &w,
        );
        assert!(
            def > bulk,
            "definition {def} must beat a high-frequency mention {bulk}"
        );
    }

    /// The behaviour the whole tool exists for: a definition in source must outrank a mention in
    /// an archived plan, however many times the plan repeats it.
    #[test]
    fn definition_in_source_beats_mention_in_archive() {
        let w = Weights::default();
        let def = score_line(
            &LineInput {
                path: "src/auth.ts",
                line: "export function validateSession(t: string) {",
                query: "validateSession",
                file_matches: 2,
            },
            &w,
        );
        let mention = score_line(
            &LineInput {
                path: "docs/archive/plan-v3.md",
                line: "we will call validateSession from the gateway, see validateSession notes",
                query: "validateSession",
                file_matches: 40,
            },
            &w,
        );
        assert!(
            def > mention,
            "definition {def} should outrank archived mention {mention}"
        );
    }

    /// Prescore must equal the full score minus the frequency term, or bounded retention would
    /// drop candidates the full scorer would have ranked highly.
    #[test]
    fn prescore_matches_score_without_frequency() {
        let w = Weights::default();
        let inp = LineInput {
            path: "src/a.ts",
            line: "export function handleAuth() {",
            query: "handleAuth",
            file_matches: 7,
        };
        let tf = w.term_frequency * (1.0 + 7.0f64).ln().min(2.0);
        assert!((score_line(&inp, &w) - (prescore_line(&inp, &w) + tf)).abs() < 1e-9);
    }

    /// The breakdown is the score: components must sum to the total, and the total must equal
    /// `score_line`, or `--explain` would print a story the ranking did not follow.
    #[test]
    fn breakdown_components_sum_to_the_score() {
        let w = Weights::default();
        let inp = LineInput {
            path: "src/a.ts",
            line: "export function foo() {}",
            query: "foo",
            file_matches: 7,
        };
        let b = explain_line(&inp, &w);
        assert!((b.definition + b.path + b.word + b.tf - b.total).abs() < 1e-12);
        assert!((b.total - score_line(&inp, &w)).abs() < 1e-12);
        assert!(b.definition > 0.0 && b.path > 0.0 && b.tf > 0.0 && b.word > 0.0);
    }

    /// Found by review, reproduced from the command line: a non-ASCII query whose first occurrence
    /// sits inside a word made both scans advance by one BYTE into the middle of a character, and
    /// slicing there panicked the ranking thread — `hay -F -e 'éé'` over a file containing
    /// `let x = aéé` exited 2 with "ranking thread panicked" on a search ripgrep answers.
    #[test]
    fn a_multibyte_query_buried_in_a_word_does_not_panic() {
        assert!(!looks_like_definition("let x = aéé", "éé"));
        assert_eq!(word_affinity("let x = aéé", "éé"), 0.0);
        // The same query where it IS declared still scores as one.
        assert!(looks_like_definition("const éé = 1", "éé"));
        assert_eq!(word_affinity("const éé = 1", "éé"), 1.0);
        // Multibyte characters either side of the match, and a query that is one character.
        assert_eq!(word_affinity("çé", "é"), 0.0);
        assert!(!looks_like_definition("çé", "é"));
    }

    #[test]
    fn a_whole_identifier_beats_a_buried_substring() {
        assert_eq!(word_affinity("const auth = 1", "auth"), 1.0);
        assert_eq!(word_affinity("call(auth)", "auth"), 1.0);
        // Starts an identifier: still the concept, one derivation away.
        assert_eq!(word_affinity("authenticate(user)", "auth"), 0.5);
        // Buried inside a longer name: `oauthToken` is not what `auth` was asking for.
        assert_eq!(word_affinity("const oauthToken = 1", "auth"), 0.0);
        // The best occurrence on the line wins, whichever order they appear in.
        assert_eq!(word_affinity("oauthToken = auth", "auth"), 1.0);
        assert_eq!(word_affinity("auth = oauthToken", "auth"), 1.0);
        // Case-insensitive, like the search that produced the match.
        assert_eq!(word_affinity("const Auth = 1", "auth"), 1.0);
        assert_eq!(word_affinity("", "auth"), 0.0);
        assert_eq!(word_affinity("anything", ""), 0.0);
    }
    /// Zeroing a weight must actually disable that signal — ablation depends on it.
    #[test]
    fn weights_are_ablatable() {
        let base = LineInput {
            path: "src/a.ts",
            line: "export const thing = 1",
            query: "thing",
            file_matches: 1,
        };
        let full = Weights::default();
        let no_def = Weights {
            definition: 0.0,
            ..Weights::default()
        };
        assert!(score_line(&base, &full) > score_line(&base, &no_def));
    }
}
