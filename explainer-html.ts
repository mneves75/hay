#!/usr/bin/env bun
/**
 * explainer-html — render a long-form Markdown explainer as a standalone reading page.
 *
 * `benchmark-report.ts` renders a data table; this renders an essay, which is a different design
 * problem: measure, rhythm and hierarchy matter more than density. Generated rather than
 * hand-authored so the page cannot drift from the Markdown it explains.
 *
 * It supports exactly the Markdown this repository's explainers use — headings, paragraphs,
 * tables, fenced code, blockquotes, ordered and unordered lists, rules, and inline emphasis, code
 * and links. Anything else is left as text rather than half-rendered, because a renderer that
 * silently mangles a construct is worse than one that admits it does not handle it.
 *
 * Usage: bun explainer-html.ts --in BENCHMARK_FEYNMAN.md --out BENCHMARK_FEYNMAN.html
 *        bun explainer-html.ts --selftest
 */

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Only ordinary web URLs and local document links become clickable. */
export function safeHref(href: string): boolean {
  if (/^https?:\/\//i.test(href) || href.startsWith("#") || /^\.{1,2}\//.test(href)) return true;
  return !href.startsWith("//") && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href);
}

/**
 * Inline formatting for one already-escaped run of text.
 *
 * Code spans are extracted first and put back last: their contents must never be treated as
 * emphasis, or `**` inside a code span silently becomes bold and the reader is shown something the
 * source does not say.
 */
export function inline(text: string): string {
  const spans: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, code) => {
    spans.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${spans.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  s = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, label, href) => safeHref(href) ? `<a href="${href}">${label}</a>` : label,
  );
  // Non-greedy and permissive about its contents, so bold may CONTAIN italics. The stricter
  // `[^*]+` form silently left `**bold with *italic* inside**` as literal asterisks on the page.
  s = s.replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => spans[Number(i)]!);
}

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "code"; lines: string[] }
  | { kind: "table"; rows: string[][]; align: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "hr" };

/** Group lines into blocks. A paragraph ends at a blank line or at the start of another block. */
export function parse(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", text: para.join(" ") });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;

    if (l.startsWith("```")) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) body.push(lines[i]!);
      out.push({ kind: "code", lines: body });
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flush();
      out.push({ kind: "h", level: h[1]!.length, text: h[2]! });
      continue;
    }
    if (/^---+\s*$/.test(l)) {
      flush();
      out.push({ kind: "hr" });
      continue;
    }
    if (l.startsWith(">")) {
      flush();
      const body: string[] = [];
      for (; i < lines.length && lines[i]!.startsWith(">"); i++) body.push(lines[i]!.replace(/^>\s?/, ""));
      i--;
      out.push({ kind: "quote", lines: body });
      continue;
    }
    if (l.startsWith("|")) {
      flush();
      const raw: string[] = [];
      for (; i < lines.length && lines[i]!.startsWith("|"); i++) raw.push(lines[i]!);
      i--;
      const cells = (r: string) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      // Row two of a Markdown table is the alignment row, not data.
      const align = raw[1] && /^\|[\s:|-]+\|?$/.test(raw[1])
        ? cells(raw[1]).map((c) => (c.endsWith(":") ? (c.startsWith(":") ? "center" : "right") : "left"))
        : [];
      out.push({ kind: "table", rows: raw.filter((_, n) => n !== 1 || !align.length).map(cells), align });
      continue;
    }
    const li = l.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]!);
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const m = lines[i]!.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m) items.push(m[3]!);
        // An indented continuation line belongs to the item above it.
        else if (/^\s{2,}\S/.test(lines[i]!) && items.length) items[items.length - 1] += " " + lines[i]!.trim();
        else break;
      }
      i--;
      out.push({ kind: "list", ordered, items });
      continue;
    }
    if (!l.trim()) {
      flush();
      continue;
    }
    para.push(l.trim());
  }
  flush();
  return out;
}

