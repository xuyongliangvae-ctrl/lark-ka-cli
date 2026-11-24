import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { VERSION } from "../src/version.mjs";

const entry = fileURLToPath(new URL("../bin/lark-ka.mjs", import.meta.url));
const run = (...args) =>
  spawnSync(process.execPath, [entry, ...args], { encoding: "utf8" });

test("the connector version check accepts the exact installed version", () => {
  const result = run("--version", "--expect-version", VERSION);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, new RegExp(VERSION.replaceAll(".", "\\.")));
});

test("the connector version check rejects a stale installed version", () => {
  const result = run("--version", "--expect-version", "0.0.0");
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  const failure = JSON.parse(result.stderr);
  assert.equal(failure.error.type, "version_mismatch");
  assert.deepEqual(failure.error.detail, {
    installed: VERSION,
    expected: "0.0.0",
  });
});

test("the version assertion requires the version command and a version value", () => {
  for (const args of [
    ["--expect-version", VERSION],
    ["--version", "--expect-version"],
  ]) {
    const result = run(...args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Use --version --expect-version/);
  }
});
