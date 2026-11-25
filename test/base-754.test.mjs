import test from "node:test";
import assert from "node:assert/strict";
import { executeTables } from "../src/domains/tables.mjs";
import { createContext } from "../src/context.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const target = { "base-token": "app1", "table-id": "tbl1" };
const base = "/open-apis/bitable/v1/apps/app1/tables";
function mock(answer) {
  const requests = [];
  return {
    config: { brand: "custom", profileName: "cnooc" },
    identity: "user",
    requests,
    input: async (value) => value,
    request: async (method, url, options) => {
      requests.push({ method, url, ...options });
      return answer ?? { items: [] };
    },
  };
}

test("7.54 table/field listing uses Bitable v1 opaque cursor and aliases native items", async () => {
  for (const [command, suffix, key] of [
    ["+table-list", "", "tables"],
    ["+field-list", "/tbl1/fields", "fields"],
  ]) {
    const data = {
      items: [{ name: "Name" }],
      has_more: true,
      page_token: "next",
    };
    const ctx = mock(data);
    const subject =
      command === "+table-list" ? { "base-token": "app1" } : target;
    const result = await executeTables(ctx, "base", command, {
      ...subject,
      limit: 22,
      "page-token": "cursor",
    });
    assert.deepEqual(ctx.requests, [
      {
        method: "GET",
        url: base + suffix,
        query: { page_size: 22, page_token: "cursor" },
      },
    ]);
    assert.deepEqual(result[key], data.items);
    assert.equal(result.page_token, "next");
    await assert.rejects(
      executeTables(ctx, "base", command, { ...subject, limit: 101 }),
      /100/,
    );
    await assert.rejects(
      executeTables(ctx, "base", command, { ...subject, offset: 1 }),
      /--page-token/,
    );
  }
});

test("7.54 record list preserves projections, view and sort and renders actual v1 records", async () => {
  const ctx = mock({
    items: [{ record_id: "rec1", fields: { Name: "Alice" } }],
    total: 1,
    has_more: false,
  });
  const f = {
    ...target,
    "field-id": ["Name", "Empty"],
    "view-id": "vew1",
    "sort-json": '[{"field":"Name","desc":true}]',
    limit: 500,
  };
  const result = await executeTables(ctx, "base", "+record-list", f);
  assert.deepEqual(ctx.requests[0], {
    method: "POST",
    url: base + "/tbl1/records/search",
    query: { page_size: 500 },
    body: {
      view_id: "vew1",
      field_names: ["Name", "Empty"],
      sort: [{ field_name: "Name", desc: true }],
    },
  });
  assert.match(result.__raw, /rec1 \| Alice/);
  const data = await executeTables(ctx, "base", "+record-list", {
    ...f,
    format: "json",
  });
  assert.deepEqual(data.data, [["Alice", null]]);
  assert.deepEqual(data.items[0].record_id, "rec1");
  await assert.rejects(
    executeTables(ctx, "base", "+record-list", { ...target, limit: 501 }),
    /500/,
  );
});

test("7.54 search matches named fields and preserves a caller-supplied predicate", async () => {
  const ctx = mock({ items: [], has_more: false });
  const filter = {
    conjunction: "or",
    conditions: [{ field_name: "Status", operator: "is", value: ["Open"] }],
  };
  await executeTables(ctx, "base", "+record-search", {
    ...target,
    keyword: "Alice",
    "search-field": ["Name", "Notes"],
    "filter-json": filter,
    "view-id": "vew1",
    "page-token": "p2",
    format: "json",
  });
  assert.deepEqual(ctx.requests[0], {
    method: "POST",
    url: base + "/tbl1/records/search",
    query: { page_size: 10, page_token: "p2" },
    body: {
      view_id: "vew1",
      filter: {
        conjunction: "and",
        children: [
          filter,
          {
            conjunction: "or",
            conditions: ["Name", "Notes"].map((field_name) => ({
              field_name,
              operator: "contains",
              value: ["Alice"],
            })),
          },
        ],
      },
    },
  });
  const before = ctx.requests.length;
  for (const f of [
    { "filter-json": { logic: "and", conditions: [] } },
    { json: { bogus: 1 } },
    { json: { keyword: "lost", search_fields: ["Name"] }, keyword: "Alice" },
    { json: { filter, offset: 100 } },
  ])
    await assert.rejects(
      executeTables(ctx, "base", "+record-search", { ...target, ...f }),
    );
  assert.equal(ctx.requests.length, before);
});

