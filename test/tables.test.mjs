import test from "node:test";
import assert from "node:assert/strict";
import { executeTables, commandSpecs } from "../src/domains/tables.mjs";
import { resolveInput } from "../src/io.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function context({ dryRun = false, response } = {}) {
  const requests = [];
  return {
    dryRun,
    requests,
    input: resolveInput,
    config: {
      openBaseUrl: "https://private.example.test",
      webBaseUrl: "https://docs.example.test",
    },
    identity: "user",
    async paginate(method, path, options = {}) {
      return this.request(method, path, options);
    },
    async request(method, path, options = {}) {
      requests.push({ method, path, ...options });
      if (response)
        return response({ method, path, ...options }, requests.length);
      return {
        fields: [],
        views: [],
        tables: [],
        forms: [],
        items: [],
        total: 0,
      };
    },
  };
}
const target = { "base-token": "base1", "table-id": "tbl1" };
const sheet = { "spreadsheet-token": "ss1", "sheet-id": "sheet1" };

test("all 18 retained Base shortcuts resolve to Bitable v1 dry-run requests", async () => {
  const cases = {
    "+base-create": { name: "Demo" },
    "+base-copy": { "base-token": "base1", name: "Copy" },
    "+base-get": { "base-token": "base1" },
    "+table-create": { "base-token": "base1", name: "Data" },
    "+table-get": target,
    "+table-list": { "base-token": "base1" },
    "+field-get": { ...target, "field-id": "fld1" },
    "+field-list": target,
    "+record-batch-create": {
      ...target,
      json: '{"records":[{"fields":{"Name":"Alice"}}]}',
    },
    "+record-batch-update": {
      ...target,
      json: '{"records":[{"record_id":"rec1","fields":{"Name":"Alice"}}]}',
    },
    "+record-delete": { ...target, "record-id": "rec1" },
    "+record-get": { ...target, "record-id": "rec1" },
    "+record-list": target,
    "+record-search": { ...target, keyword: "Alice", "search-field": "Name" },
    "+view-get": { ...target, "view-id": "vew1" },
    "+view-list": target,
    "+form-get": { ...target, "form-id": "vewForm1" },
    "+dashboard-list": { "base-token": "base1" },
  };
  assert.deepEqual(
    Object.keys(commandSpecs.base).sort(),
    Object.keys(cases).sort(),
  );
  for (const [command, flags] of Object.entries(cases)) {
    const ctx = context({ dryRun: true });
    const result = await executeTables(ctx, "base", command, flags);
    assert.notEqual(result, undefined, command);
    assert.ok(ctx.requests.length > 0, command);
    assert.ok(
      ctx.requests.every((request) =>
        request.path.startsWith("/open-apis/bitable/v1/"),
      ),
      command,
    );
  }
});

test("Base nested errors and retained high-risk writes stay structured failures", async () => {
  const nested = context({
    response: () => ({ code: 123, msg: "Denied", data: {} }),
  });
  await assert.rejects(
    executeTables(nested, "base", "+base-get", { "base-token": "base1" }),
    /Denied/,
  );
  await assert.rejects(
    executeTables(context(), "base", "+field-create", {
      ...target,
      json: '{"type":"formula"}',
    }),
    /i-have-read-guide/,
  );
  await assert.rejects(
    executeTables(context(), "sheets", "+delete-sheet", sheet),
    (e) => e.code === 10,
  );
  assert.equal(
    await executeTables(context(), "other", "+not-a-command", {}),
    undefined,
  );
});

test("Base table creation follows created ID and modifies its default first field before creating views", async () => {
  const ctx = context({
    response: (r) =>
      r.path.endsWith("/tables")
        ? { table_id: "newTable" }
        : r.path.endsWith("/fields") && r.method === "GET"
          ? { fields: [{ field_id: "defaultField" }], total: 1 }
          : { id: "created" },
  });
  const result = await executeTables(ctx, "base", "+table-create", {
    ...target,
    name: "Data",
    fields: '[{"name":"Name","type":"text"}]',
    view: '{"name":"Main","type":"grid"}',
  });
  assert.equal(result.table.table_id, "newTable");
  assert.equal(ctx.requests[2].method, "PUT");
  assert.equal(
    ctx.requests[2].path,
    "/open-apis/base/v3/bases/base1/tables/newTable/fields/defaultField",
  );
  assert.equal(
    ctx.requests[3].path,
    "/open-apis/base/v3/bases/base1/tables/newTable/views",
  );
});

