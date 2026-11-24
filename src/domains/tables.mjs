import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { CliError } from "../errors.mjs";
import { isHaiNengProfile } from "../config.mjs";
import { shortcuts as catalog } from "../metadata.mjs";
import { setTimeout as delay } from "node:timers/promises";

const defs = JSON.parse(
  readFileSync(new URL("../../data/sheets/flag-defs.json", import.meta.url)),
);
const schemas = JSON.parse(
  readFileSync(new URL("../../data/sheets/flag-schemas.json", import.meta.url)),
).flags;
const baseV3Module = new URL("./base-v3.mjs", import.meta.url);
const hasSourceBaseV3 = existsSync(baseV3Module);
export const commandSpecs = {
  base: Object.fromEntries(
    catalog.filter((x) => x.service === "base").map((x) => [x.command, x]),
  ),
  sheets: {
    ...Object.fromEntries(
      catalog.filter((x) => x.service === "sheets").map((x) => [x.command, x]),
    ),
    ...defs,
  },
};
const has = (o, k) => Object.hasOwn(o, k);
const clean = (o) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const yes = (v) => v === true || v === "true";
const fail = (message, detail) => {
  throw new CliError("validation", message, { detail });
};
const required = (f, k) => {
  const v = f[k];
  if (v === undefined || v === "" || v === true) fail(`--${k} is required`);
  return v;
};
const enc = (v) => encodeURIComponent(String(v));
const ints = (f, k, fallback, min = 0, max = Infinity) => {
  const n = Number(f[k] ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max)
    fail(`--${k} must be an integer between ${min} and ${max}`);
  return n;
};
const list = (v) =>
  (Array.isArray(v) ? v : String(v ?? "").split(","))
    .map((x) => String(x).trim())
    .filter(Boolean);
const pick = (f, names) =>
  clean(
    Object.fromEntries(
      names.filter((k) => has(f, k)).map((k) => [k.replaceAll("-", "_"), f[k]]),
    ),
  );
async function json(ctx, raw, name, type = "object", fallback) {
  if (raw === undefined) {
    if (fallback !== undefined) return structuredClone(fallback);
    fail(`--${name} is required`);
  }
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(await ctx.input(raw));
    } catch (e) {
      if (e instanceof CliError) throw e;
      fail(`--${name} must contain valid JSON`);
    }
  }
  if (
    type === "array"
      ? !Array.isArray(value)
      : !value || typeof value !== "object" || Array.isArray(value)
  )
    fail(`--${name} must be a JSON ${type}`);
  return value;
}
async function req(ctx, method, url, query, body) {
  const result = await ctx.request(method, url, clean({ query, body }));
  if (
    result &&
    typeof result === "object" &&
    has(result, "code") &&
    has(result, "data")
  ) {
    if (Number(result.code) !== 0)
      throw new CliError(
        "api",
        result.msg ?? result.message ?? "Base operation failed",
        { code: 5, detail: { apiCode: result.code } },
      );
    return result.data;
  }
  return result;
}
function uniqueStrings(values, name, max) {
  if (
    !Array.isArray(values) ||
    !values.length ||
    values.some((x) => typeof x !== "string" || !x.trim())
  )
    fail(`${name} must be a non-empty string array`);
  if (values.length > max || new Set(values).size !== values.length)
    fail(`${name} must contain at most ${max} distinct values`);
  return values.map((x) => x.trim());
}
async function safeFile(ctx, filename, output = false) {
  if (
    typeof filename !== "string" ||
    !filename ||
    /[\u0000-\u001f]/u.test(filename) ||
    filename.split(/[\\/]/).includes("..")
  )
    fail("File path must not contain control characters or parent traversal");
  const cwd = path.resolve(ctx.cwd ?? process.cwd());
  const file = path.resolve(cwd, filename.replace(/^@/, ""));
  const physicalRoot = await realpath(cwd);
  const physical = output
    ? path.join(await realpath(path.dirname(file)), path.basename(file))
    : await realpath(file);
  const relative = path.relative(physicalRoot, physical);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    fail("File path must stay within the working directory");
  if (!output && !(await stat(file)).isFile())
    fail("File path must point to a regular file");
  return file;
}
async function upload(
  ctx,
  filename,
  parentNode,
  parentType,
  extra,
  displayName,
) {
  if (ctx.dryRun) {
    if (
      typeof filename !== "string" ||
      !filename ||
      /[\u0000-\u001f]/u.test(filename) ||
      filename.split(/[\\/]/).includes("..") ||
      path.isAbsolute(filename)
    )
      fail("Upload path must be relative without traversal");
    const name = displayName || path.basename(filename);
    let size = "<file_size>";
    try {
      size = (await stat(path.resolve(ctx.cwd ?? process.cwd(), filename)))
        .size;
    } catch {}
    const fields = clean({
      file_name: name,
      parent_type: parentType,
      parent_node: parentNode,
      size,
      extra,
    });
    if (typeof size === "number" && size > 20 * 1024 ** 2) {
      await req(
        ctx,
        "POST",
        "/open-apis/drive/v1/medias/upload_prepare",
        undefined,
        fields,
      );
      await req(
        ctx,
        "POST",
        "/open-apis/drive/v1/medias/upload_part",
        undefined,
        {
          upload_id: "<upload_id>",
          seq: "<part_index>",
          size: "<part_size>",
          file: `@${filename}`,
        },
      );
      await req(
        ctx,
        "POST",
        "/open-apis/drive/v1/medias/upload_finish",
        undefined,
        { upload_id: "<upload_id>", block_num: "<part_count>" },
      );
    } else
      await req(
        ctx,
        "POST",
        "/open-apis/drive/v1/medias/upload_all",
        undefined,
        { ...fields, file: `@${filename}` },
      );
    return { file_token: "<uploaded_file_token>", name, size };
  }
  const file = await safeFile(ctx, filename);
  const info = await stat(file);
  const name = displayName || path.basename(file);
  const fields = clean({
    file_name: name,
    parent_type: parentType,
    parent_node: parentNode,
    size: info.size,
    extra,
  });
  if (info.size > 2 * 1024 ** 3) fail("Attachments must be at most 2 GiB");
  if (info.size <= 20 * 1024 ** 2) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields))
      form.set(key, String(value));
    form.set("file", new Blob([await readFile(file)]), name);
    const result = await req(
      ctx,
      "POST",
      "/open-apis/drive/v1/medias/upload_all",
      undefined,
      form,
    );
    if (!result.file_token)
      throw new CliError("api", "Upload response has no file_token", {
        code: 5,
      });
    return { file_token: result.file_token, name, size: info.size };
  }
  const ready = await req(
    ctx,
    "POST",
    "/open-apis/drive/v1/medias/upload_prepare",
    undefined,
    fields,
  );
  if (!ready.upload_id || !(ready.block_size > 0))
    throw new CliError(
      "api",
      "Multipart upload returned no upload_id/block_size",
      { code: 5 },
    );
  const bytes = await readFile(file);
  const count = Math.ceil(bytes.length / ready.block_size);
  for (let i = 0; i < count; i++) {
    const part = bytes.subarray(
      i * ready.block_size,
      (i + 1) * ready.block_size,
    );
    const form = new FormData();
    for (const [k, v] of Object.entries({
      upload_id: ready.upload_id,
      seq: i,
      size: part.length,
    }))
      form.set(k, String(v));
    form.set("file", new Blob([part]), name);
    await req(
      ctx,
      "POST",
      "/open-apis/drive/v1/medias/upload_part",
      undefined,
      form,
    );
  }
  const done = await req(
    ctx,
    "POST",
    "/open-apis/drive/v1/medias/upload_finish",
    undefined,
    { upload_id: ready.upload_id, block_num: count },
  );
  if (!done.file_token)
    throw new CliError(
      "api",
      "Multipart upload finish response has no file_token",
      { code: 5 },
    );
  return { file_token: done.file_token, name, size: info.size };
}

const bitablePagingFlags = [
  "offset",
  "limit",
  "page-size",
  "page-token",
  "page-all",
  "page-limit",
  "page-delay",
];
const bitableRecordFlags = [
  ...bitablePagingFlags,
  "table-id",
  "view-id",
  "field-id",
  "filter-json",
  "sort-json",
  "user-id-type",
];
const bitableV1Flags = {
  "base-create": ["name", "folder-token", "time-zone"],
  "base-copy": ["name", "folder-token", "time-zone", "without-content"],
  "base-get": [],
  "table-create": ["name", "fields", "view"],
  "table-get": ["table-id"],
  "table-list": bitablePagingFlags,
  "field-get": ["table-id", "field-id"],
  "field-list": [...bitablePagingFlags, "table-id"],
  "view-get": ["table-id", "view-id"],
  "view-list": [...bitablePagingFlags, "table-id"],
  "record-get": ["table-id", "record-id", "field-id", "user-id-type"],
  "record-list": bitableRecordFlags,
  "record-search": [...bitableRecordFlags, "keyword", "search-field"],
  "record-batch-create": ["table-id", "client-token", "user-id-type"],
  "record-batch-update": ["table-id", "user-id-type"],
  "record-delete": ["table-id", "record-id"],
  "form-get": ["table-id", "form-id"],
  "dashboard-list": ["page-size", "page-token", "page-all", "page-limit"],
};
export function isHaiNengBaseShortcut(command) {
  return (
    typeof command === "string" &&
    command.startsWith("+") &&
    has(bitableV1Flags, command.slice(1))
  );
}
const bitableGlobalFlags = [
  "base-token",
  "as",
  "profile",
  "format",
  "json",
  "jq",
  "output",
  "dry-run",
  "help",
  "yes",
  "force",
  "quiet",
  "verbose",
  "debug",
  "no-color",
];
const bitableAppsPath = "/open-apis/bitable/v1/apps";

function onlyKeys(object, allowed, label) {
  const unknown = Object.keys(object).find((k) => !allowed.includes(k));
  if (unknown)
    fail(`${label} does not support '${unknown}' with the Bitable v1 API`);
}

function bitableNames(value, label, max) {
  const names = uniqueStrings(value, label, max);
  if (new Set(names).size !== names.length)
    fail(
      `${label} must contain distinct field names after trimming whitespace`,
    );
  if (names.some((name) => /^fld[A-Za-z0-9]{7,}$/.test(name)))
    fail(
      `${label} requires field names for Bitable v1; get the names with base +field-list`,
    );
  return names;
}

function bitableCreateRecords(input) {
  if (has(input, "records")) {
    onlyKeys(input, ["records"], "--json");
    if (
      !Array.isArray(input.records) ||
      !input.records.length ||
      input.records.length > 500
    )
      fail("--json.records must contain 1..500 records");
    for (const record of input.records) {
      if (
        !record ||
        typeof record !== "object" ||
        !record.fields ||
        typeof record.fields !== "object" ||
        Array.isArray(record.fields)
      )
        fail("Each record requires a fields object keyed by field name");
      onlyKeys(record, ["fields"], "--json.records[]");
    }
    return input;
  }
  onlyKeys(input, ["fields", "rows"], "--json");
  const names = bitableNames(input.fields, "--json.fields", 200);
  if (
    !Array.isArray(input.rows) ||
    !input.rows.length ||
    input.rows.length > 500
  )
    fail("--json.rows must contain 1..500 rows");
  return {
    records: input.rows.map((row) => {
      if (!Array.isArray(row) || row.length !== names.length)
        fail("Each --json.rows entry must match the number of fields");
      return {
        fields: Object.fromEntries(names.map((name, i) => [name, row[i]])),
      };
    }),
  };
}

