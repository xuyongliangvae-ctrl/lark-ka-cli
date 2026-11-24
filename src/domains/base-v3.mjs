import { stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "../errors.mjs";

export function createBaseV3Executor({
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
}) {
  function basePath(f, ...parts) {
    return (
      "/open-apis/base/v3/bases/" +
      enc(required(f, "base-token")) +
      (parts.length ? "/" + parts.map(enc).join("/") : "")
    );
  }
  function tablePath(f, ...parts) {
    return basePath(f, "tables", required(f, "table-id"), ...parts);
  }

  async function offsetPages(ctx, f, url, key, max = 100, all = false) {
    const query = {
      offset: ints(f, "offset", 0),
      limit: ints(f, "limit", max, 1, max),
    };
    const rows = [];
    let last;
    for (let n = 0; n < 10000; n++) {
      last = await req(ctx, "GET", url, query);
      const batch = last[key] ?? last.items ?? [];
      if (!Array.isArray(batch))
        throw new CliError("api", `${key} response must be an array`, {
          code: 5,
        });
      rows.push(...batch);
      if (
        ctx.dryRun ||
        !all ||
        !batch.length ||
        batch.length < query.limit ||
        (last.total > 0 && query.offset + batch.length >= last.total)
      )
        return { ...last, [key]: rows, total: last.total ?? rows.length };
      query.offset += batch.length;
    }
    throw new CliError("api", "Pagination exceeded 10000 pages", { code: 5 });
  }
  async function tokenPages(ctx, method, url, options, key) {
    const result = [];
    const seen = new Set();
    let next;
    let last;
    for (let page = 0; page < 10000; page++) {
      const container = method === "GET" ? "query" : "body";
      last = await ctx.request(method, url, {
        ...options,
        [container]: clean({ ...options[container], page_token: next }),
      });
      result.push(...(last[key] ?? []));
      if (ctx.dryRun || !last.has_more)
        return { ...last, [key]: result, total: result.length };
      next = last.page_token;
      if (!next || seen.has(next))
        throw new CliError(
          "api",
          "Pagination returned a missing or repeated page token",
          { code: 5 },
        );
      seen.add(next);
    }
    throw new CliError("api", "Pagination exceeded 10000 pages", { code: 5 });
  }

  async function executeBaseV3(ctx, action, f) {
    if (action === "record-batch-create" && f["client-token"] !== undefined)
      fail("--client-token requires the Bitable v1 backend");
    if (["base-create", "base-copy", "base-get"].includes(action)) {
      const method = action === "base-get" ? "GET" : "POST";
      const url =
        action === "base-create"
          ? "/open-apis/base/v3/bases"
          : basePath(f, ...(action === "base-copy" ? ["copy"] : []));
      const body =
        method === "GET"
          ? undefined
          : pick(f, ["name", "folder-token", "without-content", "time-zone"]);
      if (action === "base-create") required(f, "name");
      const base = await req(ctx, method, url, undefined, body);
      const result = {
        base,
        ...(action === "base-get"
          ? {}
          : { [action === "base-create" ? "created" : "copied"]: true }),
      };
      if (action !== "base-get" && ctx.identity === "bot")
        result.permission_grant = await grantCurrentUser(
          ctx,
          base.base_token ?? base.app_token ?? base.base?.base_token,
          "bitable",
        );
      return result;
    }
    if (action.startsWith("advperm-"))
      return req(ctx, "PUT", basePath(f, "advperm", "enable"), {
        enable: action === "advperm-enable",
      });
    if (action === "data-query") {
      const body = await json(ctx, f.dsl, "dsl");
      if (!has(body, "dimensions") && !has(body, "measures"))
        fail("--dsl must include dimensions or measures");
      return req(ctx, "POST", basePath(f, "data", "query"), undefined, body);
    }
    if (action.startsWith("base-block-")) {
      const op = action.slice(11);
      let body;
      let method = "POST";
      let url;
      if (op === "list") {
        url = basePath(f, "blocks", "list");
        body = pick(f, ["parent-id"]);
      } else if (op === "create") {
        url = basePath(f, "blocks");
        body = {
          type: required(f, "type"),
          name: required(f, "name"),
          ...pick(f, ["parent-id"]),
        };
      } else {
        url = basePath(
          f,
          "blocks",
          required(f, "block-id"),
          ...(op === "delete" ? [] : [op]),
        );
        if (op === "delete") method = "DELETE";
        if (op === "rename") body = { name: required(f, "name") };
        if (op === "move") {
          if (f["before-id"] && f["after-id"])
            fail("--before-id and --after-id are mutually exclusive");
          body = {
            parent_id: f["parent-id"] ?? null,
            ...pick(f, ["before-id", "after-id"]),
          };
        }
      }
      const data = await req(ctx, method, url, undefined, body);
      if (op === "list")
        return f.type && Array.isArray(data.blocks)
          ? {
              ...data,
              blocks: data.blocks.filter((x) => x.type === f.type),
              total: data.blocks.filter((x) => x.type === f.type).length,
            }
          : data;
      return {
        block: data,
        [op === "create"
          ? "created"
          : op === "delete"
            ? "deleted"
            : op === "move"
              ? "moved"
              : "renamed"]: true,
      };
    }
    if (action.startsWith("table-")) {
      const op = action.slice(6);
      if (op === "list")
        return offsetPages(ctx, f, basePath(f, "tables"), "tables", 100);
      if (op === "get") {
        const table = await req(ctx, "GET", tablePath(f));
        const fields = await offsetPages(
          ctx,
          {},
          tablePath(f, "fields"),
          "fields",
          100,
          true,
        );
        const views = await offsetPages(
          ctx,
          {},
          tablePath(f, "views"),
          "views",
          100,
          true,
        );
        return { table, fields: fields.fields, views: views.views };
      }
      if (op === "delete") {
        await req(ctx, "DELETE", tablePath(f));
        return {
          deleted: true,
          table_id: f["table-id"],
          table_name: f["table-id"],
        };
      }
      const name = required(f, "name");
      const fields = f.fields
        ? await json(ctx, f.fields, "fields", "array")
        : [];
      const viewsRaw = f.view ? await ctx.input(f.view) : undefined;
      let views = [];
      if (viewsRaw) {
        try {
          const v =
            typeof viewsRaw === "object" ? viewsRaw : JSON.parse(viewsRaw);
          views = Array.isArray(v) ? v : [v];
        } catch {
          fail("--view must be valid JSON");
        }
      }
      const table = await req(
        ctx,
        op === "create" ? "POST" : "PATCH",
        op === "create" ? basePath(f, "tables") : tablePath(f),
        undefined,
        { name },
      );
      const result = { table, ...(op === "update" ? { updated: true } : {}) };
      if (op === "create" && (fields.length || views.length)) {
        const tableId =
          table.table_id ??
          table.id ??
          table.table?.table_id ??
          (ctx.dryRun ? "<created_table_id>" : undefined);
        if (!tableId)
          throw new CliError(
            "partial_success",
            "Table created but response has no table_id for subsequent field/view operations",
            { code: 5, detail: { table } },
          );
        const target = { ...f, "table-id": tableId };
        if (fields.length) {
          const initial = await offsetPages(
            ctx,
            {},
            tablePath(target, "fields"),
            "fields",
            100,
            true,
          );
          result.fields = [];
          for (let i = 0; i < fields.length; i++) {
            const id =
              i === 0
                ? (initial.fields[0]?.field_id ?? initial.fields[0]?.id)
                : undefined;
            result.fields.push(
              await req(
                ctx,
                id ? "PUT" : "POST",
                tablePath(target, "fields", ...(id ? [id] : [])),
                undefined,
                fields[i],
              ),
            );
          }
        }
        if (views.length) {
          result.views = [];
          for (const body of views)
            result.views.push(
              await req(
                ctx,
                "POST",
                tablePath(target, "views"),
                undefined,
                body,
              ),
            );
        }
      }
      return result;
    }
    if (action.startsWith("field-")) {
      const op = action.slice(6);
      const collection = tablePath(f, "fields");
      if (op === "list") return offsetPages(ctx, f, collection, "fields", 200);
      const url =
        op === "create"
          ? collection
          : tablePath(
              f,
              "fields",
              required(f, "field-id"),
              ...(op === "search-options" ? ["options"] : []),
            );
      if (op === "search-options")
        return req(ctx, "GET", url, {
          offset: ints(f, "offset", 0),
          limit: ints(f, "limit", 30, 1, 200),
          ...clean({ query: f.keyword }),
        });
      let body;
      if (op === "create" || op === "update") {
        body = await json(ctx, f.json, "json");
        if (
          ["formula", "lookup"].includes(body.type) &&
          !yes(f["i-have-read-guide"])
        )
          fail("--i-have-read-guide is required for formula and lookup fields");
      }
      const field = await req(
        ctx,
        { get: "GET", create: "POST", update: "PUT", delete: "DELETE" }[op],
        url,
        undefined,
        body,
      );
      return op === "delete"
        ? { deleted: true, field_id: f["field-id"], field_name: f["field-id"] }
        : {
            field,
            ...(op === "get"
              ? {}
              : { [op === "create" ? "created" : "updated"]: true }),
          };
    }
    if (action.startsWith("view-")) {
      const op = action.slice(5);
      if (op === "list")
        return offsetPages(ctx, f, tablePath(f, "views"), "views", 200);
      if (op === "create") {
        let raw = f.json;
        if (typeof raw === "string") {
          try {
            raw = JSON.parse(await ctx.input(raw));
          } catch {
            fail("--json must be valid JSON");
          }
        }
        const bodies = Array.isArray(raw) ? raw : [raw];
        const views = [];
        for (const body of bodies) {
          if (!body || typeof body !== "object" || !body.name)
            fail("Each view requires a name");
          views.push(
            await req(ctx, "POST", tablePath(f, "views"), undefined, {
              type: "grid",
              ...body,
            }),
          );
        }
        return { views };
      }
      const base = tablePath(f, "views", required(f, "view-id"));
      if (op === "get") return { view: await req(ctx, "GET", base) };
      if (op === "delete") {
        await req(ctx, "DELETE", base);
        return { deleted: true, view_id: f["view-id"] };
      }
      if (op === "rename")
        return req(ctx, "PATCH", base, undefined, {
          name: required(f, "name"),
        });
      const [mode, ...rest] = op.split("-");
      const segment = rest.join("_");
      const body = mode === "set" ? await json(ctx, f.json, "json") : undefined;
      return {
        [segment]: await req(
          ctx,
          mode === "get" ? "GET" : "PUT",
          `${base}/${segment}`,
          undefined,
          body,
        ),
      };
    }
    if (action.startsWith("record-")) return executeRecords(ctx, action, f);
    if (action === "form-detail")
      return req(
        ctx,
        "POST",
        "/open-apis/base/v3/bases/tables/forms/detail",
        undefined,
        { share_token: required(f, "share-token") },
      );
    if (action === "form-submit") {
      const data = await json(ctx, f.json, "json");
      if (!data.fields && !data.attachments)
        fail("--json must contain fields or attachments");
      const content = data.fields ?? {};
      if (!content || Array.isArray(content) || typeof content !== "object")
        fail("--json.fields must be an object");
      if (data.attachments)
        for (const [field, files] of Object.entries(data.attachments)) {
          if (!Array.isArray(files))
            fail("--json.attachments must map fields to file arrays");
          const items = [];
          for (const filename of files)
            items.push(
              await upload(
                ctx,
                filename,
                required(f, "base-token"),
                "bitable_tmp_point",
                JSON.stringify({ share_token: required(f, "share-token") }),
              ),
            );
          content[field] = [...(content[field] ?? []), ...items];
        }
      return req(
        ctx,
        "POST",
        "/open-apis/base/v3/bases/tables/forms/submit",
        undefined,
        { share_token: required(f, "share-token"), content },
      );
    }
    if (action.startsWith("form-")) {
      const op = action.slice(5);
      const url = tablePath(f, "forms");
      if (op === "list")
        return tokenPages(
          ctx,
          "GET",
          url,
          { query: { page_size: ints(f, "page-size", 100, 1, 100) } },
          "forms",
        );
      if (op === "create")
        return req(ctx, "POST", url, undefined, {
          name: required(f, "name"),
          ...pick(f, ["description"]),
        });
      const form = `${url}/${enc(required(f, "form-id"))}`;
      if (op.startsWith("questions-")) {
        const operation = op.slice(10);
        const method = {
          list: "GET",
          create: "POST",
          update: "PATCH",
          delete: "DELETE",
        }[operation];
        const body =
          operation === "list"
            ? undefined
            : operation === "delete"
              ? {
                  question_ids: await json(
                    ctx,
                    f["question-ids"],
                    "question-ids",
                    "array",
                  ),
                }
              : {
                  questions: await json(ctx, f.questions, "questions", "array"),
                };
        return req(ctx, method, `${form}/questions`, undefined, body);
      }
      return req(
        ctx,
        { get: "GET", update: "PATCH", delete: "DELETE" }[op],
        form,
        undefined,
        op === "update" ? pick(f, ["name", "description"]) : undefined,
      );
    }
    if (action.startsWith("role-")) {
      const op = action.slice(5);
      const url = basePath(
        f,
        "roles",
        ...(["list", "create"].includes(op) ? [] : [required(f, "role-id")]),
      );
      const body = ["create", "update"].includes(op)
        ? await json(ctx, f.json, "json")
        : undefined;
      return req(
        ctx,
        {
          list: "GET",
          get: "GET",
          create: "POST",
          update: "PUT",
          delete: "DELETE",
        }[op],
        url,
        undefined,
        body,
      );
    }
    if (action.startsWith("workflow-")) {
      const op = action.slice(9);
      if (op === "list")
        return tokenPages(
          ctx,
          "POST",
          basePath(f, "workflows", "list"),
          {
            body: {
              page_size: ints(f, "page-size", 100, 1, 100),
              ...pick(f, ["status"]),
            },
          },
          "items",
        );
      const url = basePath(
        f,
        "workflows",
        ...(op === "create" ? [] : [required(f, "workflow-id")]),
        ...(["enable", "disable"].includes(op) ? [op] : []),
      );
      const body = ["create", "update"].includes(op)
        ? await json(ctx, f.json, "json")
        : undefined;
      return req(
        ctx,
        {
          get: "GET",
          create: "POST",
          update: "PUT",
          enable: "PATCH",
          disable: "PATCH",
        }[op],
        url,
        op === "get" ? pick(f, ["user-id-type"]) : undefined,
        body,
      );
    }
    if (action.startsWith("dashboard-")) {
      if (action === "dashboard-block-get-data")
        return req(
          ctx,
          "GET",
          basePath(f, "dashboards", "blocks", required(f, "block-id"), "data"),
        );
      const block = action.startsWith("dashboard-block-");
      const op = action.slice(block ? 16 : 10);
      const parts = ["dashboards"];
      if (block || !["list", "create"].includes(op))
        parts.push(required(f, "dashboard-id"));
      if (block) {
        parts.push("blocks");
        if (!["list", "create"].includes(op))
          parts.push(required(f, "block-id"));
      }
      if (op === "arrange") parts.push("arrange");
      let body;
      if (["create", "update"].includes(op)) {
        if (op === "create" && !block) required(f, "name");
        body = pick(f, ["name", ...(block ? ["type"] : [])]);
        if (f["theme-style"]) body.theme = { theme_style: f["theme-style"] };
        if (f["data-config"])
          body.data_config = await json(ctx, f["data-config"], "data-config");
      }
      if (op === "arrange") body = {};
      const query =
        op === "list"
          ? pick(f, ["page-size", "page-token"])
          : pick(f, ["user-id-type"]);
      return req(
        ctx,
        {
          list: "GET",
          get: "GET",
          create: "POST",
          update: "PATCH",
          delete: "DELETE",
          arrange: "POST",
        }[op],
        basePath(f, ...parts),
        query,
        body,
      );
    }
    return undefined;
  }

  async function executeRecords(ctx, action, f) {
    if (action === "record-history-list")
      return req(ctx, "GET", basePath(f, "record_history"), {
        table_id: required(f, "table-id"),
        record_id: required(f, "record-id"),
        page_size: ints(f, "page-size", 20, 1, 100),
        ...pick(f, ["max-version"]),
      });
    const records = tablePath(f, "records");
    if (action === "record-list") {
      const query = {
        offset: ints(f, "offset", 0),
        limit: ints(f, "limit", 20, 1, 200),
        ...pick(f, ["view-id"]),
      };
      if (f["field-id"]) query.field_id = list(f["field-id"]);
      if (f["filter-json"])
        query.filter = JSON.stringify(
          await json(ctx, f["filter-json"], "filter-json"),
        );
      if (f["sort-json"]) {
        const v = await json(
          ctx,
          f["sort-json"],
          "sort-json",
          Array.isArray(f["sort-json"]) ||
            String(f["sort-json"]).trim().startsWith("[")
            ? "array"
            : "object",
        );
        query.sort = JSON.stringify(v.sort_config ?? v);
      }
      return req(ctx, "GET", records, query);
    }
    if (["record-get", "record-delete"].includes(action)) {
      if (f.json && f["record-id"])
        fail("--json and --record-id are mutually exclusive");
      const body = f.json
        ? await json(ctx, f.json, "json")
        : { record_id_list: list(required(f, "record-id")) };
      uniqueStrings(body.record_id_list, "record_id_list", 200);
      if (f["field-id"]) {
        if (body.select_fields)
          fail("--field-id and --json.select_fields are mutually exclusive");
        body.select_fields = list(f["field-id"]);
      }
      if (body.select_fields)
        uniqueStrings(body.select_fields, "select_fields", 100);
      return req(
        ctx,
        "POST",
        `${records}/${action === "record-get" ? "batch_get" : "batch_delete"}`,
        undefined,
        action === "record-delete"
          ? { record_id_list: body.record_id_list }
          : body,
      );
    }
    if (action === "record-search") {
      const body = f.json
        ? await json(ctx, f.json, "json")
        : {
            keyword: required(f, "keyword"),
            search_fields: list(required(f, "search-field")),
            offset: ints(f, "offset", 0),
            limit: ints(f, "limit", 10, 1, 200),
            ...pick(f, ["view-id"]),
          };
      uniqueStrings(body.search_fields, "search_fields", 20);
      if (typeof body.keyword !== "string" || !body.keyword)
        fail("Search keyword must not be empty");
      if (f["field-id"]) body.select_fields = list(f["field-id"]);
      if (f["filter-json"])
        body.filter = await json(ctx, f["filter-json"], "filter-json");
      if (f["sort-json"]) {
        const raw = await ctx.input(f["sort-json"]);
        const parsed = typeof raw === "object" ? raw : JSON.parse(raw);
        body.sort = parsed.sort_config ?? parsed;
      }
      return req(ctx, "POST", `${records}/search`, undefined, body);
    }
    if (action === "record-upsert")
      return req(
        ctx,
        f["record-id"] ? "PATCH" : "POST",
        `${records}${f["record-id"] ? "/" + enc(f["record-id"]) : ""}`,
        undefined,
        await json(ctx, f.json, "json"),
      );
    if (action === "record-batch-create" || action === "record-batch-update")
      return req(
        ctx,
        "POST",
        `${records}/${action === "record-batch-create" ? "batch_create" : "batch_update"}`,
        undefined,
        await json(ctx, f.json, "json"),
      );
    if (action === "record-share-link-create") {
      const ids = [...new Set(list(required(f, "record-ids")))];
      if (ids.length > 100) fail("--record-ids supports at most 100 records");
      return req(ctx, "POST", `${records}/share_links/batch`, undefined, {
        record_ids: ids,
      });
    }
    if (
      action === "record-upload-attachment" ||
      action === "record-remove-attachment"
    ) {
      const record = required(f, "record-id"),
        field = required(f, "field-id");
      await req(ctx, "GET", tablePath(f, "fields", field));
      let items;
      if (action === "record-upload-attachment") {
        const files = list(required(f, "file"));
        if (files.length > 50) fail("At most 50 attachments are allowed");
        items = [];
        for (const file of files)
          items.push(
            await upload(ctx, file, required(f, "base-token"), "bitable_file"),
          );
      } else
        items = uniqueStrings(
          list(required(f, "file-token")),
          "file-token",
          50,
        ).map((file_token) => ({ file_token }));
      const body = { attachments: { [record]: { [field]: items } } };
      return req(
        ctx,
        "POST",
        tablePath(
          f,
          action === "record-upload-attachment"
            ? "append_attachments"
            : "remove_attachments",
        ),
        undefined,
        body,
      );
    }
    if (action === "record-download-attachment") {
      const data = await req(
        ctx,
        "POST",
        tablePath(f, "get_attachments"),
        undefined,
        { record_id_list: [required(f, "record-id")] },
      );
      const wanted = list(f["file-token"]);
      const attachments = [];
      const collect = (value) => {
        if (Array.isArray(value)) for (const item of value) collect(item);
        else if (value && typeof value === "object") {
          if (value.file_token) attachments.push(value);
          else for (const item of Object.values(value)) collect(item);
        }
      };
      collect(data.attachments);
      const files = attachments.filter(
        (x) => !wanted.length || wanted.includes(x.file_token),
      );
      const output = required(f, "output");
      if (ctx.dryRun) {
        await req(
          ctx,
          "GET",
          "/open-apis/drive/v1/medias/<file_token>/download",
          { extra: "<attachment_extra_info>" },
        );
        return data;
      }
      let directory = false;
      try {
        directory = (
          await stat(path.resolve(ctx.cwd ?? process.cwd(), output))
        ).isDirectory();
      } catch {}
      if (!directory && files.length !== 1)
        fail(
          "--output must be an existing directory when downloading multiple attachments",
        );
      const downloaded = [];
      for (const item of files) {
        const filename = directory
          ? path.join(output, path.basename(item.name ?? item.file_token))
          : output;
        const target = await safeFile(ctx, filename, true);
        const bytes = await ctx.request(
          "GET",
          `/open-apis/drive/v1/medias/${enc(item.file_token)}/download`,
          { query: clean({ extra: item.extra_info }), responseType: "buffer" },
        );
        await writeFile(target, bytes, {
          flag: yes(f.overwrite) ? "w" : "wx",
          mode: 0o600,
        });
        downloaded.push({ file_token: item.file_token, output: target });
      }
      return { downloaded };
    }
    return undefined;
  }

  return executeBaseV3;
}
