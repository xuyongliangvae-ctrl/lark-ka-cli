import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { executeTables } from "../src/domains/tables.mjs";

const createPath = "/open-apis/bitable/v1/apps";

test("HaiNeng Base creation sends the Bitable v1 body and maps the new app token", async () => {
  const app = {
    app_token: "bascnFixture",
    default_table_id: "tblFixture",
    folder_token: "fldFixture",
    name: "项目台账",
    url: "https://www.fixture.invalid/base/bascnFixture",
    time_zone: "Asia/Shanghai",
  };
  const calls = [];
  const ctx = {
    config: { brand: "cnooc" },
    identity: "user",
    request: async (method, url, options) => {
      calls.push({ method, url, ...options });
      return { code: 0, data: { app } };
    },
  };
  const result = await executeTables(ctx, "base", "+base-create", {
    name: app.name,
    "folder-token": app.folder_token,
    "time-zone": app.time_zone,
  });
  assert.deepEqual(calls, [
    {
      method: "POST",
      url: createPath,
      body: {
        name: app.name,
        folder_token: app.folder_token,
        time_zone: app.time_zone,
      },
    },
  ]);
  assert.deepEqual(result, {
    app,
    base: { ...app, base_token: app.app_token },
    created: true,
  });
});

test("HaiNeng Base creation keeps bot permission grants tied to the new app token", async () => {
  const calls = [];
  const ctx = {
    config: { brand: "cnooc", userOpenId: "ou_employee" },
    identity: "bot",
    request: async (method, url, options) => {
      calls.push({ method, url, ...options });
      return url === createPath ? { app: { app_token: "bascnFixture" } } : {};
    },
  };
  const result = await executeTables(ctx, "base", "+base-create", {
    name: "Demo",
  });
  assert.equal(result.permission_grant.status, "granted");
  assert.deepEqual(calls[1], {
    method: "POST",
    url: "/open-apis/drive/v1/permissions/bascnFixture/members",
    query: { type: "bitable", need_notification: false },
    body: {
      member_type: "openid",
      member_id: "ou_employee",
      perm: "full_access",
      type: "user",
    },
  });
});

test("HaiNeng Base creation validates the name and rejects a missing app token", async () => {
  let requests = 0;
  const ctx = {
    config: { brand: "cnooc" },
    identity: "user",
    request: async () => {
      requests += 1;
      return { app: {} };
    },
  };
  await assert.rejects(
    executeTables(ctx, "base", "+base-create", { name: "   " }),
    /--name must be a non-empty string/,
  );
  assert.equal(requests, 0);
  await assert.rejects(
    executeTables(ctx, "base", "+base-create", { name: "Demo" }),
    /missing app\.app_token/,
  );
  assert.equal(requests, 1);
});

test("Base creation and idempotent record writes use the appropriate dry-run routes", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "lark-base-create-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL("../bin/lark-ka.mjs", import.meta.url));
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.startsWith("LARK_") && !key.startsWith("LARKSUITE_"),
      ),
    ),
    LARK_KA_CONFIG_DIR: directory,
  };
  const run = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, ...args], { env, encoding: "utf8" }),
    );
  for (const [profile, brand, route] of [
    ["cnooc", "custom", createPath],
    ["public", "feishu", "/open-apis/base/v3/bases"],
  ]) {
    run(
      "config",
      "init",
      "--name",
      profile,
      "--brand",
      brand,
      "--app-id",
      "cli_fixture",
      "--open-base-url",
      "https://open.fixture.invalid",
    );
    const { data } = run(
      "--profile",
      profile,
      "base",
      "+base-create",
      "--name",
      "Demo",
      "--as",
      "user",
      "--dry-run",
    );
    assert.deepEqual(
      data.requests.map(({ method, path, data }) => ({ method, path, data })),
      [{ method: "POST", path: route, data: { name: "Demo" } }],
    );
  }
  const clientToken = "fe599b60-450f-46ff-b2ef-9f6675625b97";
  const { data } = run(
    "--profile",
    "cnooc",
    "base",
    "+record-batch-create",
    "--base-token",
    "bascnFixture",
    "--table-id",
    "tblFixture",
    "--client-token",
    clientToken,
    "--json",
    '{"records":[{"fields":{"Name":"Demo"}}]}',
    "--as",
    "user",
    "--dry-run",
  );
  assert.equal(data.requests[0].params.client_token, clientToken);
  assert.equal(
    data.requests[0].path,
    createPath + "/bascnFixture/tables/tblFixture/records/batch_create",
  );
});