test("7.54 batches keep cells aligned, reject invalid dimensions before a POST", async () => {
  const ctx = mock({ records: [{ record_id: "rec1" }] });
  const body = { records: [{ fields: { Name: "Alice", Amount: 0 } }] };
  for (const input of [
    body,
    { fields: ["Name", "Amount"], rows: [["Alice", 0]] },
  ]) {
    const response = await executeTables(ctx, "base", "+record-batch-create", {
      ...target,
      json: input,
    });
    assert.deepEqual(ctx.requests.at(-1), {
      method: "POST",
      url: base + "/tbl1/records/batch_create",
      body,
      query: {},
    });
    assert.equal(response.records[0].record_id, "rec1");
  }
  await assert.rejects(
    executeTables(ctx, "base", "+record-batch-create", {
      ...target,
      json: { fields: ["a", "b"], rows: [["x"]] },
    }),
    /number of fields/,
  );
  await assert.rejects(
    executeTables(ctx, "base", "+record-batch-create", {
      ...target,
      json: { records: Array(501).fill(body.records[0]) },
    }),
    /500/,
  );
  assert.equal(ctx.requests.length, 2);
});

test("7.54 page-all sends continuation in the POST query and keeps the filter on every page", async (t) => {
  const temp = await mkdtemp(path.join(tmpdir(), "hn-base-754-"));
  const previous = process.env.LARK_KA_CONFIG_DIR;
  process.env.LARK_KA_CONFIG_DIR = temp;
  t.after(async () => {
    if (previous === undefined) delete process.env.LARK_KA_CONFIG_DIR;
    else process.env.LARK_KA_CONFIG_DIR = previous;
    await rm(temp, { force: true, recursive: true });
  });
  const ctx = await createContext(
    { "page-all": true, as: "user" },
    { config: { brand: "cnooc" } },
  );
  const calls = [];
  ctx.request = async (method, url, opts) => {
    calls.push([method, url, structuredClone(opts)]);
    return calls.length === 1
      ? {
          items: [{ record_id: "a", fields: { N: 1 } }],
          has_more: true,
          page_token: "p2",
        }
      : { items: [{ record_id: "b", fields: { N: 2 } }], has_more: false };
  };
  const data = await executeTables(ctx, "base", "+record-list", {
    ...target,
    "page-all": true,
    "page-token": "p1",
    format: "json",
    "filter-json": {
      conjunction: "and",
      conditions: [{ field_name: "N", operator: "isGreater", value: ["0"] }],
    },
  });
  assert.deepEqual(
    calls.map((call) => call[2].query.page_token),
    ["p1", "p2"],
  );
  assert.deepEqual(calls[0][2].body, calls[1][2].body);
  assert.deepEqual(data.record_id_list, ["a", "b"]);
});

test("retained Base shortcuts use Bitable v1 for every deployment", async () => {
  for (const config of [
    { brand: "custom", profileName: "other" },
    { brand: "feishu", profileName: "cnooc" },
  ]) {
    const ctx = mock({ items: [] });
    ctx.config = config;
    await executeTables(ctx, "base", "+table-list", {
      "base-token": target["base-token"],
    });
    assert.equal(ctx.requests[0].url, "/open-apis/bitable/v1/apps/app1/tables");
  }
});

test("7.54 rejects unsupported selectors before issuing a broader read or hidden write", async () => {
  const ctx = mock();
  for (const [command, flags, key] of [
    ["+record-list", { ...target, "record-id": "rec_only" }, "record-id"],
    ["+field-list", { ...target, "filter-json": {} }, "filter-json"],
    ["+table-list", { "base-token": "app1", json: { filter: {} } }, "json"],
    [
      "+record-batch-create",
      {
        ...target,
        json: { records: [{ fields: { Name: "A" } }] },
        "page-all": true,
      },
      "page-all",
    ],
  ]) {
    await assert.rejects(
      executeTables(ctx, "base", command, flags),
      new RegExp(`--${key} is unsupported`),
    );
  }
  await assert.rejects(
    executeTables(ctx, "base", "+record-batch-create", {
      ...target,
      json: { fields: ["Amount", " Amount "], rows: [[12, 34]] },
    }),
    /distinct field names/,
  );
  assert.deepEqual(ctx.requests, []);
});