const bitableFieldTypes = {
  text: 1,
  number: 2,
  datetime: 5,
  checkbox: 7,
  user: 11,
  attachment: 17,
  location: 22,
  group_chat: 23,
  created_at: 1001,
  updated_at: 1002,
  created_by: 1003,
  updated_by: 1004,
  auto_number: 1005,
};

function bitableTableField(field) {
  if (!field || typeof field !== "object" || Array.isArray(field))
    fail("Each --fields entry must be an object");
  const name = field.name ?? field.field_name;
  if (typeof name !== "string" || !name.trim())
    fail("Each --fields entry requires a field_name or name");
  if (field.name !== undefined && field.field_name !== undefined)
    fail("Specify a field name once using name or field_name");
  if (Number.isInteger(field.type)) {
    onlyKeys(
      field,
      ["field_name", "name", "type", "ui_type", "property", "description"],
      "--fields[]",
    );
    return clean({
      field_name: name.trim(),
      type: field.type,
      ui_type: field.ui_type,
      property: field.property,
      description: field.description,
    });
  }
  const isSelect = field.type === "select";
  const hasMultiple = ["user", "group_chat", "select"].includes(field.type);
  onlyKeys(
    field,
    [
      "name",
      "field_name",
      "type",
      "description",
      ...(hasMultiple ? ["multiple"] : []),
      ...(isSelect ? ["options"] : []),
    ],
    "--fields[]",
  );
  if (field.multiple !== undefined && typeof field.multiple !== "boolean")
    fail("--fields[].multiple must be a boolean");
  const type = isSelect
    ? field.multiple
      ? 4
      : 3
    : bitableFieldTypes[field.type];
  if (!Number.isInteger(type))
    fail(
      "Use a supported field type or a Bitable v1 numeric type with property",
    );
  if (field.description !== undefined && typeof field.description !== "string")
    fail("--fields[].description must be a string for named field types");
  let property;
  if (isSelect && field.options !== undefined) {
    if (!Array.isArray(field.options))
      fail("--fields[].options must be an array");
    property = {
      options: field.options.map((option) => {
        if (!option || typeof option.name !== "string" || !option.name.trim())
          fail("Each select option requires a name");
        onlyKeys(option, ["name", "color"], "--fields[].options[]");
        if (
          option.color !== undefined &&
          (!Number.isInteger(option.color) ||
            option.color < 0 ||
            option.color > 54)
        )
          fail("Select option color must be an integer from 0 to 54");
        return option;
      }),
    };
  } else if (!isSelect && field.multiple !== undefined) {
    property = { multiple: field.multiple };
  }
  return clean({
    field_name: name.trim(),
    type,
    property,
    description:
      field.description === undefined ? undefined : { text: field.description },
  });
}

async function bitableTableViews(ctx, value) {
  if (value === undefined) return [];
  let raw = value;
  if (typeof value === "string") {
    try {
      const input = await ctx.input(value);
      raw = typeof input === "string" ? JSON.parse(input) : input;
    } catch (error) {
      if (error instanceof CliError) throw error;
      fail("--view must be valid JSON");
    }
  }
  const views = (Array.isArray(raw) ? raw : [raw]).map((view) => {
    if (!view || typeof view !== "object" || Array.isArray(view))
      fail("Each --view entry must be an object");
    onlyKeys(view, ["name", "type", "view_name", "view_type"], "--view[]");
    const name = view.name ?? view.view_name;
    const type = view.type ?? view.view_type ?? "grid";
    if (typeof name !== "string" || !name.trim())
      fail("Each --view entry requires a name");
    if (!["grid", "kanban", "gallery", "gantt", "form"].includes(type))
      fail("Bitable v1 view type must be grid, kanban, gallery, gantt or form");
    if (
      (view.name !== undefined && view.view_name !== undefined) ||
      (view.type !== undefined && view.view_type !== undefined)
    )
      fail("Specify each view name and type once");
    return { view_name: name.trim(), view_type: type };
  });
  if (new Set(views.map((view) => view.view_name)).size !== views.length)
    fail("--view names must be distinct");
  return views;
}

async function bitableTableCreate(ctx, url, f) {
  const name = required(f, "name");
  if (typeof name !== "string" || !name.trim() || [...name.trim()].length > 100)
    fail("--name must contain 1..100 characters");
  const fields = (await json(ctx, f.fields, "fields", "array", [])).map(
    bitableTableField,
  );
  if (fields.length > 300) fail("--fields must contain at most 300 items");
  if (fields.length && ![1, 2, 5, 13, 15, 20, 22].includes(fields[0].type))
    fail("The first field must use a Bitable v1 index field type");
  if (new Set(fields.map((field) => field.field_name)).size !== fields.length)
    fail("--fields names must be distinct");
  const views = await bitableTableViews(ctx, f.view);
  const table = await req(ctx, "POST", url, undefined, {
    table: clean({
      name: name.trim(),
      fields: fields.length ? fields : undefined,
    }),
  });
  const tableId = ctx.dryRun ? "<created_table_id>" : table?.table_id;
  if (typeof tableId !== "string" || !tableId)
    throw new CliError(
      "partial_success",
      "Table creation returned no table_id",
      {
        code: 5,
        hint: "Check the Base before repeating the command.",
      },
    );
  const result = { table };
  if (views.length) {
    result.views = [];
    try {
      for (const view of views)
        result.views.push(
          await req(
            ctx,
            "POST",
            url + "/" + enc(tableId) + "/views",
            undefined,
            view,
          ),
        );
    } catch (error) {
      throw new CliError(
        "partial_success",
        "Table created but a view could not be created",
        {
          code: 5,
          detail: { ...result, viewError: error.message },
          hint: "Use the new table_id to create the missing views.",
        },
      );
    }
  }
  return result;
}

function bitableRecordWriteIds(value, max) {
  const ids = uniqueStrings(value, "record IDs", max);
  if (new Set(ids).size !== ids.length)
    fail("record IDs must be distinct after trimming whitespace");
  return ids;
}

function bitableEditableFields(fields, label) {
  if (
    !fields ||
    typeof fields !== "object" ||
    Array.isArray(fields) ||
    !Object.keys(fields).length
  )
    fail(`${label} must be a non-empty field map`);
  bitableNames(Object.keys(fields), label, 200);
  return fields;
}

async function bitableRecordBatchWrite(ctx, table, action, f) {
  const deleting = action === "record-delete";
  const input =
    deleting && (f.json === true || f.json === undefined)
      ? {}
      : await json(ctx, f.json, "json");
  let records;
  if (deleting) {
    onlyKeys(input, ["records", "record_id_list"], "--json");
    if (
      [f["record-id"], input.records, input.record_id_list].filter(
        (x) => x !== undefined,
      ).length !== 1
    )
      fail(
        "Specify record IDs once using --record-id, --json.record_id_list or --json.records",
      );
    records = bitableRecordWriteIds(
      input.records ?? input.record_id_list ?? list(f["record-id"]),
      input.records !== undefined ? 500 : 200,
    );
  } else if (has(input, "records")) {
    onlyKeys(input, ["records"], "--json");
    if (
      !Array.isArray(input.records) ||
      !input.records.length ||
      input.records.length > 500
    )
      fail("--json.records must contain 1..500 records");
    for (const record of input.records) {
      if (!record || typeof record !== "object" || Array.isArray(record))
        fail("Each record must be an object");
      onlyKeys(record, ["record_id", "fields"], "--json.records[]");
    }
    const ids = bitableRecordWriteIds(
      input.records.map((record) => record.record_id),
      500,
    );
    records = input.records.map((record, i) => ({
      record_id: ids[i],
      fields: bitableEditableFields(record.fields, "--json.records[].fields"),
    }));
  } else {
    onlyKeys(input, ["record_id_list", "patch"], "--json");
    const ids = bitableRecordWriteIds(input.record_id_list, 200);
    const fields = bitableEditableFields(input.patch, "--json.patch");
    records = ids.map((record_id) => ({ record_id, fields }));
  }
  const result = await req(
    ctx,
    "POST",
    table + "/records/" + (deleting ? "batch_delete" : "batch_update"),
    deleting ? undefined : pick(f, ["user-id-type"]),
    { records },
  );
  if (ctx.dryRun) return result;
  if (
    !Array.isArray(result?.records) ||
    result.records.some((record) => typeof record?.record_id !== "string")
  )
    throw new CliError(
      "api",
      "Bitable response does not identify affected records",
      {
        code: 5,
        hint: "Check the table before repeating the command.",
      },
    );
  const affected = deleting
    ? result.records.filter((r) => r.deleted === true)
    : result.records;
  const output = {
    ...result,
    record_id_list: affected.map((r) => r.record_id),
  };
  if (input.patch) {
    const firstFields = affected[0]?.fields ?? {};
    output.update = Object.fromEntries(
      Object.keys(input.patch)
        .filter(
          (key) =>
            has(firstFields, key) &&
            affected.every(
              (record) =>
                JSON.stringify(record.fields?.[key]) ===
                JSON.stringify(firstFields[key]),
            ),
        )
        .map((key) => [key, firstFields[key]]),
    );
  }
  return output;
}

function validateBitableFilter(filter) {
  if (!filter || !["and", "or"].includes(filter.conjunction))
    fail(
      "Bitable v1 filters require conjunction and conditions/children with field_name, operator and value; v3 logic/tuples are unsupported",
    );
  onlyKeys(filter, ["conjunction", "conditions", "children"], "filter");
  if (filter.conditions !== undefined) {
    if (!Array.isArray(filter.conditions))
      fail("filter.conditions must be an array");
    for (const condition of filter.conditions) {
      if (
        !condition ||
        typeof condition.field_name !== "string" ||
        !condition.field_name ||
        typeof condition.operator !== "string" ||
        !condition.operator
      )
        fail("Each Bitable v1 condition requires field_name and operator");
      onlyKeys(
        condition,
        ["field_name", "operator", "value"],
        "filter condition",
      );
    }
  }
  if (filter.children !== undefined) {
    if (!Array.isArray(filter.children))
      fail("filter.children must be an array");
    filter.children.forEach(validateBitableFilter);
  }
}

