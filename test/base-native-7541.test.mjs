import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/lark-ka.mjs", import.meta.url));
const apiRoot = "/open-apis/bitable/v1/apps";
const app = "/{app_token}";
const tables = app + "/tables";
const table = tables + "/{table_id}";
const fields = table + "/fields";
const records = table + "/records";
const record = records + "/{record_id}";
const form = table + "/forms/{form_id}";
const views = table + "/views";
const roles = app + "/roles";
const role = roles + "/{role_id}";
const members = role + "/members";
const dashboards = app + "/dashboards";
const workflows = app + "/workflows";

const ids = {
  app_token: "bascnFixture",
  table_id: "tblFixture",
  field_id: "fldFixture",
  view_id: "vewFixture",
  record_id: "recFixture",
  form_id: "vewFormFixture",
  block_id: "blkFixture",
  role_id: "roleFixture",
  member_id: "ou_fixture",
  workflow_id: "workflowFixture",
};
const page = { page_size: 2, page_token: "opaque cursor" };
const clientToken = "2464552b-ed29-4b4a-a8d2-611077821660";
const idempotency = { client_token: clientToken };
const tableData = { name: "Fixture table" };
const fieldData = { field_name: "Label", type: 1 };
const recordData = { fields: { Label: "Fixture record" } };
const memberData = { member_id: ids.member_id };
const roleData = {
  role_name: "Test observer",
  table_roles: [{ table_id: ids.table_id, table_perm: 1 }],
};

// Expected routes and sample payloads are independent of the runtime catalog.
const cases = [
  ["app", "create", "POST", "", {}, { name: "Fixture Base" }],
  [
    "app",
    "copy",
    "POST",
    app + "/copy",
    {},
    { name: "Fixture copy", without_content: true },
  ],
  ["app", "get", "GET", app],
  ["app", "update", "PUT", app, {}, { name: "Renamed Base" }],
  ["app.dashboard", "list", "GET", dashboards, page],
  ["app.role", "create", "POST", roles, {}, roleData],
  ["app.role", "delete", "DELETE", role],
  ["app.role", "list", "GET", roles, page],
  ["app.role", "update", "PUT", role, {}, roleData],
  [
    "app.role.member",
    "batch_create",
    "POST",
    members + "/batch_create",
    {},
    { member_list: [memberData] },
  ],
  [
    "app.role.member",
    "batch_delete",
    "POST",
    members + "/batch_delete",
    {},
    { member_list: [memberData] },
  ],
  [
    "app.role.member",
    "create",
    "POST",
    members,
    { member_id_type: "open_id" },
    memberData,
  ],
  [
    "app.role.member",
    "delete",
    "DELETE",
    members + "/{member_id}",
    { member_id_type: "open_id" },
  ],
  ["app.role.member", "list", "GET", members, page],
  [
    "app.table",
    "batch_create",
    "POST",
    tables + "/batch_create",
    {},
    { tables: [tableData] },
  ],
  [
    "app.table",
    "batch_delete",
    "POST",
    tables + "/batch_delete",
    {},
    { table_ids: [ids.table_id] },
  ],
  ["app.table", "create", "POST", tables, {}, { table: tableData }],
  ["app.table", "delete", "DELETE", table],
  ["app.table", "list", "GET", tables, page],
  ["app.table", "patch", "PATCH", table, {}, tableData],
  ["app.table.field", "create", "POST", fields, idempotency, fieldData],
  ["app.table.field", "delete", "DELETE", fields + "/{field_id}"],
  [
    "app.table.field",
    "list",
    "GET",
    fields,
    { ...page, view_id: ids.view_id, text_field_as_array: true },
  ],
  ["app.table.field", "update", "PUT", fields + "/{field_id}", {}, fieldData],
  ["app.table.form", "get", "GET", form],
  ["app.table.form", "patch", "PATCH", form, {}, { name: "Form fixture" }],
  ["app.table.form.field", "list", "GET", form + "/fields", page],
  [
    "app.table.form.field",
    "patch",
    "PATCH",
    form + "/fields/{field_id}",
    {},
    { title: "Question", required: false, visible: true },
  ],
  [
    "app.table.record",
    "batch_create",
    "POST",
    records + "/batch_create",
    { user_id_type: "open_id", ...idempotency },
    { records: [recordData] },
  ],
  [
    "app.table.record",
    "batch_delete",
    "POST",
    records + "/batch_delete",
    {},
    { records: [ids.record_id] },
  ],
  [
    "app.table.record",
    "batch_get",
    "POST",
    records + "/batch_get",
    {},
    { record_ids: [ids.record_id], automatic_fields: true },
  ],
  [
    "app.table.record",
    "batch_update",
    "POST",
    records + "/batch_update",
    idempotency,
    { records: [{ ...recordData, record_id: ids.record_id }] },
  ],
  ["app.table.record", "create", "POST", records, idempotency, recordData],
  ["app.table.record", "delete", "DELETE", record],
  ["app.table.record", "get", "GET", record, { automatic_fields: true }],
  [
    "app.table.record",
    "list",
    "GET",
    records,
    { ...page, view_id: ids.view_id },
  ],
  [
    "app.table.record",
    "search",
    "POST",
    records + "/search",
    { ...page, user_id_type: "open_id" },
    {
      field_names: ["Label"],
      filter: {
        conjunction: "and",
        conditions: [
          { field_name: "Label", operator: "is", value: ["Fixture record"] },
        ],
      },
    },
  ],
  ["app.table.record", "update", "PUT", record, idempotency, recordData],
  [
    "app.table.view",
    "create",
    "POST",
    views,
    {},
    { view_name: "Fixture view", view_type: "grid" },
  ],
  ["app.table.view", "delete", "DELETE", views + "/{view_id}"],
  [
    "app.table.view",
    "get",
    "GET",
    views + "/{view_id}",
    { user_id_type: "open_id" },
  ],
  ["app.table.view", "list", "GET", views, page],
  [
    "app.table.view",
    "patch",
    "PATCH",
    views + "/{view_id}",
    {},
    { view_name: "Renamed view" },
  ],
  ["app.workflow", "list", "GET", workflows],
  [
    "app.workflow",
    "update",
    "PUT",
    workflows + "/{workflow_id}",
    {},
    { status: "Disable" },
  ],
];