test("7.54 Base metadata, form metadata and dashboard lists preserve identifiers", async () => {
  const baseCtx = mock({
    app: { app_token: "app1", name: "Budget", revision: 5 },
  });
  const metadata = await executeTables(baseCtx, "base", "+base-get", {
    "base-token": "app1",
  });
  assert.equal(baseCtx.requests[0].url, "/open-apis/bitable/v1/apps/app1");
  assert.equal(metadata.base.base_token, "app1");
  assert.equal(metadata.base.revision, 5);
  assert.equal(metadata.app.name, "Budget");
  const formCtx = mock({ form: { name: "Survey", shared: false } });
  const form = await executeTables(formCtx, "base", "+form-get", {
    ...target,
    "form-id": "v/a",
  });
  assert.equal(formCtx.requests[0].url, base + "/tbl1/forms/v%2Fa");
  assert.equal(form.name, "Survey");
  assert.equal(form.shared, false);
  const dashCtx = mock({
    dashboards: [{ name: "Q4", block_id: "blk1" }],
    page_token: "more",
    has_more: true,
  });
  const dashboard = await executeTables(dashCtx, "base", "+dashboard-list", {
    "base-token": "app1",
    "page-size": 500,
    "page-token": "prev",
  });
  assert.deepEqual(dashCtx.requests[0], {
    method: "GET",
    url: "/open-apis/bitable/v1/apps/app1/dashboards",
    query: { page_size: 500, page_token: "prev" },
  });
  assert.equal(dashboard.dashboards[0].dashboard_id, "blk1");
  assert.equal(dashboard.page_token, "more");
});

test("7.54 table, field and view lookup use full visible schema lists and exact identifiers", async () => {
  const table = { name: "计划", table_id: "tbl1", revision: 3 };
  const field = {
    field_name: "负责人",
    field_id: "fldA",
    type: 11,
    property: { multiple: false },
  };
  const view = { view_name: "看板", view_id: "vewA", view_type: "kanban" };
  const feeds = {
    [base]: [table],
    [base + "/tbl1/fields"]: [field],
    [base + "/tbl1/views"]: [view],
  };
  const ctx = mock();
  ctx.paginate = async (method, url, opts) => {
    assert.deepEqual(opts, { query: { page_size: 100 }, itemsKey: "items" });
    ctx.requests.push({ method, url });
    return { items: feeds[url], has_more: false };
  };
  const result = await executeTables(ctx, "base", "+table-get", {
    "base-token": "app1",
    "table-id": "计划",
  });
  assert.deepEqual(result, { table, fields: [field], views: [view] });
  assert.deepEqual(
    ctx.requests.map(({ url }) => url),
    [base, base + "/tbl1/fields", base + "/tbl1/views"],
  );
  for (const [cmd, arg, name, resultKey, expected] of [
    ["+field-get", "field-id", "负责人", "field", field],
    ["+view-get", "view-id", "vewA", "view", view],
  ]) {
    const detail = await executeTables(ctx, "base", cmd, {
      ...target,
      [arg]: name,
    });
    assert.deepEqual(detail[resultKey], expected);
  }
  await assert.rejects(
    executeTables(ctx, "base", "+field-get", {
      ...target,
      "field-id": "missing",
    }),
    /No visible field/,
  );
  const views = await executeTables(
    mock({ items: [view] }),
    "base",
    "+view-list",
    { ...target, limit: 2 },
  );
  assert.deepEqual(views.views, [view]);
  feeds[base].push({ name: "计划", table_id: "tbl2" });
  await assert.rejects(
    executeTables(ctx, "base", "+table-get", { ...target, "table-id": "计划" }),
    /Ambiguous table/,
  );
  ctx.paginate = async () => ({
    items: [table],
    has_more: true,
    truncated: true,
  });
  await assert.rejects(
    executeTables(ctx, "base", "+table-get", target),
    /Incomplete Bitable schema/,
  );
});

