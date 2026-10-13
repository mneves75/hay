import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
async function input(path) {
  const absolute = join(root, path);
  if (!(await lstat(absolute)).isFile() || await realpath(absolute) !== absolute)
    throw new Error("Public input must be a canonical regular file: " + path);
  return readFile(absolute);
}
function matches(bytes) {
  return bytes.toString().trimEnd().split(/\r?\n/).map(line => {
    const match = line.match(/^(\.\/[^:]+):([1-9]\d*):(.*)$/);
    if (!match || !match[3].includes("validateSession")) throw new Error("Invalid illustrative match");
    return {path: match[1], number: Number(match[2]), text: match[3]};
  });
}
function number(value, min, max) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    throw new Error("Invalid public benchmark value");
  return value;
}
function evidence(bytes) {
  const data = JSON.parse(bytes);
  if (typeof data.generatedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(data.generatedAt)
    || !Number.isFinite(Date.parse(data.generatedAt)) || !/^hay \d+\.\d+\.\d+$/.test(data.versions?.hay))
    throw new Error("Missing dated benchmark identity");
  const names = {linux: "Linux kernel", openclaw: "openclaw", ripgrep: "ripgrep", alamofire: "Alamofire"};
  const rows = Object.entries(names).map(([name, label]) => {
    const found = data.corpora?.filter(corpus => corpus.corpus === name);
    if (found?.length !== 1) throw new Error("Missing or duplicate public corpus");
    const corpus = found[0];
    const queries = number(corpus.queries, 2, 1_000_000);
    if (!Number.isInteger(queries)) throw new Error("Invalid public sample count");
    const tool = name => {
      const found = corpus.tools?.filter(row => row.tool === name);
      if (found?.length !== 1 || !found[0].available || !found[0].deterministic)
        throw new Error("Missing deterministic comparison tool");
      return found[0];
    };
    const hay = tool("hay");
    const rg = tool("rg");
    const delta = number(hay.vsRipgrep?.mean, -1, 1);
    const lo = number(hay.vsRipgrep?.lo, -1, 1);
    const hi = number(hay.vsRipgrep?.hi, -1, 1);
    if (lo > delta || delta > hi) throw new Error("Invalid public confidence interval");
    return {label, queries, hay: number(hay.mrr, 0, 1), rg: number(rg.mrr, 0, 1), delta, lo, hi};
  });
  return {date: data.generatedAt.slice(0, 10), version: data.versions.hay, rows};
}

function docsResult(bytes, benchmark) {
  const data = JSON.parse(bytes);
  if (data.meta?.date !== benchmark.date || data.meta?.versions?.hay !== benchmark.version)
    throw new Error("Historical tracks have different identities");
  if (!Array.isArray(data.corpora) || data.corpora.some(row => !Array.isArray(row?.queries)))
    throw new Error("Malformed documentation corpus");
  const corpora = data.corpora.filter(row => row.queries.length >= 10);
  if (!corpora.length) throw new Error("Missing documentation comparison");
  let wins = 0;
  let regressions = 0;
  for (const corpus of corpora) {
    const mean = number(corpus.delta?.mrr?.mean, -1, 1);
    const lo = number(corpus.delta?.mrr?.lo, -1, 1);
    const hi = number(corpus.delta?.mrr?.hi, -1, 1);
    const p = number(corpus.delta?.randomizationP, 0, 1);
    if (lo > mean || mean > hi) throw new Error("Invalid documentation interval");
    if ((lo > 0 || hi < 0) && p < .05) {
      if (mean > 0) wins++;
      if (mean < 0) regressions++;
    }
  }
  return {wins, regressions};
}

try {
  const paths = ["hay/Cargo.toml", "site/release-status.json", "site/landing.css",
    "site/demo/expected-rg.txt", "site/demo/expected-hay.txt", "evidence/benchmark.json", "evidence/docs-track.json",
    "site/assets/archivo-latin.woff2", "site/assets/OFL.txt"];
  const sources = Object.fromEntries(await Promise.all(paths.map(async path => [path, await input(path)])));
  const sourceVersion = sources["hay/Cargo.toml"].toString().match(/^version\s*=\s*"(\d+\.\d+\.\d+)"/m)?.[1];
  const supportedBinary = JSON.parse(sources["site/release-status.json"]).supported_binary;
  if (!sourceVersion || !/^\d+\.\d+\.\d+$/.test(supportedBinary)) throw new Error("Missing release identity");
  const rg = matches(sources["site/demo/expected-rg.txt"]);
  const hay = matches(sources["site/demo/expected-hay.txt"]);
  if (rg.length !== 6 || hay.length !== 6) throw new Error("Film requires six matches");
  const serialize = rows => rows.map(row => `${row.path}:${row.number}:${row.text}`).sort();
  if (JSON.stringify(serialize(rg)) !== JSON.stringify(serialize(hay))) throw new Error("Different illustrative match sets");
  const fileCount = new Set(hay.map(row => row.path)).size;
  if (fileCount !== 4 || new Set(hay.slice(0, 4).map(row => row.path)).size !== 4)
    throw new Error("Film requires four interleaved files");
  const declaration = rows => rows.findIndex(row => /^export function validateSession\b/.test(row.text));
  if (declaration(rg) !== 3 || declaration(hay) !== 0) throw new Error("Illustrative declaration order changed");
  const css = sources["site/landing.css"].toString();
  const colors = Object.fromEntries(["paper", "ink", "muted", "green", "rule", "strong-rule"].map(name => {
    const value = css.match(new RegExp(String.raw`--${name}:\s*(#[0-9a-fA-F]{3,8})\s*;`))?.[1];
    if (!value) throw new Error("Missing palette role: " + name);
    return [name, value];
  }));
  const benchmark = evidence(sources["evidence/benchmark.json"]);
  const data = {sourceVersion, supportedBinary, query: "validateSession", rg, hay, fileCount,
    colors, evidence: {...benchmark, docs: docsResult(sources["evidence/docs-track.json"], benchmark)}};
  const directory = join(root, "site/video-src/public");
  const existing = await lstat(directory).catch(error => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (existing && (!existing.isDirectory() || await realpath(directory) !== directory))
    throw new Error("Generated public directory must not be a symlink");
  await mkdir(directory, {recursive: true});
  const outputs = {"film-data.json": JSON.stringify(data, null, 2) + "\n",
    "archivo-latin.woff2": sources["site/assets/archivo-latin.woff2"], "OFL.txt": sources["site/assets/OFL.txt"]};
  for (const [name, bytes] of Object.entries(outputs)) {
    const destination = join(directory, name);
    const info = await lstat(destination).catch(error => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (info && !info.isFile()) throw new Error("Generated asset must be a regular file: " + name);
    await writeFile(destination, bytes);
  }
  console.log("Prepared film: six exact matches, four files, dated evidence, local licensed font");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Film preparation failed");
  process.exitCode = 1;
}
