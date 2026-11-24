import assert from "node:assert/strict";
import test from "node:test";
import {
  executeTables,
  isHaiNengBaseShortcut,
} from "../src/domains/tables.mjs";

const app = "/open-apis/bitable/v1/apps/bascnFixture";
const tables = app + "/tables";
const records = tables + "/tblFixture/records";
const base = { "base-token": "bascnFixture" };
const target = { ...base, "table-id": "tblFixture" };

function context(reply = () => ({})) {
  const requests = [];
  return {
    config: { brand: "cnooc" },
    identity: "user",
    requests,
    input: async (value) => value,
    request: async (method, url, options) => {
      requests.push({ method, url, ...options });
      return reply(method, url);
    },
  };
}

test("HaiNeng creates a table with native fields, then creates optional views on the new ID", async () => {
  const ctx = context((_, url) =>
    url === tables
      ? {
          table_id: "tblNew",
          default_view_id: "vewDefault",
          field_id_list: ["fld1", "fld2"],
        }
      : { view: { view_id: "vewNew", view_name: "卡片", view_type: "kanban" } },
  );
  const output = await executeTables(ctx, "base", "+table-create", {
    ...base,
    name: " 工作清单 ",
    fields: [
      { name: "标题", type: "text", description: "任务标题" },
      { name: "状态", type: "select", options: [{ name: "待办" }] },
    ],
    view: '{"name":"卡片","type":"kanban"}',
  });
  assert.deepEqual(ctx.requests, [
    {
      method: "POST",
      url: tables,
      body: {
        table: {
          name: "工作清单",
          fields: [
            { field_name: "标题", type: 1, description: { text: "任务标题" } },
            {
              field_name: "状态",
              type: 3,
              property: { options: [{ name: "待办" }] },
            },
          ],
        },
      },
    },
    {
      method: "POST",
      url: tables + "/tblNew/views",
      body: { view_name: "卡片", view_type: "kanban" },
    },
  ]);
  assert.equal(output.table.default_view_id, "vewDefault");
  assert.deepEqual(output.table.field_id_list, ["fld1", "fld2"]);
  assert.equal(output.views.length, 1);
});

test("HaiNeng table creation validates optional writes first and exposes a partially-created table", async () => {
  const ctx = context((_, url) => {
    if (url === tables) return { table_id: "tblNew" };
    throw Error("view not writable");
  });
  await assert.rejects(
    executeTables(ctx, "base", "+table-create", {
      ...base,
      name: "项目",
      fields: [{ name: "状态", type: "select" }],
    }),
    /index field type/,
  );
  await assert.rejects(
    executeTables(ctx, "base", "+table-create", {
      ...base,
      name: "项目",
      view: { name: "日历", type: "calendar" },
    }),
    /Bitable v1 view type/,
  );
  assert.deepEqual(ctx.requests, []);
  await assert.rejects(
    executeTables(ctx, "base", "+table-create", {
      ...base,
      name: "项目",
      view: { name: "网格" },
    }),
    (error) =>
      error.type === "partial_success" &&
      error.detail.table.table_id === "tblNew" &&
      error.detail.viewError === "view not writable",
  );
  assert.equal(ctx.requests.length, 2);
});

test("HaiNeng record batch updates translate both shared patches and native rows", async () => {
  const response = {
    records: [{ record_id: "rec1", fields: { Status: "Done" } }],
  };
  const ctx = context(() => response);
  const patch = { Status: "Done" };
  const out = await executeTables(ctx, "base", "+record-batch-update", {
    ...target,
    "user-id-type": "open_id",
    json: { record_id_list: ["rec1"], patch },
  });
  assert.deepEqual(ctx.requests, [
    {
      method: "POST",
      url: records + "/batch_update",
      query: { user_id_type: "open_id" },
      body: { records: [{ record_id: "rec1", fields: patch }] },
    },
  ]);
  assert.deepEqual(out, {
    ...response,
    record_id_list: ["rec1"],
    update: patch,
  });
  const native = [
    { record_id: "rec1", fields: { Status: "Todo" } },
    { record_id: "rec2", fields: { Status: "Done" } },
  ];
  await executeTables(ctx, "base", "+record-batch-update", {
    ...target,
    json: { records: native },
  });
  assert.deepEqual(ctx.requests[1].body, { records: native });
  await assert.rejects(
    executeTables(ctx, "base", "+record-batch-update", {
      ...target,
      json: { record_id_list: ["rec1", " rec1 "], patch },
    }),
    /distinct after trimming/,
  );
  assert.equal(ctx.requests.length, 2);
});

test("HaiNeng record deletion retains --yes and only reports confirmed deletions", async () => {
  const outcome = [
    { record_id: "rec1", deleted: true },
    { record_id: "rec2", deleted: false },
  ];
  const ctx = context(() => ({ records: outcome }));
  const f = { ...target, "record-id": ["rec1", "rec2"] };
  await assert.rejects(
    executeTables(ctx, "base", "+record-delete", f),
    (error) => error.code === 10,
  );
  assert.deepEqual(ctx.requests, []);
  const out = await executeTables(ctx, "base", "+record-delete", {
    ...f,
    yes: true,
  });
  assert.deepEqual(ctx.requests, [
    {
      method: "POST",
      url: records + "/batch_delete",
      body: { records: ["rec1", "rec2"] },
    },
  ]);
  assert.deepEqual(out, { records: outcome, record_id_list: ["rec1"] });
});

test("HaiNeng Base copy preserves the copy options and resolves the new app token", async () => {
  const copied = { app_token: "bascnCopy", name: "Snapshot" };
  const ctx = context(() => ({ app: copied }));
  const result = await executeTables(ctx, "base", "+base-copy", {
    ...base,
    name: copied.name,
    "time-zone": "Asia/Shanghai",
    "folder-token": "fldFixture",
    "without-content": true,
  });
  assert.deepEqual(ctx.requests, [
    {
      method: "POST",
      url: app + "/copy",
      body: {
        name: copied.name,
        time_zone: "Asia/Shanghai",
        folder_token: "fldFixture",
        without_content: true,
      },
    },
  ]);
  assert.deepEqual(result, {
    app: copied,
    base: { ...copied, base_token: copied.app_token },
    copied: true,
  });
  assert.equal(isHaiNengBaseShortcut("+base-copy"), true);
  assert.equal(isHaiNengBaseShortcut("base-copy"), false);
  assert.equal(isHaiNengBaseShortcut("+record-upsert"), false);
});