test("7.54 record-get preserves requested order, chunks over 100, reports missing and forbidden IDs", async () => {
  const ids = Array.from({ length: 101 }, (_, i) => "rec" + i);
  const ctx = mock();
  ctx.request = async (method, url, options) => {
    ctx.requests.push({ method, url, options });
    return {
      records: options.body.record_ids
        .filter((id) => !["rec4", "rec5"].includes(id))
        .reverse()
        .map((record_id) => ({ record_id, fields: { Name: record_id } })),
      absent_record_ids: options.body.record_ids.filter((id) => id === "rec4"),
      forbidden_record_ids: options.body.record_ids.filter(
        (id) => id === "rec5",
      ),
    };
  };
  const flags = {
    ...target,
    json: { record_id_list: ids, automatic_fields: false },
    "user-id-type": "open_id",
    format: "json",
  };
  const result = await executeTables(ctx, "base", "+record-get", flags);
  assert.equal(ctx.requests.length, 2);
  for (const [i, req] of ctx.requests.entries()) {
    assert.equal(req.method, "POST");
    assert.equal(req.url, base + "/tbl1/records/batch_get");
    assert.deepEqual(req.options, {
      body: {
        record_ids: ids.slice(100 * i, 100 * (i + 1)),
        automatic_fields: false,
        user_id_type: "open_id",
      },
    });
  }
  assert.deepEqual(
    result.record_id_list,
    ids.filter((id) => !["rec4", "rec5"].includes(id)),
  );
  assert.deepEqual(result.data[0], ["rec0"]);
  assert.deepEqual(result.absent_record_ids, ["rec4"]);
  assert.deepEqual(result.forbidden_record_ids, ["rec5"]);
  const rendered = await executeTables(ctx, "base", "+record-get", {
    ...target,
    "record-id": ["rec4", "rec5"],
  });
  assert.match(rendered.__raw, /Missing records: rec4/);
  assert.match(rendered.__raw, /Access denied for records: rec5/);
});

test("7.54 record-get never silently ignores a projection, duplicate selector or unsupported body", async () => {
  const ctx = mock();
  for (const options of [
    { "record-id": "r", "field-id": "Name" },
    { json: { select_fields: ["Name"], record_id_list: ["r"] } },
    { "record-id": "r", json: { record_ids: ["r"] } },
    { json: { foo: true, record_ids: ["r"] } },
    { json: { record_ids: [" r", "r"] } },
  ])
    await assert.rejects(
      executeTables(ctx, "base", "+record-get", { ...target, ...options }),
    );
  assert.deepEqual(ctx.requests, []);
});

test("eight additional 7.54 read shortcuts reach catalogued Bitable v1 routes from the executable", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "hn-base-read-"));
  t.after(() => rm(dir, { force: true, recursive: true }));
  const cli = fileURLToPath(new URL("../bin/lark-ka.mjs", import.meta.url));
  const env = { PATH: process.env.PATH, LARK_KA_CONFIG_DIR: dir };
  const run = (...args) =>
    JSON.parse(
      execFileSync(process.execPath, [cli, ...args], { env, encoding: "utf8" }),
    );
  run(
    "config",
    "init",
    "--name",
    "cnooc",
    "--brand",
    "custom",
    "--app-id",
    "cli_test",
    "--open-base-url",
    "https://open.test.invalid",
  );
  const root = "/open-apis/bitable/v1/apps/app1";
  const table = root + "/tables/tbl1";
  const tableArgs = ["--table-id", "tbl1"];
  for (const [command, args, expected] of [
    ["+base-get", [], [root]],
    [
      "+table-get",
      tableArgs,
      [root + "/tables", table + "/fields", table + "/views"],
    ],
    ["+field-get", [...tableArgs, "--field-id", "fld1"], [table + "/fields"]],
    ["+view-get", [...tableArgs, "--view-id", "vew1"], [table + "/views"]],
    ["+view-list", tableArgs, [table + "/views"]],
    ["+form-get", [...tableArgs, "--form-id", "vew1"], [table + "/forms/vew1"]],
    [
      "+record-get",
      [...tableArgs, "--record-id", "rec1"],
      [table + "/records/batch_get"],
    ],
    ["+dashboard-list", [], [root + "/dashboards"]],
  ]) {
    const { data } = run(
      "--profile",
      "cnooc",
      "base",
      command,
      "--base-token",
      "app1",
      ...args,
      "--as",
      "user",
      "--dry-run",
    );
    assert.deepEqual(
      data.requests.map((r) => r.path),
      expected,
    );
    assert.ok(
      data.requests.every(
        (r) => r.method === (command === "+record-get" ? "POST" : "GET"),
      ),
    );
    if (command === "+record-get")
      assert.deepEqual(data.requests[0].data, { record_ids: ["rec1"] });
  }
});