async function bitableSearchOptions(ctx, action, f) {
  const input =
    f.json === undefined || f.json === true
      ? {}
      : await json(ctx, f.json, "json");
  onlyKeys(
    input,
    [
      "keyword",
      "search_fields",
      "select_fields",
      "field_names",
      "view_id",
      "filter",
      "sort",
      "limit",
      "offset",
      "automatic_fields",
    ],
    "--json",
  );
  for (const [key, flag] of Object.entries({
    keyword: "keyword",
    search_fields: "search-field",
    select_fields: "field-id",
    field_names: "field-id",
    filter: "filter-json",
    sort: "sort-json",
    view_id: "view-id",
  })) {
    if (has(input, key) && f[flag] !== undefined)
      fail(`Specify either --json.${key} or --${flag}`);
  }
  if (
    has(input, "limit") &&
    (ctx.providedFlags?.has("limit") || f["page-size"] !== undefined)
  )
    fail("Specify the Bitable v1 page size once");
  if (has(input, "select_fields") && has(input, "field_names"))
    fail("Specify either --json.select_fields or --json.field_names");
  const projection =
    f["field-id"] !== undefined
      ? list(f["field-id"])
      : (input.field_names ?? input.select_fields);
  const view = f["view-id"] ?? input.view_id;
  let filter =
    f["filter-json"] !== undefined
      ? await json(ctx, f["filter-json"], "filter-json")
      : input.filter;
  if (filter !== undefined) validateBitableFilter(filter);
  const keyword = f.keyword ?? input.keyword;
  const fields =
    f["search-field"] === undefined
      ? input.search_fields
      : list(f["search-field"]);
  if (keyword !== undefined || fields !== undefined) {
    if (typeof keyword !== "string" || !keyword.trim())
      fail("Specify a nonempty search keyword");
    const names = bitableNames(fields, "search fields", 20);
    const match = {
      conjunction: "or",
      conditions: names.map((field_name) => ({
        field_name,
        operator: "contains",
        value: [keyword],
      })),
    };
    filter = filter ? { conjunction: "and", children: [filter, match] } : match;
  }
  if (action === "record-search" && !filter)
    fail("Specify --keyword with --search-field, or a Bitable v1 filter");
  let sort = input.sort;
  if (f["sort-json"] !== undefined) {
    const raw = f["sort-json"];
    const resolved = typeof raw === "string" ? await ctx.input(raw) : raw;
    try {
      sort = typeof resolved === "string" ? JSON.parse(resolved) : resolved;
    } catch {
      fail("--sort-json must contain valid JSON");
    }
    sort = sort?.sort_config ?? sort;
  }
  if (sort !== undefined) {
    if (!Array.isArray(sort)) fail("Bitable v1 sort must be an array");
    sort = sort.map((item) => {
      if (!item || typeof item !== "object" || !(item.field_name ?? item.field))
        fail("Each sort entry requires a field name");
      onlyKeys(item, ["field_name", "field", "desc"], "sort");
      return clean({
        field_name: item.field_name ?? item.field,
        desc: item.desc,
      });
    });
  }
  return {
    body: clean({
      view_id: view,
      field_names:
        projection === undefined
          ? undefined
          : bitableNames(projection, "projected fields", 200),
      filter,
      sort,
      automatic_fields: input.automatic_fields,
    }),
    paging: {
      ...f,
      limit: input.limit ?? f.limit,
      offset: input.offset ?? f.offset,
    },
  };
}

async function bitableSchemaItems(ctx, url) {
  const result = await ctx.paginate("GET", url, {
    query: { page_size: 100 },
    itemsKey: "items",
  });
  if (result.has_more || result.truncated || !Array.isArray(result.items))
    throw new CliError(
      "api",
      "Incomplete Bitable schema list; cannot resolve the requested object",
      { code: 5 },
    );
  return result.items;
}

function bitableLookup(items, kind, selector) {
  const id = kind + "_id";
  const match = items.find((item) => item[id] === selector);
  if (match) return match;
  const name = kind === "table" ? "name" : kind + "_name";
  const matches = items.filter((item) => item[name] === selector);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1)
    fail(`Ambiguous ${kind} name '${selector}'; supply its ID`);
  fail(`No visible ${kind} matches '${selector}'; check its ID or exact name`);
}

async function bitableRecordGet(ctx, table, f) {
  const input =
    f.json === true || f.json === undefined
      ? {}
      : await json(ctx, f.json, "json");
  onlyKeys(
    input,
    [
      "record_ids",
      "record_id_list",
      "select_fields",
      "automatic_fields",
      "with_shared_url",
      "user_id_type",
    ],
    "--json",
  );
  if (
    [f["record-id"], input.record_ids, input.record_id_list].filter(
      (v) => v !== undefined,
    ).length !== 1
  )
    fail(
      "Specify record IDs once using --record-id, --json.record_id_list or --json.record_ids",
    );
  if (f["field-id"] !== undefined || input.select_fields !== undefined)
    fail(
      "Bitable v1 batch_get returns all fields and cannot apply a field projection; omit --field-id/--json.select_fields or use base +record-search with a search field and projection",
    );
  if (input.user_id_type !== undefined && f["user-id-type"] !== undefined)
    fail("Specify user_id_type only once");
  const ids = uniqueStrings(
    f["record-id"] === undefined
      ? (input.record_ids ?? input.record_id_list)
      : list(f["record-id"]),
    "record IDs",
    200,
  );
  if (new Set(ids).size !== ids.length)
    fail("record IDs must be distinct after trimming whitespace");
  const userIdType = input.user_id_type ?? f["user-id-type"];
  if (
    userIdType !== undefined &&
    !["user_id", "open_id", "union_id"].includes(userIdType)
  )
    fail("user_id_type must be open_id, union_id or user_id");
  for (const key of ["automatic_fields", "with_shared_url"]) {
    if (input[key] !== undefined && typeof input[key] !== "boolean")
      fail(`${key} must be a boolean`);
  }
  const records = [],
    missing = [],
    forbidden = [];
  for (let i = 0; i < ids.length; i += 100) {
    const body = clean({
      record_ids: ids.slice(i, i + 100),
      user_id_type: userIdType,
      automatic_fields: input.automatic_fields,
      with_shared_url: input.with_shared_url,
    });
    const result = await req(
      ctx,
      "POST",
      table + "/records/batch_get",
      undefined,
      body,
    );
    if (ctx.dryRun) continue;
    const lists = [
      "records",
      "absent_record_ids",
      "forbidden_record_ids",
    ].filter((key) => result?.[key] !== undefined);
    if (!lists.length || !lists.every((key) => Array.isArray(result[key])))
      throw new CliError(
        "api",
        "Bitable batch_get expected record and status arrays",
        { code: 5 },
      );
    records.push(...(result.records ?? []));
    missing.push(...(result.absent_record_ids ?? []));
    forbidden.push(...(result.forbidden_record_ids ?? []));
  }
  const byId = new Map(records.map((record) => [record.record_id, record]));
  const items = ids.filter((id) => byId.has(id)).map((id) => byId.get(id));
  return bitableRecordRows({
    items,
    records: items,
    absent_record_ids: missing,
    forbidden_record_ids: forbidden,
    record_not_found: missing,
  });
}

function bitableRecordRows(result, projection) {
  const fields = projection ?? [
    ...new Set(
      result.items.flatMap((record) => Object.keys(record.fields ?? {})),
    ),
  ];
  return {
    ...result,
    fields,
    record_id_list: result.items.map((record) => record.record_id),
    data: result.items.map((record) =>
      fields.map((name) => record.fields?.[name] ?? null),
    ),
  };
}

async function executeBitableV1(ctx, action, f) {
  const accepted = new Set([...bitableGlobalFlags, ...bitableV1Flags[action]]);
  for (const key of Object.keys(f)) {
    if (
      !accepted.has(key) ||
      (key === "json" &&
        f.json !== true &&
        ![
          "record-get",
          "record-list",
          "record-search",
          "record-batch-create",
          "record-batch-update",
          "record-delete",
        ].includes(action))
    )
      fail(`--${key} is unsupported for base +${action} on Bitable v1`);
  }
  if (action === "base-create" || action === "base-copy") {
    const copying = action === "base-copy";
    if (!copying) {
      const name = required(f, "name");
      if (typeof name !== "string" || !name.trim())
        fail("--name must be a non-empty string");
    }
    const url = copying
      ? bitableAppsPath + "/" + enc(required(f, "base-token")) + "/copy"
      : bitableAppsPath;
    const data = await req(
      ctx,
      "POST",
      url,
      undefined,
      pick(f, ["name", "folder-token", "time-zone", "without-content"]),
    );
    if (ctx.dryRun) return data;
    const app = data?.app;
    if (typeof app?.app_token !== "string" || !app.app_token)
      throw new CliError("api", "Bitable response is missing app.app_token", {
        code: 5,
        hint: "Check the destination folder before repeating the command.",
      });
    const result = {
      ...data,
      base: { ...app, base_token: app.app_token },
      [copying ? "copied" : "created"]: true,
    };
    if (ctx.identity === "bot")
      result.permission_grant = await grantCurrentUser(
        ctx,
        app.app_token,
        "bitable",
      );
    return result;
  }
  const app = `${bitableAppsPath}/${enc(required(f, "base-token"))}`;
  const tables = app + "/tables";
  if (action === "table-create") return bitableTableCreate(ctx, tables, f);
  if (action === "base-get") {
    const result = await req(ctx, "GET", app);
    if (ctx.dryRun) return result;
    if (!result.app?.app_token)
      throw new CliError("api", "Bitable metadata is missing app.app_token", {
        code: 5,
      });
    return {
      ...result,
      base: { ...result.app, base_token: result.app.app_token },
    };
  }
  let collection = tables;
  if (!["table-list", "dashboard-list"].includes(action)) {
    const table = required(f, "table-id");
    let tableId = table,
      metadata;
    const isTableId = /^tbl[\w-]+$/.test(table);
    if (
      action === "table-get" ||
      (!isTableId && action !== "record-batch-create")
    ) {
      const items = await bitableSchemaItems(ctx, tables);
      metadata = ctx.dryRun
        ? { table_id: isTableId ? table : "<resolved_table_id>" }
        : bitableLookup(items, "table", table);
      tableId = metadata.table_id;
      if (!tableId)
        throw new CliError("api", "Matched Bitable table has no table_id", {
          code: 5,
        });
    }
    collection = `${tables}/${enc(tableId)}`;
    if (action === "table-get") {
      const fields = await bitableSchemaItems(ctx, collection + "/fields");
      const views = await bitableSchemaItems(ctx, collection + "/views");
      return { table: metadata, fields, views };
    }
    if (action === "field-get" || action === "view-get") {
      const kind = action === "field-get" ? "field" : "view";
      const selector = required(f, kind + "-id");
      const items = await bitableSchemaItems(
        ctx,
        collection + "/" + kind + "s",
      );
      return ctx.dryRun ? {} : { [kind]: bitableLookup(items, kind, selector) };
    }
    if (action === "form-get") {
      const id = required(f, "form-id");
      const result = await req(ctx, "GET", collection + "/forms/" + enc(id));
      if (ctx.dryRun) return result;
      if (!result.form)
        throw new CliError("api", "Bitable form response is missing form", {
          code: 5,
        });
      return { ...result.form, id, form: result.form };
    }
    if (action === "record-get") return bitableRecordGet(ctx, collection, f);
  }
  if (action === "record-batch-create") {
    const clientToken = f["client-token"];
    if (
      clientToken !== undefined &&
      (typeof clientToken !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
          clientToken,
        ))
    )
      fail("--client-token must be a UUIDv4");
    const body = bitableCreateRecords(await json(ctx, f.json, "json"));
    return req(
      ctx,
      "POST",
      `${collection}/records/batch_create`,
      pick(f, ["client-token", "user-id-type"]),
      body,
    );
  }
  if (action === "record-batch-update" || action === "record-delete")
    return bitableRecordBatchWrite(ctx, collection, action, f);
  const records = action.startsWith("record-");
  const { body, paging } = records
    ? await bitableSearchOptions(ctx, action, f)
    : { paging: f };
  if (ints(f, "offset", 0) !== 0 || ints(paging, "offset", 0) !== 0)
    fail(
      "Bitable v1 requires --page-token for continuation; a numeric --offset cannot identify a page",
    );
  if (
    f["page-token"] !== undefined &&
    (typeof f["page-token"] !== "string" || !f["page-token"].trim())
  )
    fail("--page-token requires an opaque token string");
  if (f["page-size"] !== undefined && ctx.providedFlags?.has("limit"))
    fail("Specify either --page-size or --limit");
  const query = clean({
    page_size: ints(
      f,
      "page-size",
      paging.limit ?? 100,
      1,
      records || action === "dashboard-list" ? 500 : 100,
    ),
    page_token: f["page-token"],
    ...(records ? pick(f, ["user-id-type"]) : {}),
  });
  const key = action === "dashboard-list" ? "dashboards" : "items";
  const url = records
    ? collection + "/records/search"
    : {
        "field-list": collection + "/fields",
        "view-list": collection + "/views",
        "dashboard-list": app + "/dashboards",
        "table-list": tables,
      }[action];
  const method = records ? "POST" : "GET";
  const normalizePage = (page) => {
    const entries = page?.[key];
    if (Array.isArray(entries)) return page;
    // HaiNeng sometimes omits the collection for an explicitly empty page.
    if (entries == null && page?.has_more === false && page.total === 0)
      return { ...page, [key]: [] };
    throw new CliError("api", `Bitable v1 response requires the ${key} array`, {
      code: 5,
    });
  };
  const response = yes(f["page-all"])
    ? await ctx.paginate(
        method,
        url,
        clean({ query, body, itemsKey: key, normalizePage }),
      )
    : await req(ctx, method, url, query, body);
  if (ctx.dryRun) return response;
  const result = normalizePage(response);
  if (records) return bitableRecordRows(result, body.field_names);
  if (key === "dashboards")
    return {
      ...result,
      dashboards: result.dashboards.map((dashboard) => ({
        ...dashboard,
        dashboard_id: dashboard.block_id,
      })),
    };
  const alias = {
    "field-list": "fields",
    "view-list": "views",
    "table-list": "tables",
  }[action];
  return { ...result, [alias]: result.items };
}

