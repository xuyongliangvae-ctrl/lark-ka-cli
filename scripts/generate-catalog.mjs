import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  retainedCommands,
  retainedShortcutCatalog,
  retainedSheetDefinitions,
  retainedKnownFlags,
} from "./catalog-surface.mjs";
const source = path.resolve(process.argv[2] || "../lark_-ka_-cli-main");
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((x) =>
      x.isDirectory() ? walk(path.join(dir, x.name)) : [path.join(dir, x.name)],
    ),
  );
  return nested.flat();
}
function blockAt(text, start) {
  let depth = 0,
    quote = "",
    comment = "";
  for (let i = start; i < text.length; i++) {
    const c = text[i],
      n = text[i + 1];
    if (comment === "line") {
      if (c === "\n") comment = "";
      continue;
    }
    if (comment === "block") {
      if (c === "*" && n === "/") {
        comment = "";
        i++;
      }
      continue;
    }
    if (quote) {
      if (quote !== "`" && c === "\\") {
        i++;
        continue;
      }
      if (c === quote) quote = "";
      continue;
    }
    if (c === "/" && n === "/") {
      comment = "line";
      i++;
      continue;
    }
    if (c === "/" && n === "*") {
      comment = "block";
      i++;
      continue;
    }
    if (c === '"' || c === "`" || c === "'") {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return "";
}
function value(text, key) {
  const m = text.match(
    new RegExp("\\b" + key + ':\\s*("(?:[^"\\\\]|\\\\.)*"|`[^`]*`)'),
  );
  if (!m) return undefined;
  try {
    return m[1][0] === "`" ? m[1].slice(1, -1) : JSON.parse(m[1]);
  } catch {
    return undefined;
  }
}
const catalog = [];
for (const file of await walk(path.join(source, "shortcuts"))) {
  if (!file.endsWith(".go") || file.endsWith("_test.go")) continue;
  const text = await readFile(file, "utf8");
  const matches = text.matchAll(/common\.Shortcut\s*\{/g);
  for (const m of matches) {
    const block = blockAt(text, text.indexOf("{", m.index));
    const service =
        value(block, "Service") ||
        (/Service:\s*appsService/.test(block) ? "apps" : undefined),
      command = value(block, "Command");
    if (!service || !command || !retainedCommands.has(`${service} ${command}`))
      continue;
    const flags = [];
    for (const fm of block.matchAll(/\{\s*Name\s*:/g)) {
      const f = blockAt(block, fm.index);
      const name = value(f, "Name");
      if (name)
        flags.push({
          name,
          description: value(f, "Desc") || "",
          type: value(f, "Type") || "string",
          default: value(f, "Default"),
          required: /Required:\s*true/.test(f),
          enum: [
            ...(f.match(/Enum:\s*\[\]string\{([^}]+)\}/)?.[1] || "").matchAll(
              /"([^"]+)"/g,
            ),
          ].map((x) => x[1]),
        });
    }
    catalog.push({
      service,
      command,
      description: value(block, "Description") || "",
      risk: value(block, "Risk") || "read",
      flags,
      source: path.relative(source, file),
    });
  }
}
const unique = [
  ...new Map(catalog.map((x) => [`${x.service} ${x.command}`, x])).values(),
].sort((a, b) =>
  `${a.service} ${a.command}`.localeCompare(`${b.service} ${b.command}`),
);
await mkdir("data/sheets", { recursive: true });
const sheetDefinitions = retainedSheetDefinitions(
  JSON.parse(
    await readFile(
      path.join(source, "shortcuts/sheets/data/flag-defs.json"),
      "utf8",
    ),
  ),
);
const published = retainedShortcutCatalog(unique, sheetDefinitions);
await writeFile(
  "data/shortcuts.json",
  JSON.stringify(published, null, 2) + "\n",
);
await writeFile(
  "data/sheets/flag-defs.json",
  JSON.stringify(sheetDefinitions, null, 2) + "\n",
);
const sheetSchemas = JSON.parse(
  await readFile(
    path.join(source, "shortcuts/sheets/data/flag-schemas.json"),
    "utf8",
  ),
);
sheetSchemas.flags = retainedSheetDefinitions(sheetSchemas.flags);
await writeFile(
  "data/sheets/flag-schemas.json",
  JSON.stringify(sheetSchemas, null, 2) + "\n",
);
// Skills are curated with the retained command surface. Regenerating metadata
// must not overwrite them with instructions for removed upstream commands.
console.error(
  `Saved ${published.length} retained shortcut definitions and sheet schemas.`,
);

const metadata = JSON.parse(await readFile("data/api-metadata.json", "utf8"));
const base = JSON.parse(await readFile("data/base-v1.json", "utf8"));
metadata.services.push(base);
const known = await retainedKnownFlags(published, metadata, sheetDefinitions);
await writeFile("data/known-flags.json", JSON.stringify(known, null, 2) + "\n");
