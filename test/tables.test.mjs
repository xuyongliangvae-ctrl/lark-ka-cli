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
const target = {
  "base-token": "base1",
  "table-id": "tbl1",
  "field-id": "fld1",
  "record-id": "rec1",
  "view-id": "vew1",
  "form-id": "form1",
  "dashboard-id": "dash1",
  "block-id": "block1",
  "workflow-id": "wkf1",
  "role-id": "role1",
};
const sheet = { "spreadsheet-token": "ss1", "sheet-id": "sheet1" };

test("all 85 Base source shortcuts resolve to actual dry-run requests", async () => {
  assert.equal(Object.keys(commandSpecs.base).length, 85);
  for (const command of Object.keys(commandSpecs.base)) {
    const ctx = context({ dryRun: true });
    const flags = {
      ...target,
      name: "Demo",
      type: "table",
      json: '{"name":"Demo","type":"text"}',
      dsl: '{"dimensions":[]}',
      keyword: "Alice",
      "search-field": "Name",
      "record-ids": "rec1",
      "share-token": "share1",
      questions: "[]",
      "question-ids": '["q1"]',
      "data-config": "{}",
      file: "./sample.png",
      "file-token": "file1",
      output: "./sample.png",
    };
    if (["+record-get", "+record-delete", "+record-search"].includes(command))
      delete flags.json;
    if (command === "+form-submit") flags.json = '{"fields":{"Title":"Demo"}}';
    const result = await executeTables(ctx, "base", command, flags);
    assert.notEqual(result, undefined, command);
    assert.ok(ctx.requests.length > 0, command);
    assert.ok(
      ctx.requests.every(
        (r) =>
          r.path.startsWith("/open-apis/base/v3/") ||
          r.path.startsWith("/open-apis/drive/v1/medias/"),
      ),
      command,
    );
  }
});

test("Base list and record batch operations use v3 paths and source defaults", async () => {
  const ctx = context();
  await executeTables(ctx, "base", "+table-list", target);
  assert.deepEqual(ctx.requests[0], {
    method: "GET",
    path: "/open-apis/base/v3/bases/base1/tables",
    query: { offset: 0, limit: 50 },
  });
  await executeTables(ctx, "base", "+record-batch-create", {
    ...target,
    json: '{"records":[{"fields":{"Name":"Alice"}}]}',
  });
  assert.equal(
    ctx.requests[1].path,
    "/open-apis/base/v3/bases/base1/tables/tbl1/records/batch_create",
  );
  assert.deepEqual(ctx.requests[1].body.records[0].fields, { Name: "Alice" });
});

test("record selections validate duplicate IDs and distinguish projected fields", async () => {
  const ctx = context();
  await executeTables(ctx, "base", "+record-get", {
    ...target,
    "record-id": ["rec1", "rec2"],
    "field-id": ["Name", "Status"],
  });
  assert.deepEqual(ctx.requests[0].body, {
    record_id_list: ["rec1", "rec2"],
    select_fields: ["Name", "Status"],
  });
  await assert.rejects(
    executeTables(ctx, "base", "+record-get", {
      ...target,
      "record-id": ["same", "same"],
    }),
    /distinct/,
  );
  await assert.rejects(
    executeTables(ctx, "base", "+record-get", {
      ...target,
      json: '{"record_id_list":["rec2"]}',
    }),
    /mutually exclusive/,
  );
});

test("record search, form submissions, and computed dashboard data retain exact API shape", async () => {
  const ctx = context();
  await executeTables(ctx, "base", "+record-search", {
    ...target,
    keyword: "Alice",
    "search-field": "Name",
    "filter-json": '{"logic":"and","conditions":[]}',
  });
  assert.equal(ctx.requests[0].body.limit, 10);
  assert.equal(ctx.requests[0].body.filter.logic, "and");
  await executeTables(ctx, "base", "+form-submit", {
    "share-token": "share",
    json: '{"fields":{"Name":"Alice"}}',
  });
  assert.deepEqual(ctx.requests[1].body, {
    share_token: "share",
    content: { Name: "Alice" },
  });
  await executeTables(ctx, "base", "+dashboard-block-get-data", target);
  assert.equal(
    ctx.requests[2].path,
    "/open-apis/base/v3/bases/base1/dashboards/blocks/block1/data",
  );
});