async function cliRunner(t) {
  const configDir = await mkdtemp(path.join(tmpdir(), "base-native-7541-"));
  t.after(() => rm(configDir, { force: true, recursive: true }));
  const env = { PATH: process.env.PATH, LARK_KA_CONFIG_DIR: configDir };
  return (args, expectedFailure = false) => {
    const child = spawnSync(process.execPath, [cli, ...args], {
      env,
      encoding: "utf8",
      timeout: 5000,
    });
    if (child.error) throw child.error;
    if (expectedFailure) assert.notEqual(child.status, 0, args.join(" "));
    else assert.equal(child.status, 0, child.stderr || args.join(" "));
    return JSON.parse(expectedFailure ? child.stderr : child.stdout);
  };
}

function initializeCnooc(run) {
  run([
    "config",
    "init",
    "--name",
    "cnooc",
    "--brand",
    "custom",
    "--app-id",
    "cli_fixture",
    "--open-base-url",
    "https://open.fixture.invalid",
  ]);
}

function pathParams(suffix) {
  return Object.fromEntries(
    Array.from(suffix.matchAll(/\{([a-z_]+)\}/g), ([, key]) => [key, ids[key]]),
  );
}

function nativeArgs(resource, command, params, body) {
  return [
    "--profile",
    "cnooc",
    "base",
    resource,
    command,
    "--as",
    "user",
    "--params",
    JSON.stringify(params),
    ...(body === undefined ? [] : ["--data", JSON.stringify(body)]),
  ];
}

