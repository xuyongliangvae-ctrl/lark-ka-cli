import { readFile } from "node:fs/promises";
import { requestWithTransfers, validateTransferFlags } from "./transfers.mjs";
import { CliError } from "./errors.mjs";
import { CONFIG_FLAGS } from "./config-options.mjs";
export const metadata = JSON.parse(
  await readFile(new URL("../data/api-metadata.json", import.meta.url), "utf8"),
);
const bitableV1 = JSON.parse(
  await readFile(new URL("../data/base-v1.json", import.meta.url), "utf8"),
);
metadata.services.push(bitableV1);
export const packagedShortcuts = JSON.parse(
  await readFile(new URL("../data/shortcuts.json", import.meta.url), "utf8"),
);
const sourceBaseV3 = await readFile(
  new URL("../data/base-v3-shortcuts.json", import.meta.url),
  "utf8",
).catch((error) => {
  if (error.code !== "ENOENT") throw error;
  return "[]";
});
export const shortcuts = [
  ...packagedShortcuts,
  ...JSON.parse(sourceBaseV3),
].sort((a, b) =>
  `${a.service} ${a.command}`.localeCompare(`${b.service} ${b.command}`),
);
// The generated catalog describes the upstream CLI. Help and schema share
// these descriptions for shortcuts with a deployment-specific wire format.
for (const spec of shortcuts) {
  if (spec.command === "+search" && ["docs", "drive"].includes(spec.service)) {
    spec.description = "Search documents with the suite search API";
    const common = {
      query: "keyword (required)",
      "page-size": "default 15; suite: 0–50",
      "page-token": "decimal offset from the last response",
      filter: "JSON object with owner_ids, chat_ids, docs_types",
      "doc-types":
        "doc (both generations), sheet, slides, bitable, mindnote, file",
    };
    for (const f of spec.flags)
      if (Object.hasOwn(common, f.name)) f.description = common[f.name];
  } else if (spec.service === "contact" && spec.command === "+search-user") {
    spec.description +=
      " (HaiNeng Work 7.54 uses search/v1/user with --query and optional --page-token)";
    for (const f of spec.flags) {
      if (f.name === "page-size")
        f.description = "default 20; v1: 1–200, v3: 1–30";
      else if (f.name !== "query") f.description += " (contact v3 only)";
    }
    spec.flags.push({
      name: "page-token",
      type: "string",
      description:
        "contact v1 continuation token returned by the previous page",
    });
  } else if (
    spec.service === "base" &&
    spec.command === "+record-batch-create"
  ) {
    spec.flags.push({
      name: "client-token",
      type: "string",
      description: "optional UUIDv4 idempotency key for Bitable v1",
    });
  } else if (
    spec.service === "base" &&
    ["+table-list", "+field-list", "+record-list", "+record-search"].includes(
      spec.command,
    )
  ) {
    const max = spec.command.startsWith("+record-") ? 500 : 100;
    for (const flag of spec.flags) {
      if (flag.name === "offset")
        flag.description +=
          " (Bitable v1: use --page-token for subsequent pages)";
      if (flag.name === "limit") flag.description += ` (Bitable v1: 1–${max})`;
      if (flag.name === "json")
        flag.description =
          "record search JSON object; for Bitable v1, filter uses conjunction and conditions with field_name, operator, and value";
      if (["keyword", "search-field"].includes(flag.name))
        flag.description =
          flag.name === "keyword"
            ? "search keyword; pair it with --search-field, or use a Bitable v1 filter"
            : "field to search, repeatable (Bitable v1 requires field names)";
    }
    spec.flags.push({
      name: "page-token",
      type: "string",
      description:
        "Bitable v1 continuation token returned by the previous page",
    });
    if (["+record-list", "+record-search"].includes(spec.command)) {
      spec.flags.push(
        {
          name: "filter-json",
          type: "string",
          description:
            "record filter JSON object (Bitable v1: conjunction and conditions)",
        },
        {
          name: "sort-json",
          type: "string",
          description:
            'record sort JSON array, e.g. [{"field_name":"Name","desc":true}] for Bitable v1',
        },
      );
      if (spec.command === "+record-list")
        spec.flags.push({
          name: "json",
          type: "string",
          description: "Bitable v1 record query JSON object",
        });
    }
  }
}
export function apiSpecs() {
  return metadata.services.flatMap((service) =>
    Object.entries(service.resources || {}).flatMap(([resource, r]) =>
      Object.entries(r.methods || {}).map(([method, spec]) => ({
        service: service.name,
        resource,
        method,
        ...spec,
        servicePath: service.servicePath,
      })),
    ),
  );
}
export function findAPI(words) {
  return apiSpecs().find(
    (s) =>
      words.join(" ") === `${s.service} ${s.resource} ${s.method}` ||
      words.join(".") === s.id ||
      words.join(" ") ===
        `${s.service} ${s.resource.replaceAll(".", " ")} ${s.method}`,
  );
}
export async function executeAPI(ctx, spec, flags) {
  validateTransferFlags(spec.httpMethod, flags);
  let params = flags.params ? JSON.parse(await ctx.input(flags.params)) : {};
  let body = flags.data
    ? JSON.parse(await ctx.input(flags.data))
    : flags.body
      ? JSON.parse(await ctx.input(flags.body))
      : undefined;
  if (
    spec.requestBodyRequired &&
    (body === undefined ||
      body === null ||
      typeof body !== "object" ||
      Array.isArray(body))
  )
    throw new CliError(
      "validation",
      "This API requires a JSON request object in --data",
    );
  let route = spec.path;
  const query = {};
  for (const [key, definition] of Object.entries(spec.parameters || {})) {
    const value =
      params[key] ?? flags[key.replaceAll("_", "-")] ?? definition.default;
    if (definition.required && (value === undefined || value === ""))
      throw new CliError("validation", `Missing parameter: ${key}`);
    if (value === undefined || value === "") continue;
    if (definition.location === "path")
      route = route
        .replaceAll(`{${key}}`, encodeURIComponent(String(value)))
        .replaceAll(`:${key}`, encodeURIComponent(String(value)));
    else query[key] = value;
  }
  for (const [key, value] of Object.entries(params))
    if (!(spec.parameters?.[key]?.location === "path")) query[key] = value;
  if (/\{\w+\}/.test(route))
    throw new CliError("validation", `Unresolved path parameters: ${route}`);
  const apiPath = route.startsWith("/open-apis/")
    ? route
    : `${spec.servicePath.replace(/\/$/, "")}/${route.replace(/^\//, "")}`;
  const fileFields = Object.entries(spec.requestBody || {})
    .filter(([, value]) => value.type === "file")
    .map(([key]) => key);
  return requestWithTransfers(
    ctx,
    spec.httpMethod,
    apiPath,
    { query, body },
    flags,
    { fileFields },
  );
}

export const knownFlags = new Set([
  ...CONFIG_FLAGS,
  ...Object.values(bitableV1.resources).flatMap(({ methods }) =>
    Object.values(methods).flatMap((spec) =>
      Object.keys(spec.parameters).map((name) => name.replaceAll("_", "-")),
    ),
  ),
  ...JSON.parse(
    await readFile(
      new URL("../data/known-flags.json", import.meta.url),
      "utf8",
    ),
  ),
]);