function usesBitableV1(ctx) {
  return !hasSourceBaseV3 || isHaiNengProfile(ctx.config);
}

let baseV3Executor;
async function executeBase(ctx, command, f) {
  const action = command.slice(1);
  if (usesBitableV1(ctx))
    return isHaiNengBaseShortcut(command)
      ? executeBitableV1(ctx, action, f)
      : undefined;
  const execute = await (baseV3Executor ??= import(baseV3Module.href).then(
    ({ createBaseV3Executor }) =>
      createBaseV3Executor({
        has,
        clean,
        yes,
        fail,
        required,
        enc,
        ints,
        list,
        pick,
        json,
        req,
        uniqueStrings,
        safeFile,
        upload,
        grantCurrentUser,
      }),
  ));
  return execute(ctx, action, f);
}

export async function executeTables(ctx, service, command, flags = {}) {
  if (!commandSpecs[service]?.[command]) return undefined;
  if (
    commandSpecs[service][command].risk === "high-risk-write" &&
    !ctx.dryRun &&
    !yes(flags.yes)
  )
    throw new CliError(
      "confirmation_required",
      "This operation requires --yes",
      { code: 10, hint: "Preview with --dry-run, then add --yes to confirm." },
    );
  if (service === "base") {
    const f = { ...flags };
    for (const def of commandSpecs.base[command].flags ?? [])
      if (!has(f, def.name) && def.default !== undefined)
        f[def.name] = /^(?:int|int64|float64)$/.test(def.type)
          ? Number(def.default)
          : def.type === "bool"
            ? def.default === "true"
            : def.default;
    if (["+record-list", "+record-get", "+record-search"].includes(command)) {
      const format =
        f.format ??
        (f.jq || (usesBitableV1(ctx) && f.json === true) ? "json" : "markdown");
      if (!["json", "markdown"].includes(format))
        fail("--format must be json or markdown");
      if (format === "markdown" && f.jq)
        fail("--jq and --format markdown are mutually exclusive");
      const result = await executeBase(ctx, command, f);
      return format === "markdown" && !ctx.dryRun
        ? (recordMarkdown(result, command === "+record-get") ?? result)
        : result;
    }
    return executeBase(ctx, command, f);
  }
  return defs[command]
    ? executeSheets(ctx, command, flags)
    : executeLegacySheets(ctx, command, flags);
}

async function grantCurrentUser(ctx, token, type) {
  const user = ctx.config?.userOpenId ?? ctx.user?.open_id;
  if (!user || !token)
    return {
      status: "skipped",
      perm: "full_access",
      message: !user
        ? "No current user open_id is configured; continue using bot identity or grant permission manually."
        : "Created resource returned no permission target.",
    };
  try {
    await req(
      ctx,
      "POST",
      `/open-apis/drive/v1/permissions/${enc(token)}/members`,
      { type, need_notification: false },
      {
        member_type: "openid",
        member_id: user,
        perm: "full_access",
        type: "user",
      },
    );
    return {
      status: "granted",
      perm: "full_access",
      member_type: "openid",
      user_open_id: user,
      message: "Granted the current CLI user full_access on the new resource.",
    };
  } catch (error) {
    return {
      status: "failed",
      perm: "full_access",
      member_type: "openid",
      user_open_id: user,
      message: `Resource was created, but granting permission failed: ${error.message}`,
      hint: "Retry the permission grant or continue using bot identity; do not create the resource again.",
    };
  }
}
function recordMarkdown(data, single) {
  if (
    !Array.isArray(data?.fields) ||
    (!data.fields.length && !Array.isArray(data.items)) ||
    !Array.isArray(data.data)
  )
    return undefined;
  const fields = data.fields.filter((x) => typeof x === "string");
  const ids = data.record_id_list ?? [];
  const value = (x) =>
    x === null || x === undefined
      ? ""
      : typeof x === "object"
        ? JSON.stringify(x)
        : String(x);
  const cell = (x) =>
    value(x)
      .replaceAll("\\", "\\\\")
      .replaceAll("|", "\\|")
      .replace(/\r?\n/g, "<br>");
  const sequence = (x) =>
    x === undefined || x === null
      ? []
      : Array.isArray(x)
        ? x.map(value)
        : [value(x)];
  const missing = sequence(data.record_not_found);
  const ignored = sequence(data.ignored_fields);
  let text =
    "`_record_id` is metadata for record operations, not a table field.\n\n";
  if (single && ids.length === 1 && data.data.length === 1) {
    if (missing.includes(ids[0])) text = "Record not found.\n\n";
    text += `- \`_record_id\`: ${value(ids[0])}\n`;
    if (!missing.includes(ids[0]))
      fields.forEach((name, i) => {
        text += `- \`${name}\`: ${value(data.data[0]?.[i])}\n`;
      });
  } else {
    text += `| ${["_record_id", ...fields].map(cell).join(" | ")} |\n| ${["_record_id", ...fields].map(() => "---").join(" | ")} |\n`;
    data.data.forEach((row, i) => {
      text += `| ${[ids[i] ?? "", ...fields.map((_, j) => row?.[j])].map(cell).join(" | ")} |\n`;
    });
  }
  const meta = [`count=${ids.length}`];
  if (has(data, "has_more")) meta.push(`has_more=${value(data.has_more)}`);
  for (const name of ["record_scope", "field_scope", "search_scope"])
    if (has(data.query_context ?? {}, name))
      meta.push(`${name}=${value(data.query_context[name])}`);
  if (ignored.length) meta.push(`ignored_fields=${ignored.length}`);
  if (missing.length) meta.push(`record_not_found=${missing.length}`);
  text += "\nMeta: " + meta.join("; ") + "\n";
  if (ignored.length)
    text += `Ignored fields: ${ignored.slice(0, 20).join(", ")}${ignored.length > 20 ? `, ...(${ignored.length} total)` : ""}\n`;
  if (missing.length) text += `Missing records: ${missing.join(", ")}\n`;
  if (data.forbidden_record_ids?.length)
    text += `Access denied for records: ${data.forbidden_record_ids.join(", ")}\n`;
  return { __raw: text };
}

