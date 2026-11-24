import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../bin/lark-ka.mjs", import.meta.url));
const unsupported = "+base-block-create";
const supported = "+base-get";

async function fixture(t, profiles = []) {
  const directory = await mkdtemp(path.join(tmpdir(), "base-discovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "config.json"),
    JSON.stringify({ apps: profiles }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^LARK/.test(key)),
  );
  env.LARK_KA_CONFIG_DIR = directory;
  return function run(args) {
    return new Promise((resolve) => {
      execFile(process.execPath, [entry, ...args], { env }, (error, out, err) =>
        resolve({ code: error?.code ?? 0, out, err }),
      );
    });
  };
}

const profiles = [
  {
    name: "cnooc",
    brand: "custom",
    appId: "cli_private_fixture",
    openBaseUrl: "https://private.invalid",
  },
  { name: "public", brand: "feishu", appId: "cli_public_fixture" },
];

test("HaiNeng help and both schema lists hide unavailable Base shortcuts", async (t) => {
  const run = await fixture(t, profiles);
  const cases = [
    ["--profile", "cnooc", "base", "--help"],
    ["--profile", "cnooc", "schema", "base"],
    ["--profile", "cnooc", "schema"],
  ];
  const [help, baseSchema, rootSchema, publicHelp, publicSchema] =
    await Promise.all([
      ...cases.map(run),
      run(["--profile", "public", "base", "--help"]),
      run(["--profile", "public", "schema", "base"]),
    ]);
  for (const r of [help, baseSchema, rootSchema]) {
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.includes(supported));
    assert.ok(!r.out.includes(unsupported));
  }
  const baseData = JSON.parse(baseSchema.out).data;
  assert.ok(
    baseData.shortcuts.every((shortcut) => shortcut.startsWith("base.")),
  );
  assert.equal(publicHelp.code, 0, publicHelp.err);
  assert.ok(!publicHelp.out.includes(unsupported));
  assert.ok(
    !JSON.parse(publicSchema.out).data.shortcuts.includes(
      `base.${unsupported}`,
    ),
  );
});

test("HaiNeng completion carries the explicit profile and filters command flags", async (t) => {
  const run = await fixture(t, profiles);
  const [privateList, publicList, hiddenFlags, publicFlags] = await Promise.all(
    [
      run(["__complete", "--profile", "cnooc", "base", "+base-"]),
      run(["__completeNoDesc", "base", "--profile=public", "+base-"]),
      run(["__complete", "--profile", "cnooc", "base", unsupported, "--he"]),
      run(["__complete", "--profile", "public", "base", unsupported, "--he"]),
    ],
  );
  assert.equal(privateList.code, 0, privateList.err);
  assert.ok(privateList.out.includes(supported));
  assert.ok(!privateList.out.includes(unsupported));
  assert.ok(!publicList.out.includes(unsupported));
  assert.ok(!hiddenFlags.out.includes("--help"));
  assert.ok(!publicFlags.out.includes("--help"));
});

test("HaiNeng rejects unavailable Base shortcuts before credential lookup", async (t) => {
  const run = await fixture(t, profiles);
  for (const words of [
    ["base", unsupported],
    ["base", unsupported, "--help"],
    ["schema", `base.${unsupported}`],
  ]) {
    const r = await run(["--profile", "cnooc", ...words]);
    assert.notEqual(r.code, 0);
    const result = JSON.parse(r.err);
    assert.equal(result.error.type, "validation");
    if (words[0] === "schema")
      assert.match(result.error.message, /Unknown schema/);
    else {
      assert.match(result.error.message, /not included in this CLI/);
      assert.match(result.error.hint, /lark-ka --help/);
    }
  }
});

test("help and schema work for an explicit, unconfigured profile", async (t) => {
  const run = await fixture(t);
  const [privateHelp, privateSchema, genericHelp] = await Promise.all([
    run(["--profile", "cnooc", "base", "--help"]),
    run(["--profile", "cnooc", "schema", "base"]),
    run(["--profile", "not-initialized", "--help"]),
  ]);
  for (const r of [privateHelp, privateSchema]) {
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.includes(supported));
    assert.ok(!r.out.includes(unsupported));
  }
  assert.equal(genericHelp.code, 0, genericHelp.err);
  assert.match(genericHelp.out, /Usage: lark-ka/);
});

test("HaiNeng can discover and preview native Base methods", async (t) => {
  const run = await fixture(t, profiles);
  const [completion, schema, preview] = await Promise.all([
    run([
      "__complete",
      "--profile",
      "cnooc",
      "base",
      "app",
      "table",
      "record",
      "sea",
    ]),
    run(["--profile", "cnooc", "schema", "base.app.table.record.search"]),
    run([
      "--profile",
      "cnooc",
      "base",
      "app",
      "table",
      "record",
      "search",
      "--params",
      '{"app_token":"base1","table_id":"table1","page_size":10}',
      "--data",
      '{"field_names":["Name"]}',
      "--dry-run",
    ]),
  ]);
  assert.equal(completion.code, 0, completion.err);
  assert.ok(completion.out.split("\n").includes("search"));
  assert.equal(schema.code, 0, schema.err);
  const entry = JSON.parse(schema.out).data;
  assert.equal(entry.id, "base.app.table.record.search");
  assert.equal(entry.risk, "read");
  assert.equal(preview.code, 0, preview.err);
  assert.deepEqual(JSON.parse(preview.out).data.requests, [
    {
      method: "POST",
      path: "/open-apis/bitable/v1/apps/base1/tables/table1/records/search",
      params: { page_size: 10 },
      data: { field_names: ["Name"] },
      identity: "user",
    },
  ]);
});