/** A leading `N.` on a heading is the document's own numbering; pull it out so it can be styled. */
export function splitNumber(text: string): { n: string | null; rest: string } {
  const m = text.match(/^(\d+)\.\s+(.*)$/);
  return m ? { n: m[1]!, rest: m[2]! } : { n: null, rest: text };
}

export function render(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case "h": {
        const { n, rest } = splitNumber(b.text);
        const tag = `h${Math.min(b.level, 4)}`;
        const id = rest.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        out.push(
          `<${tag} id="${id}">${n ? `<span class="secnum">${n}</span>` : ""}${inline(rest)}</${tag}>`,
        );
        break;
      }
      case "p":
        out.push(`<p>${inline(b.text)}</p>`);
        break;
      case "quote":
        out.push(`<blockquote>${parse(b.lines.join("\n")).length ? render(parse(b.lines.join("\n"))) : ""}</blockquote>`);
        break;
      case "code":
        out.push(`<pre tabindex="0"><code>${escapeHtml(b.lines.join("\n"))}</code></pre>`);
        break;
      case "hr":
        out.push(`<hr>`);
        break;
      case "list": {
        const tag = b.ordered ? "ol" : "ul";
        out.push(`<${tag}>${b.items.map((it) => `<li>${inline(it)}</li>`).join("")}</${tag}>`);
        break;
      }
      case "table": {
        const [head, ...body] = b.rows;
        const at = (i: number) => (b.align[i] && b.align[i] !== "left" ? ` class="${b.align[i]}"` : "");
        out.push(
          `<div class="scroll" tabindex="0"><table><thead><tr>${(head ?? []).map((c, i) => `<th scope="col"${at(i)}>${inline(c)}</th>`).join("")}</tr></thead>` +
            `<tbody>${body.map((r) => `<tr>${r.map((c, i) => `<td${at(i)}>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
        );
        break;
      }
    }
  }
  return out.join("\n");
}

/**
 * The page.
 *
 * A sibling of `benchmark.html` and deliberately not a copy of it: that page is a dense table you
 * scan, this one is an essay you read, so the serif carries the body instead of the headings and
 * the measure is set for prose. Same palette, because they are two halves of one document.
 */
export function page(title: string, lede: string, body: string): string {
  const canonical = "https://mneves75.github.io/hay/BENCHMARK_FEYNMAN.html";
  // A complete document, not a fragment: this page is opened from disk as often as it is hosted,
  // and a bare fragment leaves the browser to invent <html>, <head> and the language. `lang` in
  // particular is what a screen reader uses to choose a voice.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${escapeHtml(lede)}">
<meta name="color-scheme" content="light dark">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(lede)}">
<meta property="og:url" content="${canonical}">
<style>
:root{
  --ground:#f6f8f8; --panel:#ffffff; --ink:#161e20; --ink-soft:#46565a; --ink-faint:#5e6b6e;
  --rule:#dfe6e6; --rule-strong:#c3cfd0;
  --accent:#0f6a63; --accent-soft:#dcedeb; --accent-ink:#0a4a45;
  --quote:#8a6410;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ground:#0e1416; --panel:#151d20; --ink:#e8efef; --ink-soft:#a8b8ba; --ink-faint:#7d8e90;
    --rule:#243033; --rule-strong:#35464a;
    --accent:#6cc6bb; --accent-soft:#16302d; --accent-ink:#a4dfd6;
    --quote:#d9ad55;
  }
}
:root[data-theme="dark"]{
  --ground:#0e1416; --panel:#151d20; --ink:#e8efef; --ink-soft:#a8b8ba; --ink-faint:#7d8e90;
  --rule:#243033; --rule-strong:#35464a;
  --accent:#6cc6bb; --accent-soft:#16302d; --accent-ink:#a4dfd6;
  --quote:#d9ad55;
}
*{box-sizing:border-box}
body{
  margin:0;background:var(--ground);color:var(--ink);
  font-family:"IBM Plex Serif",Georgia,"Times New Roman",serif;
  font-size:17.5px;line-height:1.72;
}
.wrap{max-width:42rem;margin:0 auto;padding:3.5rem 1.3rem 6rem}
header{margin-bottom:2.5rem}
.eyebrow{
  font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:.7rem;letter-spacing:.15em;
  text-transform:uppercase;color:var(--accent);margin:0 0 .7rem;font-weight:600
}
h1{
  font-family:"IBM Plex Sans",system-ui,sans-serif;font-weight:600;
  font-size:clamp(2rem,5.5vw,2.8rem);line-height:1.12;margin:0 0 1.1rem;
  letter-spacing:-.02em;text-wrap:balance
}
h2,h3,h4{font-family:"IBM Plex Sans",system-ui,sans-serif;text-wrap:balance;letter-spacing:-.01em}
h2{font-size:1.42rem;font-weight:600;margin:3.2rem 0 .9rem;line-height:1.25}
h3{font-size:1.06rem;font-weight:600;margin:2.2rem 0 .6rem;color:var(--ink-soft)}
h4{font-size:.95rem;font-weight:600;margin:1.6rem 0 .5rem}
/* The document really is a sequence, 1 through 11, so the numbers carry information. */
.secnum{
  font-family:"IBM Plex Mono",monospace;font-size:.72em;color:var(--accent);
  margin-right:.6rem;font-weight:500;font-variant-numeric:tabular-nums
}
p{margin:0 0 1.15rem}
.lede{font-size:1.1rem;color:var(--ink-soft);font-style:italic;border-left:2px solid var(--rule-strong);padding-left:1.1rem}
strong{font-weight:600}
a{color:var(--accent-ink);text-decoration-thickness:1px;text-underline-offset:2px}
:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:2px}
code{
  font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.86em;
  background:var(--accent-soft);padding:.08em .32em;border-radius:3px
}
pre{
  background:var(--panel);border:1px solid var(--rule);border-radius:4px;padding:1rem 1.1rem;
  overflow-x:auto;margin:0 0 1.3rem
}
pre code{background:none;padding:0;font-size:.82rem;line-height:1.6}
blockquote{
  margin:0 0 1.3rem;padding:.9rem 1.2rem;background:var(--panel);
  border-left:3px solid var(--quote);border-radius:0 3px 3px 0
}
blockquote p{margin:0 0 .6rem;font-size:1rem}
blockquote p:last-child{margin:0}
hr{border:0;border-top:1px solid var(--rule);margin:2.6rem 0}
ul,ol{margin:0 0 1.3rem;padding-left:1.3rem}
li{margin-bottom:.55rem}
li::marker{color:var(--ink-faint)}
.scroll{overflow-x:auto;margin:0 0 1.4rem;-webkit-overflow-scrolling:touch}
table{
  border-collapse:collapse;width:100%;font-family:"IBM Plex Sans",system-ui,sans-serif;
  font-size:.85rem;font-variant-numeric:tabular-nums
}
th,td{text-align:left;padding:.5rem .7rem;border-bottom:1px solid var(--rule)}
th{
  font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-faint);
  font-weight:600;border-bottom:1px solid var(--rule-strong);white-space:nowrap
}
td.right,th.right{text-align:right}
td.center,th.center{text-align:center}
footer{margin-top:4rem;padding-top:1.3rem;border-top:1px solid var(--rule);color:var(--ink-faint);
  font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:.8rem}
@media (max-width:640px){ body{font-size:16.5px} .wrap{padding:2.2rem 1.1rem 3.5rem} }
</style>
</head>
<body>
<main class="wrap">
<header>
  <p class="eyebrow">hay · explainer</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="lede">${inline(lede)}</p>
</header>
${body}
<footer>Generated from <code>BENCHMARK_FEYNMAN.md</code> by <code>explainer-html.ts</code>. Code-track figures come from <code>evidence/benchmark.json</code>; documentation-track figures come from <code>evidence/docs-track.json</code>.</footer>
</main>
</body>
</html>
`;
}

if (import.meta.main) {
  const argv = Bun.argv.slice(2);
  const flag = (n: string, f: string) => {
    const i = argv.indexOf(n);
    if (i === -1) return f;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${n} needs a value`);
    return v;
  };

  if (argv.includes("--selftest")) {
    const eq = (a: unknown, b: unknown, m: string) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
    };
    eq(inline("plain"), "plain", "plain text");
    eq(inline("**bold**"), "<strong>bold</strong>", "bold");
    eq(inline("*it*"), "<em>it</em>", "italic");
    eq(inline("a `x` b"), "a <code>x</code> b", "code span");
    // The trap: emphasis markers INSIDE a code span must survive as literal text.
    eq(inline("`a**b`"), "<code>a**b</code>", "no emphasis inside code");
    eq(inline("`<div>`"), "<code>&lt;div&gt;</code>", "code contents are escaped");
    // Bold containing italic: the document uses this and the first renderer printed the
    // asterisks literally, which is the failure mode a renderer must never have.
    eq(inline("**a *b* c**"), "<strong>a <em>b</em> c</strong>", "italic nested in bold");
    eq(inline("**one** and **two**"), "<strong>one</strong> and <strong>two</strong>", "two bold runs");
    eq(inline("5 < 6 & 7"), "5 &lt; 6 &amp; 7", "text is escaped");
    eq(inline("[t](u)"), '<a href="u">t</a>', "link");
    eq(inline("[unsafe](javascript:evil)"), "unsafe", "unsafe URL scheme is not clickable");
    eq(splitNumber("3. Title"), { n: "3", rest: "Title" }, "numbered heading");
    eq(splitNumber("Title"), { n: null, rest: "Title" }, "unnumbered heading");
    // Blocks
    eq(parse("# T").length, 1, "one heading");
    eq(parse("a\nb\n\nc").filter((b) => b.kind === "p").length, 2, "blank line splits paragraphs");
    eq((parse("a\nb")[0] as { text: string }).text, "a b", "wrapped lines join into one paragraph");
    eq(parse("```\nx\n```")[0], { kind: "code", lines: ["x"] }, "fenced code");
    eq(parse("---")[0], { kind: "hr" }, "rule");
    const tbl = parse("| a | b |\n|---|---:|\n| 1 | 2 |")[0] as { rows: string[][]; align: string[] };
    eq(tbl.rows, [["a", "b"], ["1", "2"]], "alignment row is not data");
    eq(tbl.align, ["left", "right"], "column alignment");
    eq((parse("- one\n- two")[0] as { items: string[] }).items, ["one", "two"], "unordered list");
    eq((parse("1. one\n2. two")[0] as { ordered: boolean }).ordered, true, "ordered list");
    eq((parse("> quoted")[0] as { lines: string[] }).lines, ["quoted"], "blockquote");
    const focusable = render(parse("```\nx\n```\n\n| a |\n|---|\n| b |"));
    if (!focusable.includes('<pre tabindex="0">') ||
        !focusable.includes('<div class="scroll" tabindex="0">'))
      throw new Error("horizontal overflow regions must be keyboard-focusable");
    // A code fence must not be re-parsed as anything else, whatever it contains.
    eq(parse("```\n| not | a | table |\n# not a heading\n```").length, 1, "fence swallows its contents");
    const document = page("Explainer title", "Evidence-led description", "<p>body</p>");
    if (!document.includes('rel="canonical"') || !document.includes('property="og:description"'))
      throw new Error("explainer metadata is incomplete");
    console.log("selftest ok");
    process.exit(0);
  }

  const inPath = flag("--in", "BENCHMARK_FEYNMAN.md");
  const md = await Bun.file(inPath).text();
  const blocks = parse(md);

  // Title and lede come from the document itself: the H1 and the italic standfirst under it.
  const h1 = blocks.find((b) => b.kind === "h" && b.level === 1) as { text: string } | undefined;
  const first = blocks.find((b) => b.kind === "p") as { text: string } | undefined;
  const lede = (first?.text ?? "").replace(/^\*|\*$/g, "");
  const rest = blocks.filter((b) => b !== h1 && b !== first);

  const out = flag("--out", "BENCHMARK_FEYNMAN.html");
  await Bun.write(out, page(h1?.text ?? inPath, lede, render(rest)));
  console.error(`wrote ${out}`);
}
