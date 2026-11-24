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
      if (path.includes("sheet_ai"))
        return {
          output: JSON.stringify({
            sheets: [{ sheet_id: "sheet1", name: "Sheet1", index: 0 }],
          }),
        };
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
    executeTables(context(), "sheets", "+sheet-delete", sheet),
    (error) => error.code === 10,
  );
  assert.equal(
    await executeTables(context(), "other", "+not-a-command", {}),
    undefined,
  );
});

test("Sheets read and write tools use correct endpoint, serialized input, and workbook selector", async () => {
  const ctx = context();
  await executeTables(ctx, "sheets", "+cells-get", {
    ...sheet,
    range: "A1:B2",
    include: "formula,style",
  });
  assert.equal(
    ctx.requests[0].path,
    "/open-apis/sheet_ai/v2/spreadsheets/ss1/tools/invoke_read",
  );
  assert.equal(ctx.requests[0].body.tool_name, "get_cell_ranges");
  const read = JSON.parse(ctx.requests[0].body.input);
  assert.deepEqual(read.ranges, ["A1:B2"]);
  assert.equal(read.include_styles, true);
  assert.equal(read.value_render_option, "formula");
  assert.equal(read.cell_limit, 1000000000);
  await executeTables(ctx, "sheets", "+cells-set", {
    ...sheet,
    range: "A1",
    cells: '[[{"value":1}]]',
    "allow-overwrite": false,
  });
  assert.match(ctx.requests[1].path, /invoke_write$/);
  assert.equal(JSON.parse(ctx.requests[1].body.input).allow_overwrite, false);
});

test("Sheets selectors, required flags, and output decoding fail explicitly", async () => {
  await assert.rejects(
    executeTables(context(), "sheets", "+cells-get", {
      ...sheet,
      url: "https://example.test/sheets/ss2",
      range: "A1",
    }),
    /exactly one/,
  );
  await assert.rejects(
    executeTables(context(), "sheets", "+cells-get", {
      ...sheet,
      "sheet-name": "Sheet1",
      range: "A1",
    }),
    /mutually exclusive/,
  );
  await assert.rejects(
    executeTables(context(), "sheets", "+cells-set", { ...sheet, range: "A1" }),
    /--cells is required/,
  );
  await assert.rejects(
    executeTables(
      context({ response: () => ({ output: "broken" }) }),
      "sheets",
      "+workbook-info",
      { "spreadsheet-token": "ss1" },
    ),
    /invalid JSON output/,
  );
});

test("Sheets clear, fill and copy translate CLI vocabulary into tool values", async () => {
  const ctx = context();
  await executeTables(ctx, "sheets", "+cells-clear", {
    ...sheet,
    range: "A1:B2",
    yes: true,
  });
  assert.equal(JSON.parse(ctx.requests[0].body.input).clear_type, "contents");
  await executeTables(ctx, "sheets", "+range-copy", {
    ...sheet,
    "source-range": "A1",
    "target-range": "B1",
    "paste-type": "values",
  });
  assert.equal(JSON.parse(ctx.requests[1].body.input).paste_type, "value_only");
  await executeTables(ctx, "sheets", "+range-fill", {
    ...sheet,
    "source-range": "A1",
    "target-range": "A2:A5",
    "series-type": "copy",
  });
  assert.equal(JSON.parse(ctx.requests[2].body.input).fill_type, "copyCells");
});

test("Sheets object creation handles placement selector and hoisted object fields", async () => {
  const ctx = context();
  await executeTables(ctx, "sheets", "+pivot-create", {
    "spreadsheet-token": "ss1",
    source: "'Data'!A1:D10",
    properties: '{"rows":[]}',
  });
  assert.equal(ctx.requests[0].body.tool_name, "manage_pivot_table_object");
  const pivot = JSON.parse(ctx.requests[0].body.input);
  assert.equal(pivot.sheet_id, undefined);
  assert.equal(pivot.properties.source, "'Data'!A1:D10");
  await executeTables(ctx, "sheets", "+filter-view-create", {
    ...sheet,
    range: "A1:D10",
    "view-name": "View",
    properties: "{}",
  });
  assert.equal(
    JSON.parse(ctx.requests[1].body.input).properties.view_name,
    "View",
  );
  await executeTables(ctx, "sheets", "+cond-format-create", {
    ...sheet,
    "rule-type": "cellIs",
    ranges: '["A1:B2"]',
    properties: '{"style":{}}',
  });
  assert.deepEqual(JSON.parse(ctx.requests[2].body.input).properties.ranges, [
    "A1:B2",
  ]);
});

test("dimension move uses the v3 path with snake-case indices", async () => {
  const ctx = context();
  await executeTables(ctx, "sheets", "+dim-move", {
    ...sheet,
    "source-range": "3:5",
    target: "10",
  });
  assert.equal(
    ctx.requests[0].path,
    "/open-apis/sheets/v3/spreadsheets/ss1/sheets/sheet1/move_dimension",
  );
  assert.deepEqual(ctx.requests[0].body, {
    source: { major_dimension: "ROWS", start_index: 2, end_index: 5 },
    destination_index: 9,
  });
});