test("all 41 backward Sheets shortcuts execute real REST dry-run plans", async () => {
  const legacy = Object.entries(commandSpecs.sheets).filter(([, spec]) =>
    spec.source?.includes("/backward/"),
  );
  assert.equal(legacy.length, 41);
  for (const [command] of legacy) {
    const ctx = context({ dryRun: true });
    const flags = {
      ...sheet,
      title: "Demo",
      range: "sheet1!A1:B2",
      name: "image.png",
      image: "./sample.png",
      values: "[[1,2],[3,4]]",
      headers: '["Name"]',
      data: '[{"ranges":["sheet1!A1"],"style":{}}]',
      style: "{}",
      "merge-type": "MERGE_ALL",
      ranges: '["sheet1!A1:B2"]',
      "condition-values": '["One"]',
      "condition-id": "A",
      "filter-type": "text",
      expected: '["1"]',
      "filter-view-id": "view1",
      "filter-view-name": "View",
      "float-image-id": "image1",
      "float-image-token": "file1",
      dimension: "ROWS",
      length: 2,
      "start-index": 0,
      "end-index": 2,
      "destination-index": 5,
      find: "a",
      replacement: "b",
      "file-extension": "xlsx",
      file: "./sample.png",
    };
    if (command === "+create") flags.data = "[[1]]";
    if (command === "+write-image") flags.range = "sheet1!A1";
    const result = await executeTables(ctx, "sheets", command, flags);
    assert.notEqual(result, undefined, command);
    assert.ok(ctx.requests.length, command);
    assert.ok(
      ctx.requests.every(
        (x) =>
          x.path.startsWith("/open-apis/sheets/") ||
          x.path.startsWith("/open-apis/drive/"),
      ),
      command,
    );
  }
});

test("legacy Sheets use legacy payloads rather than silently changing API semantics", async () => {
  const ctx = context();
  await executeTables(ctx, "sheets", "+write", {
    ...sheet,
    range: "A1",
    values: "[[1,2],[3,4]]",
  });
  assert.equal(
    ctx.requests[0].path,
    "/open-apis/sheets/v2/spreadsheets/ss1/values",
  );
  assert.deepEqual(ctx.requests[0].body.valueRange, {
    range: "sheet1!A1:B2",
    values: [
      [1, 2],
      [3, 4],
    ],
  });
  await executeTables(ctx, "sheets", "+update-dimension", {
    ...sheet,
    dimension: "ROWS",
    "start-index": 1,
    "end-index": 3,
    visible: false,
  });
  assert.deepEqual(ctx.requests[1].body.dimensionProperties, {
    visible: false,
  });
  await executeTables(ctx, "sheets", "+get-filter-view-condition", {
    ...sheet,
    "filter-view-id": "view1",
    "condition-id": "A",
  });
  assert.equal(
    ctx.requests[2].path,
    "/open-apis/sheets/v3/spreadsheets/ss1/sheets/sheet1/filter_views/view1/conditions/A",
  );
});

test("Base record reads default to Markdown with metadata and allow explicit JSON or jq", async () => {
  const records = [
    { record_id: "rec1", fields: { Name: "Alice", Note: "one|two\nthree" } },
  ];
  const ctx = context({
    response: (request) =>
      request.path.endsWith("batch_get")
        ? { records }
        : { items: records, has_more: false, ignored_fields: ["Hidden"] },
  });
  const table = await executeTables(ctx, "base", "+record-list", target);
  assert.match(table.__raw, /\| _record_id \| Name \| Note \|/);
  assert.ok(table.__raw.includes("one\\|two<br>three"));
  assert.match(table.__raw, /Meta: count=1; has_more=false; ignored_fields=1/);
  const detail = await executeTables(ctx, "base", "+record-get", {
    ...target,
    "record-id": "rec1",
  });
  assert.ok(detail.__raw.includes("- `_record_id`: rec1"));
  const raw = await executeTables(ctx, "base", "+record-list", {
    ...target,
    format: "json",
  });
  assert.deepEqual(raw.fields, ["Name", "Note"]);
  assert.deepEqual(raw.record_id_list, ["rec1"]);
  assert.deepEqual(raw.data, [["Alice", "one|two\nthree"]]);
  assert.deepEqual(raw.items, records);
  const query = await executeTables(ctx, "base", "+record-list", {
    ...target,
    jq: ".data",
  });
  assert.deepEqual(query, raw);
  await assert.rejects(
    executeTables(ctx, "base", "+record-list", {
      ...target,
      format: "markdown",
      jq: ".data",
    }),
    /mutually exclusive/,
  );
});

test("bot-created Base grants the configured employee access without hiding permission failures", async () => {
  const ctx = context({
    response: (r) =>
      r.path === "/open-apis/bitable/v1/apps"
        ? { app: { app_token: "newBase" } }
        : {},
  });
  ctx.identity = "bot";
  ctx.config.userOpenId = "ou_owner";
  const result = await executeTables(ctx, "base", "+base-create", {
    name: "New",
  });
  assert.equal(result.permission_grant.status, "granted");
  assert.equal(
    ctx.requests[1].path,
    "/open-apis/drive/v1/permissions/newBase/members",
  );
  assert.deepEqual(ctx.requests[1].query, {
    type: "bitable",
    need_notification: false,
  });
  assert.equal(ctx.requests[1].body.member_id, "ou_owner");
  const denied = context({
    response: (r) => {
      if (r.path.includes("/permissions/"))
        throw new Error("permission denied");
      return { app: { app_token: "created" } };
    },
  });
  denied.identity = "bot";
  denied.config.userOpenId = "ou_owner";
  const partial = await executeTables(denied, "base", "+base-create", {
    name: "New",
  });
  assert.equal(partial.created, true);
  assert.equal(partial.permission_grant.status, "failed");
  const noUser = context({
    response: () => ({ app: { app_token: "created" } }),
  });
  noUser.identity = "bot";
  assert.equal(
    (await executeTables(noUser, "base", "+base-create", { name: "New" }))
      .permission_grant.status,
    "skipped",
  );
  assert.equal(noUser.requests.length, 1);
});