test("workflow list paginates via POST body and detects repeated page tokens", async () => {
  const ctx = context({
    response: (_, i) => ({
      items: [{ workflow_id: `wkf${i}` }],
      has_more: i === 1,
      page_token: "next",
    }),
  });
  const result = await executeTables(ctx, "base", "+workflow-list", target);
  assert.equal(result.items.length, 2);
  assert.equal(ctx.requests[0].method, "POST");
  assert.equal(ctx.requests[1].body.page_token, "next");
  const bad = context({
    response: () => ({ items: [], has_more: true, page_token: "same" }),
  });
  await assert.rejects(
    executeTables(bad, "base", "+workflow-list", target),
    /repeated page token/,
  );
});

test("Base API nested errors stay errors; formula guide and high-risk operations are checked", async () => {
  const nested = context({
    response: () => ({ code: 123, msg: "Denied", data: {} }),
  });
  await assert.rejects(
    executeTables(nested, "base", "+base-get", target),
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

test("all 42 backward Sheets shortcuts execute real REST dry-run plans", async () => {
  const legacy = Object.entries(commandSpecs.sheets).filter(([, spec]) =>
    spec.source?.includes("/backward/"),
  );
  assert.equal(legacy.length, 42);
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

test("workbook create and export use legacy Sheets and Drive tasks", async () => {
  const create = context({ dryRun: true });
  await executeTables(create, "sheets", "+workbook-create", { title: "T" });
  assert.ok(
    create.requests.some((r) => r.path.endsWith("/sheets/v3/spreadsheets")),
  );
  const exp = context({ dryRun: true });
  await executeTables(exp, "sheets", "+export", {
    "spreadsheet-token": "ss",
    "file-extension": "xlsx",
  });
  assert.ok(
    exp.requests.some((r) => r.path.endsWith("/drive/v1/export_tasks")),
  );
  assert.ok(
    exp.requests.some((r) => r.path.includes("/export_tasks/<ticket>")),
  );
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
  const data = {
    fields: ["Name", "Note"],
    record_id_list: ["rec1"],
    data: [["Alice", "one|two\nthree"]],
    has_more: false,
    ignored_fields: ["Hidden"],
  };
  const ctx = context({ response: () => data });
  const table = await executeTables(ctx, "base", "+record-list", target);
  assert.match(table.__raw, /\| _record_id \| Name \| Note \|/);
  assert.ok(table.__raw.includes("one\\|two<br>three"));
  assert.match(table.__raw, /Meta: count=1; has_more=false; ignored_fields=1/);
  const detail = await executeTables(ctx, "base", "+record-get", target);
  assert.ok(detail.__raw.includes("- `_record_id`: rec1"));
  const raw = await executeTables(ctx, "base", "+record-list", {
    ...target,
    format: "json",
  });
  assert.deepEqual(raw, data);
  const query = await executeTables(ctx, "base", "+record-list", {
    ...target,
    jq: ".data",
  });
  assert.deepEqual(query, data);
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
      r.path === "/open-apis/base/v3/bases" ? { base_token: "newBase" } : {},
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
      return { base_token: "created" };
    },
  });
  denied.identity = "bot";
  denied.config.userOpenId = "ou_owner";
  const partial = await executeTables(denied, "base", "+base-create", {
    name: "New",
  });
  assert.equal(partial.created, true);
  assert.equal(partial.permission_grant.status, "failed");
  const noUser = context({ response: () => ({ base_token: "created" }) });
  noUser.identity = "bot";
  assert.equal(
    (await executeTables(noUser, "base", "+base-create", { name: "New" }))
      .permission_grant.status,
    "skipped",
  );
  assert.equal(noUser.requests.length, 1);
});
