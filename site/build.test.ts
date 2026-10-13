import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite } from "./build.ts";

const fixtureParent = fileURLToPath(new URL("../.scratch/landing-release/unit-fixtures/", import.meta.url));
const owned: string[] = [];

function git(root: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", root, ...args], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

async function fixture() {
  await mkdir(fixtureParent, { recursive: true });
  const root = await mkdtemp(join(fixtureParent, "public-"));
  owned.push(root);
  const files: Record<string, string> = {
    ".gitignore": "corpus/\noutput*/\n",
    "hay/Cargo.toml": '[package]\nname = "hay"\nversion = "0.4.0"\n',
    "index.html": '<!doctype html><html><head>{{ROBOTS}}{{CANONICAL}}<link rel="stylesheet" href="site/landing.css"><script defer src="site/landing.js"></script></head><body>{{RELEASE_LABEL}} {{SOURCE_SHA}} {{SOURCE_VERSION}} {{BENCHMARK_ROWS}} {{BENCHMARK_DATE}} {{BENCHMARK_VERSION}} {{DEMO_MATCHES}} {{DEMO_FILES}} <ol>{{DEMO_RG_ROWS}}</ol><ol>{{DEMO_HAY_ROWS}}</ol></body></html>',
    "site/landing.css": ":root { color: #151b17; }\n",
    "site/landing.js": '"use strict";\n',
    "site/assets/archivo-latin.woff2": "synthetic font fixture",
    "site/assets/OFL.txt": "synthetic license fixture",
    "site/assets/SOURCES.md": "synthetic source fixture",
    "site/assets/hay-benchmark.mp4": "synthetic video fixture",
    "site/assets/poster.png": "synthetic poster fixture",
    "site/assets/favicon.svg": "<svg></svg>",
    "site/demo/expected-rg.txt": './docs/notes.md:1:validateSession & notes\n./src/auth.ts:2:export function validateSession() {}\n',
    "site/demo/expected-hay.txt": './src/auth.ts:2:export function validateSession() {}\n./docs/notes.md:1:validateSession & notes\n',
    "site/release-status.json": '{"supported_binary":"0.3.2"}',
    "MANUAL.html": "<h1>Frozen manual</h1>",
    "benchmark.html": "<h1>Full report</h1>",
    "BENCHMARK_FEYNMAN.html": "<h1>Method</h1>",
    "BENCHMARK_FEYNMAN.md": "# Method\n",
    "evidence/benchmark.json": JSON.stringify({
      generatedAt: "2026-08-28T15:40:24.464Z", versions: { hay: "hay 0.3.0" },
      corpora: ["linux", "openclaw", "ripgrep", "alamofire"].map((corpus) => ({
        corpus, queries: 30,
        tools: [
          { tool: "hay", mrr: 0.8, vsRipgrep: { mean: 0.2, lo: 0.1, hi: 0.3 } },
          { tool: "rg", mrr: 0.6 },
        ],
      })),
    }),
  };
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), contents);
  }
  git(root, "init", "--quiet");
  git(root, "add", "--", ...Object.keys(files));
  git(root, "-c", "user.name=Website fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "core.hooksPath=/dev/null", "commit", "--quiet", "-m", "fixture");
  await mkdir(join(root, "corpus"));
  await writeFile(join(root, "corpus/private-canary.json"), "EXCLUDED_PRIVATE_SENTINEL");
  return { root, sha: git(root, "rev-parse", "HEAD") };
}

