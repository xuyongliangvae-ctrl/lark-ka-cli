import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/args.mjs";

const cli = fileURLToPath(new URL("../bin/lark-ka.mjs", import.meta.url));
const recordsPath =
  "/open-apis/bitable/v1/apps/baseFixture/tables/tblFixture/records/search";
const filter = {
  conjunction: "and",
  conditions: [{ field_name: "Name", operator: "contains", value: ["验收"] }],
};
const sort = [{ field_name: "Name", desc: true }];

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "lark-base-query-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "config.json"),
    JSON.stringify({
      apps: [
        {
          name: "cnooc",
          brand: "custom",
          appId: "cli_fixture",
          openBaseUrl: "https://open.fixture.invalid",
        },
        { name: "public", brand: "feishu", appId: "cli_public_fixture" },
      ],
    }),
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("LARK")),
  );
  env.LARK_KA_CONFIG_DIR = directory;
  return {
    directory,
    run: (args, input) =>
      JSON.parse(
        execFileSync(process.execPath, [cli, ...args], {
          env,
          input,
          encoding: "utf8",
        }),
      ).data,
  };
}

function recordQuery(profile, command) {
  return [
    "--profile",
    profile,
    "base",
    command,
    "--base-token",
    "baseFixture",
    "--table-id",
    "tblFixture",
    "--dry-run",
  ];
}

test("HaiNeng record list and search expose and accept filter and sort flags", async (t) => {
  const { run } = await fixture(t);
  for (const command of ["+record-list", "+record-search"]) {
    const schema = run(["--profile", "cnooc", "schema", `base.${command}`]);
    for (const flag of ["filter-json", "sort-json"]) {
      assert.ok(schema.flags.some(({ name }) => name === flag));
    }
    const { requests } = run([
      ...recordQuery("cnooc", command),
      "--filter-json",
      JSON.stringify(filter),
      "--sort-json",
      JSON.stringify(sort),
    ]);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].path, recordsPath);
    assert.deepEqual(requests[0].data, { filter, sort });
  }
});

test("HaiNeng record search accepts inline, stdin, and file input with --json", async (t) => {
  const { directory, run } = await fixture(t);
  const body = { filter, sort };
  const serialized = JSON.stringify(body);
  const filename = path.join(directory, "query.json");
  await writeFile(filename, serialized);
  const cases = [
    { flags: ["--json", `  ${serialized}`] },
    { flags: [`--json=${serialized}`] },
    { flags: ["--json", "-"], input: serialized },
    { flags: ["--json=-"], input: serialized },
    { flags: [`--json=@${filename}`] },
  ];
  for (const { flags, input } of cases) {
    const { requests } = run(
      [...recordQuery("cnooc", "+record-search"), ...flags],
      input,
    );
    assert.equal(requests[0].path, recordsPath);
    assert.deepEqual(requests[0].data, body);
  }
  assert.equal(parseArgs(["auth", "status", "--json"]).flags.json, true);
  assert.equal(parseArgs(["auth", "status", "--json=false"]).flags.json, false);
});

test("public Base dry-run retains its v3 record listing shape", async (t) => {
  const { run } = await fixture(t);
  const v3Filter = { logic: "and", conditions: [] };
  const v3Sort = [{ field: "Name", desc: true }];
  const { requests } = run([
    ...recordQuery("public", "+record-list"),
    "--filter-json",
    JSON.stringify(v3Filter),
    "--sort-json",
    JSON.stringify(v3Sort),
  ]);
  assert.equal(requests[0].method, "GET");
  assert.equal(
    requests[0].path,
    "/open-apis/base/v3/bases/baseFixture/tables/tblFixture/records",
  );
  assert.equal(requests[0].params.filter, JSON.stringify(v3Filter));
  assert.equal(requests[0].params.sort, JSON.stringify(v3Sort));
});