test("all 45 HaiNeng native Base commands preview their documented HTTP requests", async (t) => {
  const run = await cliRunner(t);
  initializeCnooc(run);
  assert.equal(cases.length, 45);

  for (const [resource, command, method, suffix, query = {}, body] of cases) {
    const params = { ...pathParams(suffix), ...query };
    const output = run([
      ...nativeArgs(resource, command, params, body),
      "--dry-run",
    ]);
    assert.equal(output.ok, true, resource + "." + command);
    const route =
      apiRoot + suffix.replace(/\{([a-z_]+)\}/g, (_, key) => ids[key]);
    assert.deepEqual(
      output.data.requests,
      [
        {
          method,
          path: route,
          params: query,
          ...(body === undefined ? {} : { data: body }),
          identity: "user",
        },
      ],
      resource + "." + command,
    );
  }
});

test("native schema resolves exact path IDs and reports missing required input", async (t) => {
  const run = await cliRunner(t);
  initializeCnooc(run);
  const { data } = run([
    "--profile",
    "cnooc",
    "schema",
    "base.app.table.view.get",
  ]);
  assert.equal(data.path, apiRoot + views + "/{view_id}");
  assert.equal(data.httpMethod, "GET");
  assert.equal(data.parameters.app_token.required, true);
  assert.equal(data.parameters.table_id.location, "path");
  assert.equal(data.parameters.view_id.required, true);

  for (const [resource, command, , suffix, query = {}, body] of cases) {
    const params = { ...pathParams(suffix), ...query };
    const missing = Object.keys(pathParams(suffix)).at(-1);
    if (!missing) continue;
    delete params[missing];
    const failing = run(
      [...nativeArgs(resource, command, params, body), "--dry-run"],
      true,
    );
    assert.equal(failing.error.type, "validation", resource + "." + command);
    assert.match(failing.error.message, new RegExp(missing));
  }

  const missingBody = run(
    [
      ...nativeArgs("app.table.record", "batch_create", {
        app_token: ids.app_token,
        table_id: ids.table_id,
      }),
      "--dry-run",
    ],
    true,
  );
  assert.equal(missingBody.error.type, "validation");
  assert.match(missingBody.error.message, /--data/);
});

test("native deletes, permission writes and workflow updates require explicit confirmation", async (t) => {
  const run = await cliRunner(t);
  initializeCnooc(run);
  for (const [resource, command, method, suffix, query = {}, body] of cases) {
    if (
      method !== "DELETE" &&
      command !== "batch_delete" &&
      !(resource.startsWith("app.role") && method !== "GET") &&
      !(resource === "app.workflow" && command === "update")
    )
      continue;
    const output = run(
      nativeArgs(resource, command, { ...pathParams(suffix), ...query }, body),
      true,
    );
    assert.equal(
      output.error.type,
      "confirmation_required",
      resource + "." + command,
    );
  }
});

test("retained Base shortcuts keep the documented v1 routes for a public profile", async (t) => {
  const run = await cliRunner(t);
  run([
    "config",
    "init",
    "--name",
    "public",
    "--brand",
    "feishu",
    "--app-id",
    "cli_fixture",
  ]);
  const common = ["--profile", "public", "base"];
  const create = run([
    ...common,
    "+base-create",
    "--name",
    "Fixture Base",
    "--dry-run",
  ]);
  const get = run([
    ...common,
    "+base-get",
    "--base-token",
    ids.app_token,
    "--dry-run",
  ]);
  assert.deepEqual(create.data.requests, [
    {
      method: "POST",
      path: "/open-apis/bitable/v1/apps",
      params: {},
      data: { name: "Fixture Base" },
      identity: "user",
    },
  ]);
  assert.deepEqual(get.data.requests, [
    {
      method: "GET",
      path: "/open-apis/bitable/v1/apps/" + ids.app_token,
      params: {},
      identity: "user",
    },
  ]);
});