function applySheetDefaults(command, flags) {
  const f = { ...flags };
  for (const def of defs[command].flags) {
    if (def.kind === "system") continue;
    if (!has(f, def.name) && def.default !== undefined) {
      f[def.name] = ["int", "int64", "float64"].includes(def.type)
        ? Number(def.default)
        : def.type === "bool"
          ? def.default === "true"
          : def.default;
    }
    if (
      def.required === "required" &&
      (f[def.name] === undefined ||
        (f[def.name] === "" && !["replacement", "color"].includes(def.name)))
    )
      fail(`--${def.name} is required`);
    if (!has(f, def.name)) continue;
    if (["int", "int64", "float64"].includes(def.type)) {
      const value = Number(f[def.name]);
      if (
        !Number.isFinite(value) ||
        (def.type !== "float64" && !Number.isInteger(value))
      )
        fail(
          `--${def.name} must be ${def.type === "float64" ? "a number" : "an integer"}`,
        );
      f[def.name] = value;
    }
    if (def.type === "bool") {
      if (![true, false, "true", "false"].includes(f[def.name]))
        fail(`--${def.name} must be true or false`);
      f[def.name] = yes(f[def.name]);
    }
    if (def.enum?.length) {
      const entries = ["string_slice", "string_array"].includes(def.type)
        ? list(f[def.name])
        : [f[def.name]];
      if (entries.some((x) => !def.enum.includes(String(x))))
        fail(`--${def.name} must be one of: ${def.enum.join(", ")}`);
    }
  }
  return f;
}
function sheetToken(f) {
  if (Boolean(f.url) === Boolean(f["spreadsheet-token"]))
    fail("Specify exactly one of --url or --spreadsheet-token");
  if (f["spreadsheet-token"]) return String(f["spreadsheet-token"]);
  let url;
  try {
    url = new URL(f.url);
  } catch {
    fail("--url must be a spreadsheet URL");
  }
  const match = url.pathname.match(/\/(?:sheets|spreadsheets)\/([^/]+)/);
  if (!match) fail("--url must contain /sheets/<token>");
  return decodeURIComponent(match[1]);
}
function validateSchema(value, schema, label) {
  if (!schema || (value === null && schema.nullable)) return;
  const matches = (candidate) => {
    try {
      validateSchema(value, candidate, label);
      return true;
    } catch {
      return false;
    }
  };
  if (schema.oneOf && schema.oneOf.filter(matches).length !== 1)
    fail(`${label} does not match exactly one supported shape`);
  if (schema.anyOf && !schema.anyOf.some(matches))
    fail(`${label} does not match a supported shape`);
  for (const item of schema.allOf ?? []) validateSchema(value, item, label);
  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : [];
  const correct = (type) =>
    type === "array"
      ? Array.isArray(value)
      : type === "object"
        ? value !== null && typeof value === "object" && !Array.isArray(value)
        : type === "integer"
          ? Number.isInteger(value)
          : type === "null"
            ? value === null
            : typeof value === type;
  if (types.length && !types.some(correct))
    fail(`${label} must be ${types.join(" or ")}`);
  if (
    schema.enum &&
    !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))
  )
    fail(`${label} has an unsupported value`);
  if (
    typeof value === "number" &&
    ((schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum))
  )
    fail(`${label} is outside the supported numeric range`);
  if (
    typeof value === "string" &&
    ((schema.minLength !== undefined && value.length < schema.minLength) ||
      (schema.maxLength !== undefined && value.length > schema.maxLength))
  )
    fail(`${label} has an invalid length`);
  if (Array.isArray(value)) {
    if (
      (schema.minItems !== undefined && value.length < schema.minItems) ||
      (schema.maxItems !== undefined && value.length > schema.maxItems)
    )
      fail(`${label} has an invalid number of entries`);
    if (schema.items)
      value.forEach((item, index) =>
        validateSchema(item, schema.items, `${label}[${index}]`),
      );
  } else if (value && typeof value === "object") {
    for (const key of schema.required ?? [])
      if (!has(value, key)) fail(`${label}.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key])
        validateSchema(item, schema.properties[key], `${label}.${key}`);
      else if (schema.additionalProperties === false)
        fail(`${label}.${key} is not supported`);
    }
  }
}
function validateToolInput(command, built) {
  for (const field of ["properties", "cells"])
    if (built?.input[field] !== undefined && schemas[command]?.[field])
      validateSchema(built.input[field], schemas[command][field], `--${field}`);
}
function selector(f, optional = false, prefix = "") {
  const id = f[`${prefix}sheet-id`],
    name = f[`${prefix}sheet-name`];
  if (id && name)
    fail(
      `--${prefix}sheet-id and --${prefix}sheet-name are mutually exclusive`,
    );
  if (!id && !name && !optional)
    fail(`Specify --${prefix}sheet-id or --${prefix}sheet-name`);
  return clean({ sheet_id: id || undefined, sheet_name: name || undefined });
}
const toolPath = (token, read = false) =>
  `/open-apis/sheet_ai/v2/spreadsheets/${enc(token)}/tools/invoke_${read ? "read" : "write"}`;
async function sheetCall(ctx, token, tool, input, read = false) {
  const data = await req(ctx, "POST", toolPath(token, read), undefined, {
    tool_name: tool,
    input: JSON.stringify(input),
  });
  if (ctx.dryRun) return data;
  if (!data?.output) return null;
  if (typeof data.output !== "string")
    throw new CliError("api", `Tool ${tool} returned a non-string output`, {
      code: 5,
    });
  try {
    return JSON.parse(data.output);
  } catch {
    throw new CliError("api", `Tool ${tool} returned invalid JSON output`, {
      code: 5,
    });
  }
}
function rectangle(range) {
  const m = String(range).match(
    /^\$?([A-Za-z]+)\$?(\d+)(?::\$?([A-Za-z]+)\$?(\d+))?$/,
  );
  if (!m) fail("A finite A1 cell range is required, such as A1:C5");
  const col = (s) =>
    Array.from(s.toUpperCase()).reduce(
      (n, c) => n * 26 + c.charCodeAt(0) - 64,
      0,
    );
  const rows = Number(m[4] ?? m[2]) - Number(m[2]) + 1,
    cols = col(m[3] ?? m[1]) - col(m[1]) + 1;
  if (rows < 1 || cols < 1 || rows * cols > 50000)
    fail("Range must contain 1 to 50000 cells in ascending order");
  return { rows, cols };
}
const matrix = (range, cell) => {
  const { rows, cols } = rectangle(range);
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => structuredClone(cell)),
  );
};
function imageSize(bytes) {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (
    bytes.length >= 10 &&
    /GIF8[79]a/.test(bytes.subarray(0, 6).toString("ascii"))
  )
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (bytes.length >= 26 && bytes.subarray(0, 2).toString("ascii") === "BM")
    return {
      width: Math.abs(bytes.readInt32LE(18)),
      height: Math.abs(bytes.readInt32LE(22)),
    };
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = bytes[offset + 1];
      if (
        [0xd8, 0xd9, 0x01].includes(marker) ||
        (marker >= 0xd0 && marker <= 0xd7)
      ) {
        offset += 2;
        continue;
      }
      const size = bytes.readUInt16BE(offset + 2);
      if (size < 2 || offset + size + 2 > bytes.length) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      )
        return {
          width: bytes.readUInt16BE(offset + 7),
          height: bytes.readUInt16BE(offset + 5),
        };
      offset += size + 2;
    }
  }
  fail(
    "Cannot read image dimensions; use a valid PNG, JPEG, GIF, or BMP image",
  );
}
function colName(index) {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
async function style(ctx, f) {
  const result = pick(f, [
    "background-color",
    "font-color",
    "font-size",
    "font-style",
    "font-weight",
    "font-line",
    "horizontal-alignment",
    "vertical-alignment",
    "word-wrap",
    "number-format",
  ]);
  const cell = {};
  if (Object.keys(result).length) cell.cell_styles = result;
  if (f["border-styles"])
    cell.border_styles = await json(ctx, f["border-styles"], "border-styles");
  if (!Object.keys(cell).length) fail("At least one style flag is required");
  return cell;
}
async function dropdown(ctx, f) {
  if (Boolean(f.options) === Boolean(f["source-range"]))
    fail("Specify exactly one of --options or --source-range");
  const result = f.options
    ? { type: "list", items: await json(ctx, f.options, "options", "array") }
    : { type: "listFromRange", range: f["source-range"] };
  if (f.colors)
    result.highlight_colors = await json(ctx, f.colors, "colors", "array");
  if (result.items && result.highlight_colors?.length > result.items.length)
    fail("--colors cannot have more entries than --options");
  if (yes(f.multiple)) result.support_multiple_values = true;
  if (has(f, "highlight")) result.enable_highlight = yes(f.highlight);
  return { data_validation: result };
}
const OBJECTS = {
  chart: ["chart", "chart-id", "chart_id"],
  pivot: ["pivot_table", "pivot-table-id", "pivot_table_id"],
  "cond-format": ["conditional_format", "rule-id", "conditional_format_id"],
  filter: ["filter", "", "filter_id"],
  "filter-view": ["filter_view", "view-id", "view_id"],
  sparkline: ["sparkline", "group-id", "group_id"],
  "float-image": ["float_image", "float-image-id", "float_image_id"],
};
function searchOptions(f) {
  return clean(
    Object.fromEntries(
      [
        ["match-case", "match_case"],
        ["match-entire-cell", "match_entire_cell"],
        ["regex", "use_regex"],
        ["include-formulas", "match_formulas"],
      ]
        .filter(([key]) => yes(f[key]))
        .map(([, key]) => [key, true]),
    ),
  );
}

async function buildSheetTool(ctx, command, f, token, changed = f) {
  const input = { excel_id: token };
  if (command === "+workbook-info")
    return { tool: "get_workbook_structure", input, read: true };
  const noSelector = command === "+sheet-create";
  const pivotCreate = command === "+pivot-create";
  Object.assign(
    input,
    selector(f, noSelector || pivotCreate, pivotCreate ? "target-" : ""),
  );
  if (command.startsWith("+sheet-") && command !== "+sheet-info") {
    const op = command.slice(7);
    input.operation =
      { copy: "duplicate", "set-tab-color": "set_tab_color" }[op] ?? op;
    if (op === "create") {
      input.sheet_name = f.title;
      input.rows = f["row-count"];
      input.columns = f["col-count"];
    }
    if (op === "rename") input.new_name = f.title;
    if (op === "copy" && f.title) input.new_name = f.title;
    if (has(changed, "index")) input.target_index = ints(f, "index", 0);
    if (op === "set-tab-color") input.tab_color = f.color;
    if (op === "move") {
      let id = f["sheet-id"],
        source = changed["source-index"];
      if (!id || source === undefined) {
        const info = await sheetCall(
          ctx,
          token,
          "get_workbook_structure",
          { excel_id: token },
          true,
        );
        const sheets = Array.isArray(info)
          ? info
          : (info?.sheets ?? info?.sheet_list ?? []);
        const item = sheets.find((x) =>
          id
            ? (x.sheet_id ?? x.reference_id) === id
            : (x.title ?? x.name) === f["sheet-name"],
        );
        if (!item && !ctx.dryRun)
          throw new CliError("api", "Sheet lookup returned no matching sheet", {
            code: 5,
          });
        id =
          item?.sheet_id ??
          item?.reference_id ??
          (ctx.dryRun ? "<resolved_sheet_id>" : undefined);
        source = source ?? item?.index ?? "<resolved_source_index>";
      }
      delete input.sheet_name;
      input.sheet_id = id;
      input.source_index = source;
    }
    return { tool: "modify_workbook_structure", input };
  }
  if (command === "+sheet-info") {
    if (f.range) input.range = f.range;
    const include = list(f.include);
    if (include.length) {
      const mapping = {
        row_heights: "row_heights_column_widths",
        col_widths: "row_heights_column_widths",
        hidden_rows: "hidden_infos",
        hidden_cols: "hidden_infos",
        groups: "group_infos",
        merges: "merged_cells_infos",
      };
      const groups = [...new Set(include.map((x) => mapping[x] ?? "all"))];
      input.info_type = groups.length === 1 ? groups[0] : "all";
    }
    return { tool: "get_sheet_structure", input, read: true };
  }
  if (command.startsWith("+dim-")) {
    const op = command.slice(5);
    input.operation = op;
    if (op === "insert") {
      input.position = f.position;
      input.count = ints(f, "count", 1, 1);
      if (f["inherit-style"] !== "none") input.side = f["inherit-style"];
    } else if (op === "freeze") {
      const count = ints(f, "count", 0);
      input.operation = count ? "freeze" : "unfreeze";
      if (count)
        input[f.dimension === "row" ? "freeze_rows" : "freeze_columns"] = count;
    } else {
      input.range = f.range;
      if (op === "group") input.group_state = f["group-state"];
    }
    return { tool: "modify_sheet_structure", input };
  }
  if (command === "+cells-get" || command === "+dropdown-get") {
    input.ranges = [f.range];
    if (command === "+dropdown-get") {
      input.include_styles = false;
      input.value_render_option = "formatted_value";
    } else {
      input.cell_limit = 1000000000;
      input.max_chars = f["max-chars"];
      const include = list(f.include);
      if (include.length) {
        input.include_styles = include.includes("style");
        if (include.includes("formula")) input.value_render_option = "formula";
      }
      if (yes(f["skip-hidden"])) input.skip_hidden = true;
    }
    return { tool: "get_cell_ranges", input, read: true };
  }
  if (command === "+csv-get") {
    input.range = f.range;
    input.max_rows = 1000000000;
    input.max_chars = f["max-chars"];
    if (yes(f["skip-hidden"])) input.skip_hidden = true;
    return { tool: "get_range_as_csv", input, read: true };
  }
  if (command === "+cells-search" || command === "+cells-replace") {
    input.search_term = f.find;
    if (f.range) input.range = f.range;
    const options = searchOptions(f);
    if (Object.keys(options).length) input.options = options;
    if (command === "+cells-search") {
      if (f.offset > 0) input.offset = f.offset;
      input.max_matches = f["max-matches"];
    } else input.replace_term = f.replacement;
    return {
      tool: command === "+cells-search" ? "search_data" : "replace_data",
      input,
      read: command === "+cells-search",
    };
  }
  if (
    [
      "+cells-set",
      "+cells-set-style",
      "+dropdown-set",
      "+cells-set-image",
    ].includes(command)
  ) {
    input.range = f.range;
    let uploaded;
    if (command === "+cells-set") {
      input.cells = await json(ctx, f.cells, "cells", "array");
      if (!yes(f["allow-overwrite"])) input.allow_overwrite = false;
      if (f["copy-to-range"]) input.copy_to_range = f["copy-to-range"];
    } else if (command === "+cells-set-style")
      input.cells = matrix(f.range, await style(ctx, f));
    else if (command === "+dropdown-set")
      input.cells = matrix(f.range, await dropdown(ctx, f));
    else {
      const size = rectangle(f.range);
      if (size.rows !== 1 || size.cols !== 1)
        fail("--range must select exactly one cell for an embedded image");
      const dimensions = ctx.dryRun
        ? { width: "<image_width>", height: "<image_height>" }
        : imageSize(await readFile(await safeFile(ctx, f.image)));
      uploaded = await upload(
        ctx,
        f.image,
        token,
        "sheet_image",
        undefined,
        f.name,
      );
      input.cells = [
        [
          {
            rich_text: [
              {
                type: "embed-image",
                text: "",
                image_token: uploaded.file_token,
                image_width: dimensions.width,
                image_height: dimensions.height,
              },
            ],
          },
        ],
      ];
    }
    return { tool: "set_cell_range", input, uploaded };
  }
  if (command === "+csv-put") {
    input.csv = await ctx.input(f.csv);
    input.start_cell = has(changed, "start-cell")
      ? f["start-cell"]
      : (f.range?.split(":")[0] ?? f["start-cell"]);
    if (!/^\$?[A-Za-z]+\$?[1-9]\d*$/.test(input.start_cell))
      fail("--start-cell must be an A1 cell");
    if (!yes(f["allow-overwrite"])) input.allow_overwrite = false;
    return { tool: "set_range_from_csv", input };
  }
  if (command === "+cells-clear") {
    input.range = f.range;
    input.clear_type = f.scope === "content" ? "contents" : f.scope;
    return { tool: "clear_cell_range", input };
  }
  if (command === "+cells-merge" || command === "+cells-unmerge") {
    input.range = f.range;
    input.operation = command === "+cells-merge" ? "merge" : "unmerge";
    if (input.operation === "merge") input.merge_type = f["merge-type"];
    return { tool: "merge_cells", input };
  }
  if (command === "+rows-resize" || command === "+cols-resize") {
    input.range = f.range.includes(":") ? f.range : `${f.range}:${f.range}`;
    if (f.type === "pixel" && !(f.size > 0))
      fail("--size must be positive for --type pixel");
    input[command === "+rows-resize" ? "resize_height" : "resize_width"] =
      f.type === "pixel" ? { type: f.type, value: f.size } : { type: f.type };
    return { tool: "resize_range", input };
  }
  if (command.startsWith("+range-")) {
    input.operation = command.slice(7);
    input.range = f["source-range"] ?? f.range;
    if (input.operation === "sort") {
      input.sort_conditions = await json(
        ctx,
        f["sort-keys"],
        "sort-keys",
        "array",
      );
      if (yes(f["has-header"])) input.has_header = true;
    } else {
      input.destination_range = f["target-range"];
      if (f["target-sheet-id"])
        input.destination_sheet_id = f["target-sheet-id"];
    }
    if (input.operation === "fill")
      input.fill_type =
        f["series-type"] === "copy" ? "copyCells" : "fillSeries";
    if (input.operation === "copy" && f["paste-type"] !== "all")
      input.paste_type = {
        values: "value_only",
        formulas: "formula_only",
        formats: "format_only",
      }[f["paste-type"]];
    return { tool: "transform_range", input };
  }
  for (const [prefix, [object, idFlag, idField]] of Object.entries(
    OBJECTS,
  ).sort((a, b) => b[0].length - a[0].length))
    if (command.startsWith(`+${prefix}-`)) {
      const op = command.slice(prefix.length + 2);
      if (op === "list") {
        if (idFlag && f[idFlag]) input[idField] = f[idFlag];
        return { tool: `get_${object}_objects`, input, read: true };
      }
      input.operation = op;
      if (idFlag && op !== "create") input[idField] = required(f, idFlag);
      if (prefix === "filter" && op !== "create") {
        if (!f["sheet-id"]) fail("Filter update/delete requires --sheet-id");
        input.filter_id = f["sheet-id"];
      }
      if (op !== "delete") {
        input.properties =
          prefix === "float-image"
            ? {}
            : await json(
                ctx,
                f.properties,
                "properties",
                "object",
                prefix === "filter" ? {} : undefined,
              );
        if (prefix === "pivot" && op === "create") {
          input.properties.source = f.source;
          if (f.range) input.properties.range = f.range;
          if (f["target-position"] !== "A1")
            input.target_position = f["target-position"];
        }
        if (prefix === "cond-format") {
          input.properties.rule_type = f["rule-type"];
          input.properties.ranges = await json(
            ctx,
            f.ranges,
            "ranges",
            "array",
          );
        }
        if (prefix === "filter" || prefix === "filter-view") {
          if (f.range) input.properties.range = f.range;
          if (f["view-name"]) input.properties.view_name = f["view-name"];
        }
        if (
          prefix === "sparkline" &&
          op === "update" &&
          input.properties.sparklines?.some((x) => !x.sparkline_id)
        )
          fail(
            "Every updated sparkline needs sparkline_id; read +sparkline-list first",
          );
        if (prefix === "float-image") {
          const count = [f.image, f["image-token"], f["image-uri"]].filter(
            Boolean,
          ).length;
          if (count !== 1)
            fail(
              "Specify exactly one of --image, --image-token, or --image-uri",
            );
          const imageToken = f.image
            ? (await upload(ctx, f.image, token, "sheet_image")).file_token
            : f["image-token"];
          input.properties = {
            image_name: f["image-name"],
            position: { row: f["position-row"], col: f["position-col"] },
            size: { width: f["size-width"], height: f["size-height"] },
            ...clean({ image_token: imageToken, image_uri: f["image-uri"] }),
          };
          if (has(f, "offset-row") || has(f, "offset-col"))
            input.properties.offset = clean({
              row_offset: f["offset-row"],
              col_offset: f["offset-col"],
            });
          if (has(f, "z-index")) input.properties.z_index = f["z-index"];
        }
      }
      return { tool: `manage_${object}_object`, input };
    }
  return undefined;
}

async function executeSheets(ctx, command, original) {
  if (yes(original["print-schema"])) {
    const flags = schemas[command];
    if (!flags) fail(`No composite flag schema exists for ${command}`);
    if (original["flag-name"]) {
      const schema = flags[original["flag-name"]];
      if (!schema) fail(`No schema for --${original["flag-name"]}`);
      return { command, flag: original["flag-name"], schema };
    }
    return { command, flags };
  }
  const f = applySheetDefaults(command, original);
  if (command === "+workbook-create") {
    const headers = f.headers
      ? await json(ctx, f.headers, "headers", "array")
      : [];
    const values = f.values ? await json(ctx, f.values, "values", "array") : [];
    const created = await req(
      ctx,
      "POST",
      "/open-apis/sheets/v3/spreadsheets",
      undefined,
      { title: f.title, ...pick(f, ["folder-token"]) },
    );
    const spreadsheet = created.spreadsheet ?? created;
    const token =
      spreadsheet.spreadsheet_token ??
      spreadsheet.token ??
      (ctx.dryRun ? "<created_spreadsheet_token>" : undefined);
    if (!token)
      throw new CliError(
        "api",
        "Spreadsheet created but response has no token",
        { code: 5 },
      );
    if (!headers.length && !values.length) return { spreadsheet };
    const rows = [...(headers.length ? [headers] : []), ...values];
    if (rows.some((x) => !Array.isArray(x)))
      fail("--values must be a two-dimensional array");
    const width = Math.max(...rows.map((x) => x.length));
    if (!width) return { spreadsheet };
    try {
      const info = await sheetCall(
        ctx,
        token,
        "get_workbook_structure",
        { excel_id: token },
        true,
      );
      const sheets = Array.isArray(info)
        ? info
        : (info?.sheets ?? info?.sheet_list ?? []);
      const sheetId =
        sheets[0]?.sheet_id ??
        sheets[0]?.reference_id ??
        (ctx.dryRun ? "<first_sheet_id>" : undefined);
      if (!sheetId)
        throw new CliError(
          "api",
          "No initial sheet returned for new spreadsheet",
          { code: 5 },
        );
      const cells = rows.map((row) =>
        Array.from({ length: width }, (_, i) =>
          row[i] === undefined
            ? {}
            : typeof row[i] === "object" && row[i] !== null
              ? row[i]
              : { value: row[i] },
        ),
      );
      const initial_fill = await sheetCall(ctx, token, "set_cell_range", {
        excel_id: token,
        sheet_id: sheetId,
        range: `A1:${colName(width - 1)}${rows.length}`,
        cells,
      });
      return { spreadsheet, initial_fill };
    } catch (e) {
      throw new CliError(
        "partial_success",
        `Spreadsheet created but initial fill failed: ${e.message}`,
        { code: 5, detail: { spreadsheet, spreadsheet_token: token } },
      );
    }
  }
  const token = sheetToken(f);
  if (command === "+workbook-export") {
    if (f["file-extension"] === "csv" && !f["sheet-id"])
      fail("--sheet-id is required for CSV export");
    const task = await req(
      ctx,
      "POST",
      "/open-apis/drive/v1/export_tasks",
      undefined,
      {
        token,
        type: "sheet",
        file_extension: f["file-extension"],
        ...clean({ sub_id: f["sheet-id"] }),
      },
    );
    const ticket = task.ticket ?? (ctx.dryRun ? "<ticket>" : undefined);
    if (!ticket)
      throw new CliError("api", "Export response has no ticket", { code: 5 });
    let result;
    for (let i = 0; i < 15; i++) {
      const data = await req(
        ctx,
        "GET",
        `/open-apis/drive/v1/export_tasks/${enc(ticket)}`,
        { token },
      );
      result = data.result;
      if (ctx.dryRun || result?.job_status === 0) break;
      if (![1, 2].includes(result?.job_status))
        throw new CliError(
          "api",
          result?.job_error_msg ?? "Export task failed",
          { code: 5 },
        );
      await delay(2000);
    }
    if (ctx.dryRun && f["output-path"])
      await req(
        ctx,
        "GET",
        "/open-apis/drive/v1/export_tasks/file/<file_token>/download",
      );
    if (ctx.dryRun) return task;
    if (!result?.file_token) return { ticket, status: "polling_timeout" };
    if (f["output-path"]) {
      let target = f["output-path"];
      try {
        if (
          (
            await stat(path.resolve(ctx.cwd ?? process.cwd(), target))
          ).isDirectory()
        )
          target = path.join(target, path.basename(result.file_name));
      } catch {}
      target = await safeFile(ctx, target, true);
      const bytes = await ctx.request(
        "GET",
        `/open-apis/drive/v1/export_tasks/file/${enc(result.file_token)}/download`,
        { responseType: "buffer" },
      );
      await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
      return { ticket, ...result, saved_path: target };
    }
    return { ticket, ...result };
  }
  if (command === "+dim-move") {
    const sel = selector(f);
    let sid = sel.sheet_id;
    if (!sid) {
      const info = await sheetCall(
        ctx,
        token,
        "get_workbook_structure",
        { excel_id: token },
        true,
      );
      const entries = info?.sheets ?? info?.sheet_list ?? [];
      sid =
        entries.find((x) => (x.title ?? x.name) === sel.sheet_name)?.sheet_id ??
        (ctx.dryRun ? "<resolved_sheet_id>" : undefined);
      if (!sid) fail("Sheet name could not be resolved to an ID");
    }
    const range = String(f["source-range"]);
    const isRows = /^\d+:\d+$/.test(range),
      isCols = /^[A-Za-z]+:[A-Za-z]+$/.test(range);
    if (!isRows && !isCols) fail("--source-range must be a row or column span");
    const index = (s) =>
      isRows
        ? Number(s) - 1
        : Array.from(s.toUpperCase()).reduce(
            (n, c) => n * 26 + c.charCodeAt(0) - 64,
            0,
          ) - 1;
    const [a, b] = range.split(":");
    const target = index(String(f.target));
    return req(
      ctx,
      "POST",
      `/open-apis/sheets/v3/spreadsheets/${enc(token)}/sheets/${enc(sid)}/move_dimension`,
      undefined,
      {
        source: {
          major_dimension: isRows ? "ROWS" : "COLUMNS",
          start_index: index(a),
          end_index: index(b) + 1,
        },
        destination_index: target,
      },
    );
  }
  if (command === "+batch-update") {
    let raw = f.operations;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(await ctx.input(raw));
      } catch {
        fail("--operations must be valid JSON");
      }
    }
    const operations = Array.isArray(raw) ? raw : raw?.operations;
    if (!Array.isArray(operations) || !operations.length)
      fail("--operations must contain at least one operation");
    const translated = [];
    for (const [index, op] of operations.entries()) {
      if (!op?.shortcut || !op.input || typeof op.input !== "object")
        fail(`operations[${index}] requires shortcut and input`);
      if (
        !defs[op.shortcut] ||
        defs[op.shortcut].risk === "read" ||
        [
          "+batch-update",
          "+dim-move",
          "+cells-set-image",
          "+workbook-create",
          "+workbook-export",
          "+cells-batch-set-style",
          "+cells-batch-clear",
          "+dropdown-update",
          "+dropdown-delete",
        ].includes(op.shortcut)
      )
        fail(
          `operations[${index}] shortcut cannot participate in an atomic batch`,
        );
      const sub = Object.fromEntries(
        Object.entries(op.input).map(([key, value]) => [
          key.replaceAll("_", "-"),
          value,
        ]),
      );
      if (sub["spreadsheet-token"] || sub.url || has(sub, "operation"))
        fail(`operations[${index}] must not override workbook or operation`);
      const flags = applySheetDefaults(op.shortcut, sub);
      const built = await buildSheetTool(ctx, op.shortcut, flags, token, sub);
      if (!built || built.read)
        fail(`operations[${index}] has no supported write mapping`);
      validateToolInput(op.shortcut, built);
      translated.push({ tool_name: built.tool, input: built.input });
    }
    return sheetCall(
      ctx,
      token,
      "batch_update",
      clean({
        excel_id: token,
        operations: translated,
        continue_on_error: has(original, "continue-on-error")
          ? yes(f["continue-on-error"]) || undefined
          : raw.continue_on_error || undefined,
      }),
    );
  }
  if (
    [
      "+cells-batch-set-style",
      "+cells-batch-clear",
      "+dropdown-update",
      "+dropdown-delete",
    ].includes(command)
  ) {
    const ranges = await json(ctx, f.ranges, "ranges", "array");
    if (!ranges.length) fail("--ranges must not be empty");
    const operations = [];
    for (const range of ranges) {
      const match = String(range).match(/^(?:'((?:[^']|'')+)'|([^!]+))!(.+)$/);
      if (!match) fail("Every --ranges item must contain a sheet name prefix");
      const sheet = match[1]?.replaceAll("''", "'") ?? match[2];
      const cellsRange = match[3];
      const input = { excel_id: token, sheet_name: sheet, range: cellsRange };
      if (command === "+cells-batch-clear") {
        input.clear_type = f.scope === "content" ? "contents" : f.scope;
        operations.push({ tool_name: "clear_cell_range", input });
      } else {
        const cell =
          command === "+cells-batch-set-style"
            ? await style(ctx, f)
            : command === "+dropdown-delete"
              ? { data_validation: null }
              : await dropdown(ctx, f);
        input.cells = matrix(cellsRange, cell);
        operations.push({ tool_name: "set_cell_range", input });
      }
    }
    return sheetCall(ctx, token, "batch_update", {
      excel_id: token,
      operations,
    });
  }
  const tool = await buildSheetTool(ctx, command, f, token, original);
  if (!tool) return undefined;
  validateToolInput(command, tool);
  const result = await sheetCall(ctx, token, tool.tool, tool.input, tool.read);
  if (tool.uploaded && !ctx.dryRun)
    return {
      file_token: tool.uploaded.file_token,
      file_name: tool.uploaded.name,
      set_cell_range: result,
    };
  if (command === "+csv-get" && !ctx.dryRun) return csvOutput(result, f);
  return result;
}

function parseCsvRecord(text) {
  const fields = [];
  let value = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      fields.push(value);
      value = "";
    } else value += c;
  }
  if (quoted) return text.split(",");
  fields.push(value.replace(/\r?\n$/, ""));
  return fields;
}
function csvOutput(result, f) {
  if (!result || typeof result.annotated_csv !== "string") return result;
  if (!yes(f["rows-json"]))
    return yes(f["include-row-prefix"])
      ? result
      : {
          ...result,
          annotated_csv: result.annotated_csv.replace(
            /^\[row=\d+\][ ,]?/gm,
            "",
          ),
        };
  const groups = [];
  for (const line of result.annotated_csv.split("\n")) {
    const match = line.match(/^\[row=(\d+)\][ ,]?/);
    if (match)
      groups.push({
        number: Number(match[1]),
        text: line.slice(match[0].length),
      });
    else if (groups.length) groups.at(-1).text += "\n" + line;
  }
  if (!groups.length) return result;
  const parsed = groups.map((g) => parseCsvRecord(g.text));
  const max = Math.max(...parsed.map((x) => x.length));
  const start = (
    String(f.range).match(/^\$?([A-Za-z]+)/)?.[1] || "A"
  ).toUpperCase();
  const index =
    Array.from(start).reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const letters =
    result.col_indices?.length >= max
      ? result.col_indices
      : Array.from({ length: max }, (_, i) => colName(index + i));
  const output = {
    ...result,
    range: f.range,
    rows: groups.map((g, i) => ({
      row_number: g.number,
      values: Object.fromEntries(
        letters.map((column, j) => [column, parsed[i][j] ?? ""]),
      ),
    })),
  };
  const endRow = (range) =>
    Number(
      String(range ?? "")
        .split("!")
        .at(-1)
        .split(":")
        .at(-1)
        .match(/\d+$/)?.[0] || 0,
    );
  const dataEnd = endRow(result.current_region),
    readEnd = endRow(result.actual_range);
  if (dataEnd && readEnd && dataEnd > readEnd)
    output.data_not_fully_read = {
      read_through_row: readEnd,
      data_extends_through_row: dataEnd,
      unread_rows: dataEnd - readEnd,
      reread_range: result.current_region,
    };
  for (const key of [
    "annotated_csv",
    "row_indices",
    "col_indices",
    "warning_message",
  ])
    delete output[key];
  return output;
}

async function firstLegacySheet(ctx, token) {
  const data = await req(
    ctx,
    "GET",
    `/open-apis/sheets/v3/spreadsheets/${enc(token)}/sheets/query`,
  );
  const id = data.sheets?.[0]?.sheet_id;
  if (!id && !ctx.dryRun)
    throw new CliError("api", "Spreadsheet has no sheets", { code: 5 });
  return id ?? "<first_sheet_id>";
}
function legacyRange(f, values, point = false) {
  let range = f.range
    ? String(f.range).replaceAll("！", "!").replaceAll("：", ":")
    : f["sheet-id"]
      ? `${f["sheet-id"]}!A1`
      : "";
  if (range && !range.includes("!")) {
    if (!f["sheet-id"])
      fail("--sheet-id is required for a range without a sheet prefix");
    range = `${f["sheet-id"]}!${range}`;
  }
  if (values && !range.includes(":")) {
    const match = range.match(/^(.*!)([A-Za-z]+)(\d+)$/);
    if (!match) fail("Write range must be a cell or rectangle");
    const col =
      Array.from(match[2].toUpperCase()).reduce(
        (n, c) => n * 26 + c.charCodeAt(0) - 64,
        0,
      ) - 1;
    const width = Math.max(
      ...values.map((x) => (Array.isArray(x) ? x.length : 0)),
    );
    range = `${range}:${colName(col + Math.max(width, 1) - 1)}${Number(match[3]) + values.length - 1}`;
  } else if (point && /![A-Za-z]+\d+$/.test(range))
    range += ":" + range.split("!")[1];
  return range;
}
async function executeLegacySheets(ctx, command, original) {
  const f = { ...original };
  for (const flag of commandSpecs.sheets[command].flags ?? []) {
    if (flag.required && !has(f, flag.name)) fail(`--${flag.name} is required`);
    if (!has(f, flag.name) && flag.default !== undefined)
      f[flag.name] = flag.default;
    if (has(f, flag.name) && ["int", "int64", "float64"].includes(flag.type))
      f[flag.name] = Number(f[flag.name]);
  }
  if (command === "+create") {
    const rows = [
      ...(f.headers ? [await json(ctx, f.headers, "headers", "array")] : []),
      ...(f.data ? await json(ctx, f.data, "data", "array") : []),
    ];
    if (rows.some((x) => !Array.isArray(x)))
      fail("--data must be a two-dimensional array");
    const data = await req(
      ctx,
      "POST",
      "/open-apis/sheets/v3/spreadsheets",
      undefined,
      { title: required(f, "title"), ...pick(f, ["folder-token"]) },
    );
    const ss = data.spreadsheet ?? data;
    const token =
      ss.spreadsheet_token ??
      ss.token ??
      (ctx.dryRun ? "<created_spreadsheet_token>" : undefined);
    if (!token)
      throw new CliError("api", "Spreadsheet created without a token", {
        code: 5,
      });
    if (rows.length) {
      try {
        const sid = await firstLegacySheet(ctx, token);
        await req(
          ctx,
          "POST",
          `/open-apis/sheets/v2/spreadsheets/${enc(token)}/values_append`,
          undefined,
          { valueRange: { range: sid, values: rows } },
        );
      } catch (e) {
        throw new CliError(
          "partial_success",
          `Spreadsheet created but initial fill failed: ${e.message}`,
          { code: 5, detail: { spreadsheet_token: token } },
        );
      }
    }
    return {
      spreadsheet_token: token,
      title: f.title,
      url:
        ss.url ??
        (ctx.config.webBaseUrl
          ? `${ctx.config.webBaseUrl}/sheets/${enc(token)}`
          : undefined),
    };
  }
  const token = sheetToken(f);
  const v2 = `/open-apis/sheets/v2/spreadsheets/${enc(token)}`;
  const v3 = `/open-apis/sheets/v3/spreadsheets/${enc(token)}`;
  if (command === "+export") return executeSheets(ctx, "+workbook-export", f);
  if (command === "+info") {
    const spreadsheet = await req(ctx, "GET", v3);
    const sheets = await req(ctx, "GET", `${v3}/sheets/query`);
    return { spreadsheet, sheets };
  }
  if (["+read", "+write", "+append", "+write-image"].includes(command)) {
    if (!f["sheet-id"] && !String(f.range ?? "").includes("!"))
      f["sheet-id"] = await firstLegacySheet(ctx, token);
    if (command === "+read")
      return req(
        ctx,
        "GET",
        `${v2}/values/${enc(legacyRange(f, undefined, true))}`,
        clean({ valueRenderOption: f["value-render-option"] }),
      );
    if (command === "+write-image") {
      const image = ctx.dryRun
        ? "<base64_image_bytes>"
        : (await readFile(await safeFile(ctx, required(f, "image")))).toString(
            "base64",
          );
      return req(ctx, "POST", `${v2}/values_image`, undefined, {
        range: legacyRange(f, undefined, true),
        image,
        name: f.name ?? path.basename(required(f, "image")),
      });
    }
    const values = await json(ctx, f.values, "values", "array");
    if (!values.length || values.some((x) => !Array.isArray(x)))
      fail("--values must be a non-empty two-dimensional array");
    return req(
      ctx,
      command === "+write" ? "PUT" : "POST",
      `${v2}/${command === "+write" ? "values" : "values_append"}`,
      undefined,
      { valueRange: { range: legacyRange(f, values), values } },
    );
  }
  if (command === "+find" || command === "+replace") {
    const sid = required(f, "sheet-id");
    const find_condition = {
      range: f.range ? legacyRange(f, undefined, command === "+find") : sid,
      match_case:
        command === "+find" ? !yes(f["ignore-case"]) : yes(f["match-case"]),
      match_entire_cell: yes(f["match-entire-cell"]),
      search_by_regex: yes(f["search-by-regex"]),
      include_formulas: yes(f["include-formulas"]),
    };
    return req(
      ctx,
      "POST",
      `${v3}/sheets/${enc(sid)}/${command === "+find" ? "find" : "replace"}`,
      undefined,
      {
        find_condition,
        find: required(f, "find"),
        ...(command === "+replace" ? { replacement: f.replacement ?? "" } : {}),
      },
    );
  }
  if (
    [
      "+set-style",
      "+batch-set-style",
      "+merge-cells",
      "+unmerge-cells",
    ].includes(command)
  ) {
    if (command === "+batch-set-style")
      return req(ctx, "PUT", `${v2}/styles_batch_update`, undefined, {
        data: await json(ctx, f.data, "data", "array"),
      });
    const range = legacyRange({ ...f, range: required(f, "range") });
    if (command === "+set-style")
      return req(ctx, "PUT", `${v2}/style`, undefined, {
        appendStyle: { range, style: await json(ctx, f.style, "style") },
      });
    return req(
      ctx,
      "POST",
      `${v2}/${command === "+merge-cells" ? "merge_cells" : "unmerge_cells"}`,
      undefined,
      {
        range,
        ...(command === "+merge-cells"
          ? { mergeType: required(f, "merge-type") }
          : {}),
      },
    );
  }
  if (command.includes("dropdown")) {
    const op = command.slice(1).split("-")[0];
    const url = `${v2}/dataValidation`;
    if (op === "get")
      return req(ctx, "GET", url, {
        range: required(f, "range"),
        dataValidationType: "list",
      });
    if (op === "delete")
      return req(ctx, "DELETE", url, undefined, {
        dataValidationRanges: (
          await json(ctx, f.ranges, "ranges", "array")
        ).map((range) => ({ range })),
      });
    const conditionValues = await json(
      ctx,
      f["condition-values"],
      "condition-values",
      "array",
    );
    const options = {};
    if (has(f, "multiple")) options.multipleValues = yes(f.multiple);
    if (has(f, "highlight")) options.highlightValidData = yes(f.highlight);
    if (f.colors) {
      options.colors = await json(ctx, f.colors, "colors", "array");
      if (options.colors.length !== conditionValues.length)
        fail("--colors length must match --condition-values");
    }
    const dataValidation = {
      conditionValues,
      ...(Object.keys(options).length ? { options } : {}),
    };
    return req(
      ctx,
      op === "set" ? "POST" : "PUT",
      op === "set" ? url : `${url}/${enc(required(f, "sheet-id"))}`,
      undefined,
      {
        ...(op === "set"
          ? { range: required(f, "range") }
          : { ranges: await json(ctx, f.ranges, "ranges", "array") }),
        dataValidationType: "list",
        dataValidation,
      },
    );
  }
  if (command.endsWith("-dimension")) {
    const op = command.slice(1).split("-")[0];
    const sid = required(f, "sheet-id");
    const dimension = required(f, "dimension");
    if (!["ROWS", "COLUMNS"].includes(dimension))
      fail("--dimension must be ROWS or COLUMNS");
    if (op === "move")
      return req(
        ctx,
        "POST",
        `${v3}/sheets/${enc(sid)}/move_dimension`,
        undefined,
        {
          source: {
            major_dimension: dimension,
            start_index: ints(f, "start-index", 0),
            end_index: ints(f, "end-index", 0),
          },
          destination_index: ints(f, "destination-index", 0),
        },
      );
    const range = {
      sheetId: sid,
      majorDimension: dimension,
      ...(op === "add"
        ? { length: ints(f, "length", 1, 1, 5000) }
        : {
            startIndex: ints(f, "start-index", 0),
            endIndex: ints(f, "end-index", 1),
          }),
    };
    const body = { dimension: range };
    if (op === "insert" && f["inherit-style"])
      body.inheritStyle = f["inherit-style"];
    if (op === "update")
      body.dimensionProperties = clean({
        visible: has(f, "visible") ? yes(f.visible) : undefined,
        fixedSize: has(f, "fixed-size")
          ? ints(f, "fixed-size", 1, 1)
          : undefined,
      });
    return req(
      ctx,
      op === "update" ? "PUT" : op === "delete" ? "DELETE" : "POST",
      `${v2}/${op === "insert" ? "insert_dimension_range" : "dimension_range"}`,
      undefined,
      body,
    );
  }
  if (
    ["+create-sheet", "+copy-sheet", "+delete-sheet", "+update-sheet"].includes(
      command,
    )
  ) {
    const url = `${v2}/sheets_batch_update`;
    let operation;
    if (command === "+create-sheet")
      operation = {
        addSheet: {
          properties: clean({
            title: f.title,
            index: has(f, "index") ? ints(f, "index", 0) : undefined,
          }),
        },
      };
    else if (command === "+copy-sheet")
      operation = {
        copySheet: {
          source: { sheetId: required(f, "sheet-id") },
          ...(f.title ? { destination: { title: f.title } } : {}),
        },
      };
    else if (command === "+delete-sheet")
      operation = { deleteSheet: { sheetId: required(f, "sheet-id") } };
    else {
      const properties = {
        sheetId: required(f, "sheet-id"),
        ...clean({
          title: f.title,
          index: has(f, "index") ? ints(f, "index", 0) : undefined,
          hidden: has(f, "hidden") ? yes(f.hidden) : undefined,
          frozenRowCount: f["frozen-row-count"],
          frozenColCount: f["frozen-col-count"],
        }),
      };
      if (f.lock || f["lock-info"] || f["user-ids"])
        properties.protect = {
          lock: f.lock ?? "",
          ...clean({
            lockInfo: f["lock-info"],
            userIDs: f["user-ids"]
              ? await json(ctx, f["user-ids"], "user-ids", "array")
              : undefined,
          }),
        };
      operation = { updateSheet: { properties } };
    }
    const result = await req(ctx, "POST", url, pick(f, ["user-id-type"]), {
      requests: [operation],
    });
    if (command === "+copy-sheet" && has(f, "index")) {
      const sid =
        result.replies?.[0]?.copySheet?.properties?.sheetId ??
        (ctx.dryRun ? "<copied_sheet_id>" : undefined);
      if (!sid)
        throw new CliError(
          "partial_success",
          "Sheet copied but response has no copied sheet ID for movement",
          { code: 5, detail: result },
        );
      await req(ctx, "POST", url, undefined, {
        requests: [
          {
            updateSheet: {
              properties: { sheetId: sid, index: ints(f, "index", 0) },
            },
          },
        ],
      });
    }
    return result;
  }
  if (command === "+media-upload")
    return upload(ctx, required(f, "file"), token, "sheet_image");
  if (command.includes("filter-view") || command.includes("float-image")) {
    const condition = command.includes("condition");
    const floating = command.includes("float-image");
    const op = command.slice(1).split("-")[0];
    const sid = required(f, "sheet-id");
    let url = `${v3}/sheets/${enc(sid)}/${floating ? "float_images" : "filter_views"}`;
    if (condition || !["create", "list"].includes(op))
      url +=
        "/" + enc(required(f, floating ? "float-image-id" : "filter-view-id"));
    if (condition) url += "/conditions";
    if (condition && !["create", "list"].includes(op))
      url += "/" + enc(required(f, "condition-id"));
    if (op === "list") url += "/query";
    let body;
    if (op === "create" || op === "update") {
      if (condition) {
        body = pick(f, ["filter-type", "compare-type"]);
        if (op === "create") body.condition_id = required(f, "condition-id");
        if (f.expected)
          body.expected = await json(ctx, f.expected, "expected", "array");
      } else if (floating)
        body = pick(f, [
          "float-image-token",
          "range",
          "width",
          "height",
          "offset-x",
          "offset-y",
          ...(op === "create" ? ["float-image-id"] : []),
        ]);
      else
        body = pick(f, [
          "range",
          "filter-view-name",
          ...(op === "create" ? ["filter-view-id"] : []),
        ]);
    }
    return req(
      ctx,
      {
        create: "POST",
        update: condition ? "PUT" : "PATCH",
        get: "GET",
        list: "GET",
        delete: "DELETE",
      }[op],
      url,
      undefined,
      body,
    );
  }
  return undefined;
}
