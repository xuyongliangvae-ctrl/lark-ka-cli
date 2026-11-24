import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
export const commandSurface = JSON.parse(
  await readFile(new URL("data/command-surface.json", root), "utf8"),
);
export const retainedCommands = new Set(commandSurface.commands);

export function pruneAPICatalog(catalog) {
  const output = structuredClone(catalog);
  output.services = output.services.flatMap((service) => {
    const resources = Object.fromEntries(
      Object.entries(service.resources || {}).flatMap(([resource, spec]) => {
        const methods = Object.fromEntries(
          Object.entries(spec.methods || {}).filter(([method]) =>
            retainedCommands.has(`${service.name} ${resource} ${method}`),
          ),
        );
        return Object.keys(methods).length
          ? [[resource, { ...spec, methods }]]
          : [];
      }),
    );
    return Object.keys(resources).length ? [{ ...service, resources }] : [];
  });
  return output;
}

export function retainedSheetDefinitions(definitions) {
  return Object.fromEntries(
    Object.entries(definitions).filter(([command]) =>
      retainedCommands.has(`sheets ${command}`),
    ),
  );
}

export function retainedShortcutCatalog(catalog, sheetDefinitions) {
  const retained = new Map(
    catalog
      .filter((spec) => retainedCommands.has(`${spec.service} ${spec.command}`))
      .map((spec) => [`${spec.service} ${spec.command}`, spec]),
  );
  // Declarative Sheets commands were previously dispatched directly from their
  // flag definitions. Include them in discovery, schema and package audits too.
  for (const [command, definition] of Object.entries(
    retainedSheetDefinitions(sheetDefinitions),
  )) {
    const id = `sheets ${command}`;
    if (retained.has(id)) continue;
    retained.set(id, {
      service: "sheets",
      command,
      description: definition.description || `Spreadsheet ${command.slice(1)}`,
      risk: definition.risk || "read",
      flags: (definition.flags || []).map((flag) => ({
        name: flag.name,
        description: flag.description || flag.desc || "",
        type: flag.type || "string",
        ...(flag.default !== undefined && { default: flag.default }),
        required: flag.required === true,
        enum: flag.enum || [],
      })),
      source: "shortcuts/sheets/data/flag-defs.json",
    });
  }
  const missing = commandSurface.commands.filter(
    (command) => command.includes(" +") && !retained.has(command),
  );
  if (missing.length)
    throw new Error(
      `Retained shortcut definitions are missing: ${missing.join(", ")}`,
    );
  return [...retained.values()].sort((a, b) =>
    `${a.service} ${a.command}`.localeCompare(`${b.service} ${b.command}`),
  );
}

export async function retainedKnownFlags(
  shortcuts,
  metadata,
  sheetDefinitions,
) {
  const known = new Set();
  const add = (name) => {
    known.add(name);
    known.add(name.replaceAll("_", "-"));
  };
  for (const spec of shortcuts)
    for (const flag of spec.flags || []) add(flag.name);
  for (const definition of Object.values(sheetDefinitions))
    for (const flag of definition.flags || []) add(flag.name);
  for (const service of metadata.services)
    for (const resource of Object.values(service.resources || {}))
      for (const spec of Object.values(resource.methods || {}))
        for (const name of Object.keys(spec.parameters || {})) add(name);

  // Core options are not shortcut parameters. Retain an existing option only
  // when it is still named by a remaining core/runtime module.
  const existing = JSON.parse(
    await readFile(new URL("data/known-flags.json", root), "utf8"),
  );
  const modules = [
    "bin/lark-ka.mjs",
    ...[
      "args",
      "auth",
      "cli",
      "config",
      "config-options",
      "context",
      "errors",
      "http",
      "io",
      "management",
      "mcp",
      "transfers",
    ].map((name) => `src/${name}.mjs`),
    ...["content", "tables"].map((name) => `src/domains/${name}.mjs`),
  ];
  const code = (
    await Promise.all(
      modules.map((file) => readFile(new URL(file, root), "utf8")),
    )
  ).join("\n");
  for (const match of code.matchAll(/\b(?:flags|f)\.([A-Za-z_][\w]*)\b/g))
    add(match[1]);
  for (const match of code.matchAll(
    /\b(?:flags|f)\[["']([A-Za-z_][\w-]*)["']\]/g,
  ))
    add(match[1]);
  for (const name of existing)
    if (
      code.includes(`"${name}"`) ||
      code.includes(`'${name}'`) ||
      new RegExp(`\\b(?:flags|f)\\.${name.replaceAll("-", "\\-")}\\b`).test(
        code,
      )
    )
      add(name);
  return [...known].sort();
}
