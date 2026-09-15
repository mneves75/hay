/** Task-hint derivation shared by the public and private hint experiments. */

/** Task-hint derivation is independently versioned so evidence cannot be mixed across rules. */
export const HDERIVE_VERSION = "hderive-v1";

/** Words that are identifier-shaped but are just English or language noise. */
export const IDENTIFIER_STOP = new Set([
  "the", "and", "for", "with", "this", "that", "from", "not", "are", "was", "when", "where",
  "def", "class", "function", "return", "import", "true", "false", "none", "null", "self",
  "python", "error", "line", "file", "files", "code", "test", "tests", "using", "used", "does",
  "should", "would", "could", "expected", "actual", "result", "results", "issue", "bug",
]);

/**
 * `hderive-v1`: up to eight other identifier-shaped terms from the same task text.
 *
 * Gold files, result lists, clicked files, and trajectories are not arguments, so they cannot
 * leak into the treatment. The primary query is excluded case-insensitively.
 *
 * The token rules deliberately duplicate `deriveQueries` in `swe-explore.ts` instead of sharing a
 * helper: both are frozen, versioned rules, and a shared helper would let a fix to one silently
 * re-derive the other's published inputs.
 */
export function deriveHints(title: string, body: string, primaryQuery: string): string[] {
  const text = `${title}\n${body ?? ""}`;
  const out: string[] = [];
  const excluded = primaryQuery.toLowerCase();
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = raw.trim();
    const k = t.toLowerCase();
    if (
      t.length < 3 || t.length > 40 || k === excluded || seen.has(k) || IDENTIFIER_STOP.has(k) ||
      !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(t)
    ) return;
    seen.add(k);
    out.push(t);
  };
  const tokenStream = /`([^`\n]{1,80})`|\b([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+|[a-z0-9]+_[a-z0-9_]+|[a-z]+[A-Z][A-Za-z0-9]*)\b/g;
  for (const match of text.matchAll(tokenStream)) {
    if (match[1] !== undefined) {
      for (const token of match[1].split(/[^A-Za-z0-9_.]+/)) {
        const bare = token.replace(/^\.+|\.+$/g, "");
        if (/[A-Z]/.test(bare) || bare.includes("_") || bare.includes(".")) push(bare);
        else if (/^[a-z][a-z0-9]{2,}$/.test(bare) && bare.length >= 6) push(bare);
        if (out.length >= 8) return out;
      }
    } else {
      push(match[2]!);
      if (out.length >= 8) return out;
    }
  }
  return out;
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  if (argv.length !== 1 || argv[0] !== "--selftest") {
    console.error("usage: bun hint-derive.ts --selftest");
    process.exit(2);
  }

  const eq = (actual: unknown, expected: unknown, message: string) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
    }
  };

  eq(
    deriveHints(
      "Fix primaryQuery using user_profile and authClient",
      "`cache.lookup` calls retryHandler",
      "PRIMARYQUERY",
    ),
    ["user_profile", "authClient", "cache.lookup", "retryHandler"],
    "task order is stable and the primary query is excluded case-insensitively",
  );
  eq(
    deriveHints("`FOOBAR` fooBar fooBar", "", "otherQuery"),
    ["FOOBAR"],
    "duplicates are removed case-insensitively",
  );
  eq(
    deriveHints("`function` `false` `path/to/file`", "", "otherQuery"),
    [],
    "language noise and non-identifier fragments are rejected",
  );
  const capped = deriveHints(
    "oneA twoB threeC fourD fiveE sixF sevenG eightH nineI",
    "",
    "primaryQuery",
  );
  eq(capped.length, 8, "hint count is capped");
  eq(capped.at(-1), "eightH", "the cap preserves first-occurrence order");

  console.log("selftest ok");
}
