import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const parent = fileURLToPath(new URL("../../../.scratch/video-redo/controls/", import.meta.url));
const owned = [];
async function fixture() {
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "film space-é-"));
  owned.push(root);
  const outputs = [
    "./docs/migration.md:1:validateSession notes",
    "./src/auth/session.test.ts:1:validateSession import",
    "./src/auth/session.test.ts:2:validateSession assertion",
    "./src/auth/session.ts:1:export function validateSession() {}",
    "./src/routes/login.ts:1:validateSession import",
    "./src/routes/login.ts:3:validateSession return",
  ];
  const files = {
    "hay/Cargo.toml": '[package]\nversion = "0.4.0"\n',
    "site/release-status.json": '{"supported_binary":"0.3.2"}',
    "site/landing.css": ':root { --paper: #fff; --ink: #17251c; --muted: #526058; --green: #085d38; --rule: #d5ddd7; --strong-rule: #87978c; }',
    "site/demo/expected-rg.txt": outputs.join("\n") + "\n",
    "site/demo/expected-hay.txt": [3, 4, 1, 0, 5, 2].map(i => outputs[i]).join("\n") + "\n",
    "site/assets/archivo-latin.woff2": "synthetic font bytes",
    "site/assets/OFL.txt": "synthetic license",
    "evidence/docs-track.json": JSON.stringify({meta: {date: "2026-08-28", versions: {hay: "hay 0.3.0"}},
      corpora: ["linux", "openclaw", "ripgrep", "alamofire"].map(corpus => ({corpus,
        queries: Array(30).fill({}), delta: {mrr: {mean: -.2, lo: -.3, hi: -.1}, randomizationP: .01}}))}),
    "evidence/benchmark.json": JSON.stringify({ generatedAt: "2026-08-28T15:40:24Z",
      versions: { hay: "hay 0.3.0" },
      corpora: ["linux", "openclaw", "ripgrep", "alamofire"].map(corpus => ({ corpus, queries: 30,
        tools: [{tool: "hay", mrr: .8, available: true, deterministic: true,
          vsRipgrep: {mean: .2, lo: .1, hi: .3}},
        {tool: "rg", mrr: .6, available: true, deterministic: true}] })) }),
  };
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), {recursive: true});
    await writeFile(join(root, path), bytes);
  }
  await mkdir(join(root, "site/video-src/scripts"), {recursive: true});
  const script = join(root, "site/video-src/scripts/prepare.mjs");
  await writeFile(script, await readFile(new URL("./prepare.mjs", import.meta.url)));
  return {root, script, publicDir: join(root, "site/video-src/public")};
}
const run = f => spawnSync(process.execPath, [f.script], {encoding: "utf8"});
afterEach(async () => { for (const path of owned.splice(0)) await rm(path, {recursive: true, force: true}); });

test("actual entry point emits deterministic public facts and licensed assets", async () => {
  const f = await fixture();
  let result = run(f);
  assert.equal(result.status, 0, result.stderr);
  const first = await readFile(join(f.publicDir, "film-data.json"), "utf8");
  const data = JSON.parse(first);
  assert.equal(data.sourceVersion, "0.4.0");
  assert.equal(data.supportedBinary, "0.3.2");
  assert.equal(data.hay.length, 6);
  assert.equal(data.fileCount, 4);
  assert.equal(data.hay[0].path, "./src/auth/session.ts");
  assert.equal(data.evidence.date, "2026-08-28");
  assert.equal(data.evidence.version, "hay 0.3.0");
  assert.equal(data.evidence.rows[0].hay, .8);
  assert.deepEqual(data.evidence.docs, {wins: 0, regressions: 4});
  assert.equal(data.colors.green, "#085d38");
  await mkdir(join(f.root, "corpus"));
  await writeFile(join(f.root, "corpus/private.json"), "PRIVATE_SENTINEL");
  result = run(f);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(f.publicDir, "film-data.json"), "utf8"), first);
  assert.deepEqual((await readdir(f.publicDir)).sort(), ["OFL.txt", "archivo-latin.woff2", "film-data.json"]);
  assert.equal(first.includes("PRIVATE_SENTINEL"), false);
  assert.equal(await readFile(join(f.publicDir, "archivo-latin.woff2"), "utf8"), "synthetic font bytes");
});

test("different illustrative match sets fail before writing output", async () => {
  const f = await fixture();
  const file = join(f.root, "site/demo/expected-hay.txt");
  const original = await readFile(file, "utf8");
  await writeFile(file, original.replace("validateSession return", "validateSession different return"));
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /match set/i);
  await assert.rejects(readdir(f.publicDir), /ENOENT/);
});

test("undated benchmark input fails rather than inventing current evidence", async () => {
  const f = await fixture();
  const file = join(f.root, "evidence/benchmark.json");
  const data = JSON.parse(await readFile(file, "utf8"));
  delete data.generatedAt;
  await writeFile(file, JSON.stringify(data));
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /date|identity/i);
});

test("malformed documentation corpora cannot silently reduce the regression count", async () => {
  for (const broken of [undefined, "not an array"]) {
    const f = await fixture();
    const file = join(f.root, "evidence/docs-track.json");
    const data = JSON.parse(await readFile(file, "utf8"));
    data.corpora[1].queries = broken;
    await writeFile(file, JSON.stringify(data));
    const result = run(f);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /documentation|corpus/i);
    await assert.rejects(readdir(f.publicDir), /ENOENT/);
  }
});

test("symlinked known input cannot copy unrelated content", async () => {
  const f = await fixture();
  const font = join(f.root, "site/assets/archivo-latin.woff2");
  await rm(font);
  await symlink(join(f.root, "site/release-status.json"), font);
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /regular|symlink|canonical/i);
});