test("atomic batch uses per-shortcut translation instead of guessed raw operations", async () => {
  const ctx = context();
  await executeTables(ctx, "sheets", "+batch-update", {
    "spreadsheet-token": "ss1",
    yes: true,
    operations:
      '[{"shortcut":"+cells-set","input":{"sheet_id":"sheet1","range":"A1","cells":[[{"value":1}]]}},{"shortcut":"+sheet-rename","input":{"sheet_id":"sheet1","title":"New"}}]',
  });
  const input = JSON.parse(ctx.requests[0].body.input);
  assert.equal(ctx.requests[0].body.tool_name, "batch_update");
  assert.equal(input.operations[0].tool_name, "set_cell_range");
  assert.equal(input.operations[1].input.operation, "rename");
  assert.equal(input.operations[1].input.new_name, "New");
  await assert.rejects(
    executeTables(context(), "sheets", "+batch-update", {
      "spreadsheet-token": "ss1",
      yes: true,
      operations: '[{"shortcut":"+cells-get","input":{}}]',
    }),
    /cannot participate/,
  );
});

test("batch range formatting requires explicit sheet names and produces a single batch tool request", async () => {
  const ctx = context();
  await executeTables(ctx, "sheets", "+cells-batch-clear", {
    "spreadsheet-token": "ss1",
    yes: true,
    ranges: '["\u0027Sheet 1\u0027!A1:B2","Other!D3"]',
  });
  const input = JSON.parse(ctx.requests[0].body.input);
  assert.equal(input.operations.length, 2);
  assert.equal(input.operations[0].input.sheet_name, "Sheet 1");
  assert.equal(input.operations[1].input.range, "D3");
});

test("composite schema introspection needs no credentials or network requests", async () => {
  const ctx = context();
  const result = await executeTables(ctx, "sheets", "+chart-create", {
    "print-schema": true,
    "flag-name": "properties",
  });
  assert.equal(result.flag, "properties");
  assert.equal(result.schema.type, "object");
  assert.equal(ctx.requests.length, 0);
});

test("spreadsheet initial fill reports partial success without losing the created workbook", async () => {
  const ctx = context({
    response: (r) =>
      r.path === "/open-apis/sheets/v3/spreadsheets"
        ? { spreadsheet: { spreadsheet_token: "createdToken" } }
        : { output: "{}" },
  });
  await assert.rejects(
    executeTables(ctx, "sheets", "+workbook-create", {
      title: "New",
      headers: '["Name"]',
    }),
    (e) =>
      e.type === "partial_success" &&
      e.detail.spreadsheet_token === "createdToken",
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

test("CSV row output preserves quoted newlines and reports unread data structurally", async () => {
  const data = {
    annotated_csv: '[row=2],Alice,"line1\nline2"\n[row=3],Bob,done',
    col_indices: ["B", "C"],
    actual_range: "B2:C3",
    current_region: "B2:C10",
    warning_message: "warning",
  };
  const ctx = context({ response: () => ({ output: JSON.stringify(data) }) });
  const result = await executeTables(ctx, "sheets", "+csv-get", {
    ...sheet,
    range: "B2:C3",
    "rows-json": true,
  });
  assert.deepEqual(result.rows[0], {
    row_number: 2,
    values: { B: "Alice", C: "line1\nline2" },
  });
  assert.equal(result.data_not_fully_read.unread_rows, 7);
  assert.equal(result.annotated_csv, undefined);
  const plain = await executeTables(ctx, "sheets", "+csv-get", {
    ...sheet,
    range: "B2:C3",
    "include-row-prefix": false,
  });
  assert.ok(!plain.annotated_csv.includes("[row="));
});

test("embedded images upload bytes and carry decoded dimensions into a single cell", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lark-sheet-image-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(
    path.join(dir, "tiny.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6aWQAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const ctx = context({
    response: (r) =>
      r.path.includes("/medias/")
        ? { file_token: "file_image" }
        : { output: '{"updated":true}' },
  });
  ctx.cwd = dir;
  const result = await executeTables(ctx, "sheets", "+cells-set-image", {
    ...sheet,
    range: "A1",
    image: "tiny.png",
    name: "named.png",
  });
  assert.equal(ctx.requests[0].body.get("file_name"), "named.png");
  const image = JSON.parse(ctx.requests[1].body.input).cells[0][0].rich_text[0];
  assert.equal(image.image_width, 1);
  assert.equal(image.image_height, 1);
  assert.equal(result.file_token, "file_image");
  assert.equal(result.set_cell_range.updated, true);
  await assert.rejects(
    executeTables(ctx, "sheets", "+cells-set-image", {
      ...sheet,
      range: "A1:B2",
      image: "tiny.png",
    }),
    /exactly one cell/,
  );
});

test("composite schema rejects missing chart properties before making a request", async () => {
  const ctx = context();
  await assert.rejects(
    executeTables(ctx, "sheets", "+chart-create", {
      ...sheet,
      properties: "{}",
    }),
    /required/,
  );
  assert.equal(ctx.requests.length, 0);
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