afterEach(async () => {
  for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("public website packaging", () => {
  test("builds a deterministic allowlisted beta with pinned identity and content hashes", async () => {
    const { root, sha } = await fixture();
    const build = (directory: string) => buildSite({ sourceRoot: root, outputDir: join(root, directory),
      phase: "staging", tag: "site-v0.4.0-beta1", sourceSha: sha });
    const first = await build("output1");
    const second = await build("output2");
    expect(first).toEqual(second);
    expect(first.source_commit).toBe(sha);
    expect(first.tag).toBe("site-v0.4.0-beta1");
    expect(first.phase).toBe("staging");
    expect(first.dirty).toBe(false);
    const html = await readFile(join(root, "output1/index.html"), "utf8");
    expect(html).toContain("Beta preview");
    expect(html).toContain(sha);
    expect(html).toContain("noindex");
    expect(html).toContain("2026-08-28");
    expect(html).toContain("hay 0.3.0");
    expect(html).toContain("0.800");
    expect(html).toContain("0.600");
    expect(html).toContain("&amp; notes");
    expect(html).toContain('<mark>validateSession</mark>');
    expect(html).not.toContain("{{");
    expect(html).not.toContain("EXCLUDED_PRIVATE_SENTINEL");
    expect(Object.keys(first.files).some((path) => path.includes("corpus"))).toBe(false);
    expect(Object.keys(first.files).some((path) => path.includes(".git"))).toBe(false);
    expect(Object.keys(first.files)).not.toContain("release.json");
    expect(Object.keys(first.files)).not.toContain("hay/Cargo.toml");
    expect(Object.keys(first.files)).not.toContain("evidence/benchmark.json");
    for (const [path, digest] of Object.entries(first.files)) {
      const payload = await readFile(join(root, "output1", path));
      const hash = await crypto.subtle.digest("SHA-256", payload);
      expect(Buffer.from(hash).toString("hex")).toBe(digest);
      expect(await readFile(join(root, "output2", path))).toEqual(payload);
    }
    expect(await readFile(join(root, "output1/release.json"), "utf8"))
      .toBe(await readFile(join(root, "output2/release.json"), "utf8"));
  });

  test("staging and production keep identical CSS, JS, media and frozen documentation", async () => {
    const { root, sha } = await fixture();
    const beta = await buildSite({ sourceRoot: root, outputDir: join(root, "output-beta"),
      phase: "staging", tag: "site-v0.4.0-beta1", sourceSha: sha });
    const production = await buildSite({ sourceRoot: root, outputDir: join(root, "output-prod"),
      phase: "production", tag: "site-v0.4.0", sourceSha: sha });
    for (const path of Object.keys(beta.files).filter((path) => path !== "index.html")) {
      expect(production.files[path]).toBe(beta.files[path]);
    }
    const before = await readFile(join(root, "output-beta/index.html"), "utf8");
    const after = await readFile(join(root, "output-prod/index.html"), "utf8");
    expect(before.replace('name="robots" content="noindex, nofollow"', 'name="robots" content="index, follow"')
      .replace("https://mneves75.github.io/hay/beta/", "https://mneves75.github.io/hay/")
      .replaceAll("Beta preview · site-v0.4.0-beta1", "Website · site-v0.4.0"))
      .toBe(after);
  });

  test("refuses a nonempty destination without changing its existing data", async () => {
    const { root, sha } = await fixture();
    await mkdir(join(root, "output-existing"));
    await writeFile(join(root, "output-existing/keep.txt"), "OWNER_DATA");
    await expect(buildSite({ sourceRoot: root, outputDir: join(root, "output-existing"),
      phase: "staging", tag: "site-v0.4.0-beta1", sourceSha: sha })).rejects.toThrow(/empty|exist/);
    expect(await readFile(join(root, "output-existing/keep.txt"), "utf8")).toBe("OWNER_DATA");
    expect(await readdir(join(root, "output-existing"))).toEqual(["keep.txt"]);
  });

  test("refuses illustrative outputs with different match sets", async () => {
    const { root } = await fixture();
    await writeFile(join(root, "site/demo/expected-hay.txt"), './src/auth.ts:2:validateSession\n');
    await expect(buildSite({ sourceRoot: root, outputDir: join(root, "output-demo"),
      phase: "preview", tag: "preview" })).rejects.toThrow(/match set/);
  });

  test("refuses a missing local document dependency before writing output", async () => {
    const { root } = await fixture();
    await writeFile(join(root, "MANUAL.html"), '<a href="unpublished.html">Missing</a>');
    await expect(buildSite({ sourceRoot: root, outputDir: join(root, "output-missing"),
      phase: "preview", tag: "preview" })).rejects.toThrow(/dependency.*unpublished/);
  });

  test("refuses dirty release inputs but labels an explicit local preview", async () => {
    const { root, sha } = await fixture();
    const original = await readFile(join(root, "index.html"), "utf8");
    await writeFile(join(root, "index.html"), `${original}\n<!-- uncommitted preview -->`);
    await expect(buildSite({ sourceRoot: root, outputDir: join(root, "output-dirty"),
      phase: "staging", tag: "site-v0.4.0-beta1", sourceSha: sha })).rejects.toThrow(/dirty/i);
    const preview = await buildSite({ sourceRoot: root, outputDir: join(root, "output-preview"),
      phase: "preview", tag: "preview", sourceSha: sha });
    expect(preview.dirty).toBe(true);
    expect(preview.phase).toBe("preview");
    expect(await readFile(join(root, "output-preview/index.html"), "utf8")).toContain("Local preview");
  });

  test("rejects symlinked public input instead of copying its target", async () => {
    const { root, sha } = await fixture();
    await rm(join(root, "site/assets/poster.png"));
    await symlink(join(root, "corpus/private-canary.json"), join(root, "site/assets/poster.png"));
    await expect(buildSite({ sourceRoot: root, outputDir: join(root, "output-link"),
      phase: "preview", tag: "preview", sourceSha: sha })).rejects.toThrow(/symlink|regular|canonical/);
  });

  test.each([
    ["staging", "site-v0.4.0"], ["production", "site-v0.4.0-beta1"],
    ["staging", "site-v0.4.0-beta0"], ["production", "site-v0.5.0"],
    ["production", "<script>"],
  ] as const)("rejects inconsistent phase/version %s %s", async (phase, tag) => {
    const { root, sha } = await fixture();
    await expect(buildSite({ sourceRoot: root, outputDir: join(root, "output-bad"),
      phase, tag, sourceSha: sha })).rejects.toThrow(/tag|version|beta/);
  });

  test("rejects a source identity that is not the checkout's commit", async () => {
    const { root } = await fixture();
    await expect(buildSite({ sourceRoot: root, outputDir: join(root, "output-sha"),
      phase: "staging", tag: "site-v0.4.0-beta1", sourceSha: "0".repeat(40) })).rejects.toThrow(/commit|revision/);
  });

  test("the CLI builds from a checkout path containing spaces and non-ASCII text", async () => {
    const { root } = await fixture();
    // The CLI resolves its own repository, so give the fixture root a spaced path via rename.
    const moved = `${root} space-é`;
    await rename(root, moved);
    owned[owned.indexOf(root)] = moved;
    const script = join(moved, "site/build.ts");
    await writeFile(script, await readFile(new URL("./build.ts", import.meta.url)));
    const result = Bun.spawnSync([process.execPath, script, "--out", join(moved, "output-cli"), "--phase", "preview", "--tag", "preview"]);
    expect(result.exitCode).toBe(0);
    expect(await readFile(join(moved, "output-cli/index.html"), "utf8")).toContain("Local preview");
  });
});
