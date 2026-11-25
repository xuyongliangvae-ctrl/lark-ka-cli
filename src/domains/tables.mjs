import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile, stat, realpath } from "node:fs/promises";
import path from "node:path";
import { CliError } from "../errors.mjs";
import { isHaiNengProfile } from "../config.mjs";
import { shortcuts as catalog } from "../metadata.mjs";
import { setTimeout as delay } from "node:timers/promises";

const baseV3Module = new URL("./base-v3.mjs", import.meta.url);
const hasSourceBaseV3 = existsSync(baseV3Module);
export const commandSpecs = {
  base: Object.fromEntries(
    catalog.filter((x) => x.service === "base").map((x) => [x.command, x]),
  ),
  sheets: Object.fromEntries(
    catalog.filter((x) => x.service === "sheets").map((x) => [x.command, x]),
  ),
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
  const alias = SHEETS_ALIASES[command];
  if (alias) {
    const [target, next] = await alias(ctx, flags);
    return executeLegacySheets(ctx, target, next);
  }
  return executeLegacySheets(ctx, command, flags);
}

// Sheet_ai commands are not deployed on HaiNeng. These aliases map them to the
// verified legacy commands listed in the CLI test report (section 4).
async function legacySheetId(ctx, f) {
  if (f["sheet-id"]) return f["sheet-id"];
  const name = f["sheet-name"];
  if (!name) return undefined;
  const token = sheetToken(f);
  const data = await req(
    ctx,
    "GET",
    `/open-apis/sheets/v3/spreadsheets/${enc(token)}/sheets/query`,
  );
  const hit = (data.sheets ?? []).find((s) => (s.title ?? s.name) === name);
  if (!hit && !ctx.dryRun)
    fail(`No sheet named ${name} in spreadsheet ${token}`);
  return hit?.sheet_id ?? `<sheet_id_for_${name}>`;
}
async function withLegacySheetId(ctx, f) {
  const next = { ...f };
  const id = await legacySheetId(ctx, f);
  if (id && !next["sheet-id"]) next["sheet-id"] = id;
  delete next["sheet-name"];
  return next;
}
const SHEETS_ALIASES = {
  "+workbook-info": async (ctx, f) => ["+info", f],
  "+workbook-create": async (ctx, f) => {
    const next = { ...f };
    if (next.values !== undefined && next.data === undefined)
      next.data = next.values;
    delete next.values;
    return ["+create", next];
  },
  "+export": async (ctx, f) => ["+workbook-export", f],
  "+sheet-info": async (ctx, f) => ["+info", f],
  "+sheet-copy": async (ctx, f) => [
    "+copy-sheet",
    await withLegacySheetId(ctx, f),
  ],
  "+sheet-create": async (ctx, f) => ["+create-sheet", f],
  "+sheet-delete": async (ctx, f) => [
    "+delete-sheet",
    await withLegacySheetId(ctx, f),
  ],
  "+sheet-hide": async (ctx, f) => [
    "+update-sheet",
    { ...(await withLegacySheetId(ctx, f)), hidden: true },
  ],
  "+sheet-unhide": async (ctx, f) => [
    "+update-sheet",
    { ...(await withLegacySheetId(ctx, f)), hidden: false },
  ],
  "+sheet-move": async (ctx, f) => [
    "+update-sheet",
    await withLegacySheetId(ctx, f),
  ],
  "+sheet-rename": async (ctx, f) => [
    "+update-sheet",
    await withLegacySheetId(ctx, f),
  ],
  "+cells-merge": async (ctx, f) => [
    "+merge-cells",
    has(f, "merge-type") ? f : { ...f, "merge-type": "MERGE_ALL" },
  ],
  "+cells-unmerge": async (ctx, f) => ["+unmerge-cells", f],
  "+cells-replace": async (ctx, f) => [
    "+replace",
    withFlagName(f, "regex", "search-by-regex"),
  ],
  "+cells-search": async (ctx, f) => [
    "+find",
    withInvertedCase(withFlagName(f, "regex", "search-by-regex")),
  ],
  "+cells-set-image": async (ctx, f) => ["+write-image", f],
  "+dropdown-delete": async (ctx, f) => ["+delete-dropdown", f],
  "+dropdown-get": async (ctx, f) => ["+get-dropdown", f],
  "+dropdown-set": async (ctx, f) => ["+set-dropdown", f],
  "+dropdown-update": async (ctx, f) => ["+update-dropdown", f],
  "+filter-view-create": async (ctx, f) => {
    const next = { ...f };
    if (next["view-name"] && !next["filter-view-name"])
      next["filter-view-name"] = next["view-name"];
    delete next["view-name"];
    delete next["properties"];
    return ["+create-filter-view", next];
  },
  "+filter-view-list": async (ctx, f) => ["+list-filter-views", f],
};
function withFlagName(f, from, to) {
  if (!has(f, from)) return { ...f };
  const next = { ...f, [to]: f[from] };
  delete next[from];
  return next;
}
function withInvertedCase(f) {
  if (!has(f, "match-case")) return f;
  const next = { ...f, "ignore-case": !yes(f["match-case"]) };
  delete next["match-case"];
  return next;
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
function colName(index) {
  let s = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
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
  if (command === "+workbook-export") {
    const token = sheetToken(f);
    const ext = f["file-extension"] ?? "xlsx";
    if (!["xlsx", "csv"].includes(ext))
      fail("--file-extension must be xlsx or csv");
    const sheetId =
      f["sheet-id"] || f["sheet-name"]
        ? await legacySheetId(ctx, f)
        : undefined;
    if (ext === "csv" && !sheetId)
      fail("--sheet-id is required for csv export");
    const body = clean({
      token,
      type: "sheet",
      file_extension: ext,
      sub_id: sheetId,
    });
    const created = await req(
      ctx,
      "POST",
      "/open-apis/drive/v1/export_tasks",
      undefined,
      body,
    );
    if (ctx.dryRun) {
      await req(ctx, "GET", "/open-apis/drive/v1/export_tasks/<ticket>", {
        token,
      });
      if (f["output-path"])
        await ctx.request(
          "GET",
          "/open-apis/drive/v1/export_tasks/file/<file_token>/download",
          { responseType: "buffer" },
        );
      return { dry_run: true };
    }
    if (!created.ticket)
      throw new CliError("api", "Export task returned no ticket", { code: 5 });
    let completed;
    for (let attempt = 0; attempt < 30; attempt++) {
      completed = await req(
        ctx,
        "GET",
        `/open-apis/drive/v1/export_tasks/${enc(created.ticket)}`,
        { token },
      );
      const state = (completed.result ?? completed).job_status;
      if (state === 0) break;
      if (state !== undefined && state !== 1 && state !== 2)
        throw new CliError("api", `Export failed with status ${state}`, {
          code: 5,
          detail: completed,
        });
      await delay(1000);
    }
    const result = completed?.result ?? completed ?? {};
    if (result.job_status !== 0)
      throw new CliError("api", "Export task did not finish", {
        code: 5,
        detail: completed,
      });
    if (!f["output-path"]) return { ...completed, ticket: created.ticket };
    if (!result.file_token)
      throw new CliError("api", "Export completed without a file_token", {
        code: 5,
        detail: completed,
      });
    const bytes = await ctx.request(
      "GET",
      `/open-apis/drive/v1/export_tasks/file/${enc(result.file_token)}/download`,
      { responseType: "buffer" },
    );
    await writeFile(f["output-path"], Buffer.from(bytes));
    return { ...completed, ticket: created.ticket, path: f["output-path"] };
  }
  const token = sheetToken(f);
  const v2 = `/open-apis/sheets/v2/spreadsheets/${enc(token)}`;
  const v3 = `/open-apis/sheets/v3/spreadsheets/${enc(token)}`;
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
