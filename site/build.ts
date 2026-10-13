import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

type Phase = "preview" | "staging" | "production";
export interface BuildOptions {
  sourceRoot: string;
  outputDir: string;
  phase: Phase;
  tag: string;
  sourceSha?: string;
}
export interface SiteManifest {
  source_commit: string;
  source_version: string;
  phase: Phase;
  tag: string;
  dirty: boolean;
  files: Record<string, string>;
  payload_sha256: string;
}

const publicFiles = [
  "index.html", "site/landing.css", "site/landing.js", "site/manual.css", "site/manual.js", "site/assets/archivo-latin.woff2",
  "site/assets/OFL.txt", "site/assets/SOURCES.md", "site/assets/hay-benchmark.mp4",
  "site/assets/poster.png", "site/assets/favicon.svg", "MANUAL.html", "benchmark.html", "BENCHMARK_FEYNMAN.html",
  "BENCHMARK_FEYNMAN.md",
] as const;
const corpusNames: Record<string, string> = {
  linux: "Linux kernel", openclaw: "openclaw", ripgrep: "ripgrep", alamofire: "Alamofire",
};
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function git(root: string, ...args: string[]): Buffer {
  const result = Bun.spawnSync(["git", "--no-pager", "-C", root, ...args]);
  if (result.exitCode !== 0) throw new Error("Cannot read the source commit's public files");
  return Buffer.from(result.stdout);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid benchmark data");
  return value as Record<string, unknown>;
}
function numeric(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error("Invalid benchmark number");
  return value;
}
function escaped(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function demonstration(rgOutput: string, hayOutput: string) {
  const lines = (output: string) => output.trimEnd().split(/\r?\n/).map((line) => {
    const match = line.match(/^(\.\/[^:]+):(\d+):(.*)$/);
    if (!match || !match[3]!.includes("validateSession")) throw new Error("Invalid illustrative match");
    return { line, path: match[1]!, number: match[2]!, text: match[3]! };
  });
  const rg = lines(rgOutput);
  const hay = lines(hayOutput);
  if (JSON.stringify(rg.map((row) => row.line).sort()) !== JSON.stringify(hay.map((row) => row.line).sort()))
    throw new Error("Illustrative outputs differ in match set");
  const rows = (matches: typeof rg) => matches.map((row) => `<li${/^\s*export function validateSession\b/.test(row.text) ? ' class="is-definition"' : ""}>`
    + `<span class="result-path">${escaped(row.path)}:${row.number}</span>`
    + `<code translate="no">${escaped(row.text).replaceAll("validateSession", "<mark>validateSession</mark>")}</code></li>`).join("\n");
  return { matches: String(rg.length), files: String(new Set(rg.map((row) => row.path)).size), rg: rows(rg), hay: rows(hay) };
}

function benchmark(data: unknown): { rows: string; date: string; version: string } {
  const input = record(data);
  const version = record(input["versions"])["hay"];
  const date = input["generatedAt"];
  if (typeof version !== "string" || !/^hay \d+\.\d+\.\d+$/.test(version)
    || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(date))
    throw new Error("Missing dated benchmark identity");
  if (!Array.isArray(input["corpora"])) throw new Error("Missing public benchmark corpora");
  const corpora = input["corpora"].map(record);
  const rows = Object.entries(corpusNames).map(([name, label]) => {
    const matches = corpora.filter((corpus) => corpus["corpus"] === name);
    if (matches.length !== 1) throw new Error("Missing or duplicated public benchmark corpus");
    const corpus = matches[0]!;
    const n = numeric(corpus["queries"], 2, 1_000_000);
    if (!Number.isInteger(n) || !Array.isArray(corpus["tools"])) throw new Error("Invalid benchmark sample");
    const tools = corpus["tools"].map(record);
    const find = (name: string) => {
      const found = tools.filter((tool) => tool["tool"] === name);
      if (found.length !== 1) throw new Error("Missing benchmark comparison tool");
      return found[0]!;
    };
    const hay = find("hay");
    const rg = find("rg");
    const score = numeric(hay["mrr"], 0, 1).toFixed(3);
    const baseline = numeric(rg["mrr"], 0, 1).toFixed(3);
    const interval = record(hay["vsRipgrep"]);
    const difference = numeric(interval["mean"], -1, 1);
    const lo = numeric(interval["lo"], -1, 1);
    const hi = numeric(interval["hi"], -1, 1);
    if (lo > hi) throw new Error("Invalid benchmark interval");
    return `<tr><th scope="row">${label}<small>${n} queries</small></th>`
      + `<td class="hay-score">${score}</td><td>${baseline}</td>`
      + `<td>${difference >= 0 ? "+" : ""}${difference.toFixed(3)}<small>[${lo.toFixed(3)}, ${hi.toFixed(3)}]</small></td></tr>`;
  }).join("\n");
  return { rows, date: date.slice(0, 10), version: escaped(version) };
}

async function validateOutput(root: string, destination: string): Promise<void> {
  if (destination === root || !destination.startsWith(root + sep))
    throw new Error("Output must be a new directory inside the source repository");
  for (let parent = destination; parent !== root; parent = dirname(parent)) {
    const info = await lstat(parent).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (info?.isSymbolicLink()) throw new Error("Output path must not contain a symlink");
    if (parent === destination && info && (!info.isDirectory() || (await readdir(parent)).length > 0))
      throw new Error("Output directory must be empty; existing data is preserved");
  }
}

export async function buildSite(options: BuildOptions): Promise<SiteManifest> {
  if (!["preview", "staging", "production"].includes(options.phase)) throw new Error("Invalid website phase");
  const root = await realpath(options.sourceRoot);
  const destination = resolve(options.outputDir);
  await validateOutput(root, destination);
  const sourceSha = git(root, "rev-parse", "HEAD").toString().trim();
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || (options.sourceSha && options.sourceSha !== sourceSha))
    throw new Error("Source commit differs from the requested revision");
  const dirty = git(root, "status", "--porcelain", "--untracked-files=normal").toString().trim().length > 0;
  if (dirty && options.phase !== "preview") throw new Error("Dirty source tree cannot produce a release");

  async function source(path: string): Promise<Buffer> {
    const fullPath = join(root, path);
    const info = await lstat(fullPath);
    if (!info.isFile() || await realpath(fullPath) !== fullPath)
      throw new Error(`Public input must be a canonical regular file: ${path}`);
    if (options.phase === "preview") return readFile(fullPath);
    const mode = git(root, "ls-tree", sourceSha, "--", path).toString().split(" ")[0];
    if (mode !== "100644" && mode !== "100755") throw new Error(`Non-regular committed public input: ${path}`);
    return git(root, "show", `${sourceSha}:${path}`);
  }

  const cargo = (await source("hay/Cargo.toml")).toString();
  const version = cargo.match(/^version\s*=\s*"(\d+\.\d+\.\d+)"/m)?.[1];
  if (!version) throw new Error("Missing Cargo source version");
  const stable = `site-v${version}`;
  const beta = new RegExp(`^site-v${version.replaceAll(".", "\\.")}-beta[1-9][0-9]*$`);
  if ((options.phase === "staging" && !beta.test(options.tag))
    || (options.phase === "production" && options.tag !== stable)
    || (options.phase === "preview" && options.tag !== "preview"))
    throw new Error("Website tag does not match phase and source version");

  const payload = new Map<string, Buffer>();
  for (const path of publicFiles) payload.set(path, await source(path));
  const evidence = benchmark(JSON.parse((await source("evidence/benchmark.json")).toString()));
  const demo = demonstration((await source("site/demo/expected-rg.txt")).toString(),
    (await source("site/demo/expected-hay.txt")).toString());
  const releaseStatus = record(JSON.parse((await source("site/release-status.json")).toString()));
  const supportedBinary = releaseStatus["supported_binary"];
  if (typeof supportedBinary !== "string" || !/^\d+\.\d+\.\d+$/.test(supportedBinary))
    throw new Error("Invalid supported binary version");
  const label = options.phase === "staging" ? `Beta preview · ${options.tag}`
    : options.phase === "production" ? `Website · ${options.tag}` : "Local preview";
  const canonical = options.phase === "staging" ? "https://mneves75.github.io/hay/beta/" : "https://mneves75.github.io/hay/";
  const tokens: Record<string, string> = {
    "ROBOTS": `<meta name="robots" content="${options.phase === "production" ? "index, follow" : "noindex, nofollow"}">`,
    "CANONICAL": `<link rel="canonical" href="${canonical}">`,
    "RELEASE_LABEL": label, "SOURCE_SHA": sourceSha, "SOURCE_VERSION": version,
    "HOMEBREW_VERSION": supportedBinary,
    "BENCHMARK_ROWS": evidence.rows, "BENCHMARK_DATE": evidence.date, "BENCHMARK_VERSION": evidence.version,
    "DEMO_MATCHES": demo.matches, "DEMO_FILES": demo.files, "DEMO_RG_ROWS": demo.rg, "DEMO_HAY_ROWS": demo.hay,
  };
  const dependencies = new Map<string, string>();
  for (const path of ["site/landing.css", "site/landing.js", "site/manual.css", "site/manual.js"]) {
    const bytes = payload.get(path)!;
    const fingerprinted = path.replace(/\.(css|js)$/, `.${hash(bytes).slice(0, 12)}.$1`);
    payload.delete(path);
    payload.set(fingerprinted, bytes);
    dependencies.set(path, fingerprinted);
  }
  for (const path of ["index.html", "MANUAL.html"]) {
    let html = payload.get(path)!.toString();
    for (const [token, value] of Object.entries(tokens)) html = html.replaceAll(`{{${token}}}`,
      token === "CANONICAL" && path === "MANUAL.html" ? `<link rel="canonical" href="${canonical}MANUAL.html">` : value);
    for (const [source, fingerprinted] of dependencies) html = html.replaceAll(`"${source}"`, `"${fingerprinted}"`);
    if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error("Unresolved website template token");
    payload.set(path, Buffer.from(html));
  }
  // The generated method keeps its source links; the website pins them to this revision.
  const method = payload.get("BENCHMARK_FEYNMAN.html")!.toString()
    .replaceAll('href="install.sh"', `href="https://github.com/mneves75/hay/blob/${sourceSha}/install.sh"`)
    .replaceAll('href="evidence/docs-track.json"', `href="https://github.com/mneves75/hay/blob/${sourceSha}/evidence/docs-track.json"`);
  payload.set("BENCHMARK_FEYNMAN.html", Buffer.from(method));
  for (const [path, bytes] of payload) {
    if (!path.endsWith(".html")) continue;
    const base = new URL(path, "https://website.invalid/");
    for (const match of bytes.toString().matchAll(/\b(?:href|src)="([^"]+)"/g)) {
      const url = new URL(match[1]!, base);
      if (url.origin !== base.origin) continue;
      const target = decodeURIComponent(url.pathname.slice(1)) + (url.pathname.endsWith("/") ? "index.html" : "");
      if (!payload.has(target)) throw new Error(`Missing public dependency in ${path}: ${target}`);
    }
  }
  const files: Record<string, string> = {};
  for (const [path, bytes] of [...payload].sort(([a], [b]) => a.localeCompare(b, "en"))) files[path] = hash(bytes);
  const manifest: SiteManifest = { source_commit: sourceSha, source_version: version,
    phase: options.phase, tag: options.tag, dirty, files,
    payload_sha256: hash(Object.entries(files).map(([path, digest]) => `${path}\0${digest}\n`).join("")) };
  await mkdir(destination, { recursive: true });
  for (const [path, bytes] of payload) {
    await mkdir(dirname(join(destination, path)), { recursive: true });
    await writeFile(join(destination, path), bytes, { flag: "wx" });
  }
  await writeFile(join(destination, "release.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return manifest;
}

if (import.meta.main) {
  try {
    const args = new Map<string, string>();
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i]!;
      const value = process.argv[i + 1];
      if (!["--out", "--phase", "--tag", "--source"].includes(key) || !value || args.has(key))
        throw new Error("Usage: bun site/build.ts --out DIRECTORY --phase preview|staging|production --tag TAG [--source SHA]");
      args.set(key, value);
    }
    const phase = args.get("--phase");
    if (!args.get("--out") || !args.get("--tag") || !["preview", "staging", "production"].includes(phase ?? ""))
      throw new Error("A new output directory, phase and website tag are required");
    const result = await buildSite({ sourceRoot: fileURLToPath(new URL("../", import.meta.url)),
      outputDir: resolve(args.get("--out")!), phase: phase as Phase, tag: args.get("--tag")!,
      ...(args.get("--source") ? { sourceSha: args.get("--source")! } : {}) });
    console.log(JSON.stringify({ phase: result.phase, tag: result.tag, source: result.source_commit,
      payload_sha256: result.payload_sha256, files: Object.keys(result.files).length }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Website build failed");
    process.exitCode = 1;
  }
}
