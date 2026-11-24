import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("the package only registers its own command", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const lock = JSON.parse(
    await readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(manifest.bin, { "lark-ka": "bin/lark-ka.mjs" });
  assert.deepEqual(lock.packages[""].bin, manifest.bin);
});

test("the HaiNeng release excludes the source-only Base v3 catalog and runtime", async () => {
  const [manifest] = JSON.parse(
    execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
    }),
  );
  const packaged = new Set(manifest.files.map(({ path }) => path));
  assert.ok(packaged.has("data/base-v1.json"));
  assert.ok(packaged.has("data/shortcuts.json"));
  assert.ok(!packaged.has("data/base-v3-shortcuts.json"));
  assert.ok(!packaged.has("src/domains/base-v3.mjs"));
  assert.ok(
    ![...packaged].some((path) =>
      path.startsWith("skills/lark-base/references/"),
    ),
  );

  const load = async (relativePath) =>
    JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
  const sourceOnly = await load("../data/base-v3-shortcuts.json");
  const published = await load("../data/shortcuts.json");
  const publishedBase = new Set(
    published
      .filter(({ service }) => service === "base")
      .map(({ command }) => command),
  );
  assert.equal(publishedBase.size, 18);
  for (const { command } of sourceOnly)
    assert.ok(!publishedBase.has(command), command);
});
