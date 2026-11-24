// Offline diagnostic. Execute the real entry point with synthetic inputs and
// --dry-run, read-only filesystem permissions, no credentials and no network.
import { execFile } from "node:child_process";
import { parseArgs, promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  values: { out: output },
} = parseArgs({
  options: {
    out: {
      type: "string",
      default: path.join(root, "artifacts/shortcut-route-inventory.json"),
    },
  },
});
const catalog = JSON.parse(
  await readFile(path.join(root, "data/shortcuts.json"), "utf8"),
);
const sheetDefs = JSON.parse(
  await readFile(path.join(root, "data/sheets/flag-defs.json"), "utf8"),
);
const { version } = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const run = promisify(execFile);
const fixture = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "hn-shortcut-audit-")),
);
const cfg = {
  name: "cnooc",
  brand: "custom",
  appId: "cli_fixture",
  openBaseUrl: "https://open.example.invalid",
  accountsBaseUrl: "https://accounts.example.invalid",
  webBaseUrl: "https://docs.example.invalid",
  docsBackend: "native",
  defaultAs: "user",
  strictMode: "user",
};
const networkGuard = `import net from 'node:net'; import tls from 'node:tls'; import dgram from 'node:dgram'; import {syncBuiltinESMExports} from 'node:module'; const block=()=>{throw new Error('Audit forbids network access')}; net.Socket.prototype.connect=block; net.Server.prototype.listen=block; tls.connect=block; dgram.createSocket=block; globalThis.fetch=block; globalThis.WebSocket=block; syncBuiltinESMExports();`;
const samples = {
  query: "fixture",
  title: "Title",
  name: "Text",
  summary: "Audit",
  "app-type": "HTML",
  "user-id": "ou_fixture",
  "from-user-id": "ou_fixture",
  "to-user-id": "ou_second",
  "owner-id": "ou_fixture",
  "chat-id": "oc_fixture",
  "message-id": "om_fixture",
  "message-ids": "om_fixture",
  "thread-id": "omt_fixture",
  "meeting-number": "123456789",
  "base-token": "bascnFixture",
  "table-id": "tblFixture",
  "record-id": "recFixture",
  "field-id": "fldFixture",
  "view-id": "vewFixture",
  "sheet-id": "sheet01",
  "spreadsheet-token": "shtcnFixture",
  "space-id": "123456",
  "cycle-id": "123456",
  "progress-id": "123456",
  "meeting-id": "123456",
  "event-id": "evtFixture",
  doc: "DocFixture",
  token: "DocFixture",
  "doc-type": "docx",
  "file-token": "FileFixture",
  presentation: "SlideFixture",
  "whiteboard-token": "BoardFixture",
  "local-dir": "local",
  file: "fixture.txt",
  path: "fixture.txt",
  image: "fixture.png",
  output: "result",
  source: "{}",
  parts: '[{"file_id":"fixture"}]',
  "file-extension": "txt",
  "parent-type": "explorer",
  "parent-node": "FolderFixture",
  range: "A1:B2",
  ranges: '["Data!A1:B2"]',
  "start-cell": "A1",
  values: '[["fixture"]]',
  csv: "A,B\n1,2",
  data: "{}",
  style: "{}",
  json: "{}",
  properties: "{}",
  "position-col": "1",
  dsl: '{"dimensions":[]}',
  questions: "[]",
  "record-ids": '["recFixture"]',
  scope: "docx:document",
  start: "2026-01-01T08:00:00+08:00",
  end: "2026-01-01T09:00:00+08:00",
  "end-index": "2",
  "start-index": "1",
  dimension: "ROWS",
  length: "2",
  "merge-type": "MERGE_ALL",
  url: "https://docs.example.invalid/docx/DocFixture",
  content: "fixture",
  type: "docx",
  perm: "view",
  "member-role": "member",
  "member-type": "openid",
  "target-type": "objective",
  "rsvp-status": "accept",
  output_as: "raw",
  position: "A1",
  "condition-values": '["Fixture"]',
  version: "1",
};
const overrides = {
  "sheets +chart-create": {
    properties:
      '{"position":{"row":0,"col":"A"},"size":{"width":100,"height":100}}',
  },
  "sheets +chart-update": {
    properties:
      '{"position":{"row":0,"col":"A"},"size":{"width":100,"height":100}}',
  },
  "sheets +cond-format-create": {
    properties: '{"rule_type":"duplicateValues","ranges":["A1:A2"],"style":{}}',
  },
  "sheets +cond-format-update": {
    properties: '{"rule_type":"duplicateValues","ranges":["A1:A2"],"style":{}}',
  },
  "docs +whiteboard-update": {
    "whiteboard-token": "BoardFixture",
    source: '{"nodes":[{"type":"text"}]}',
  },
  "drive +task_result": { scenario: "import", ticket: "FixtureTicket" },
  "markdown +create": { content: "Fixture", name: "Fixture.md" },
  "markdown +overwrite": { content: "Fixture" },
  "markdown +patch": { pattern: "fixture", replacement: "changed" },
  "sheets +batch-set-style": {
    data: '[{"ranges":["sheet01!A1"],"style":{"bold":true}}]',
  },
  "sheets +batch-update": {
    operations:
      '[{"shortcut":"+cells-set","input":{"sheet_id":"sheet01","range":"A1","cells":[[{"value":1}]]}}]',
  },
  "sheets +float-image-create": { "image-token": "imgFixture" },
  "sheets +float-image-update": { "image-token": "imgFixture" },
  "sheets +cells-set": { cells: '[[{"value":1}]]' },
  "sheets +cells-set-image": { range: "A1", image: "fixture.png" },
  "sheets +cells-set-style": { "font-size": 12 },
  "sheets +cells-batch-set-style": { "font-size": 12 },
  "sheets +dropdown-update": { options: '["One"]' },
  "sheets +create-filter-view-condition": { expected: '["1"]' },
  "sheets +dim-move": { "source-range": "3:5", "destination-index": 7 },
  "sheets +dropdown-set": { options: '["Fixture"]' },
  "sheets +filter-create": { properties: '{"rules":[]}' },
  "sheets +filter-update": { properties: '{"rules":[]}' },
  "sheets +range-sort": { "sort-keys": '[{"column":"A","order":"asc"}]' },
  "sheets +rows-resize": { size: 100 },
  "sheets +cols-resize": { size: 100 },
  "slides +replace-slide": {
    parts:
      '[{"action":"block_replace","block_id":"shape","replacement":"<p>Fixture</p>"}]',
  },
  "drive +search": { query: "fixture" },
  "docs +search": { query: "fixture" },
  "docs +create": {
    title: "Fixture",
    content: "Fixture",
    "doc-format": "text",
  },
  "docs +update": {
    command: "append",
    content: "Fixture",
    "doc-format": "text",
  },
  "docs +media-insert": { file: "fixture.txt", type: "file" },
  "drive +add-comment": {
    type: "docx",
    content: '[{"text_run":{"text":"hello"}}]',
  },
  "drive +inspect": { url: "https://docs.example.invalid/docx/DocFixture" },
  "base +record-batch-create": {
    json: '{"records":[{"fields":{"Title":"fixture"}}]}',
  },
  "base +record-search": {
    json: '{"field_names":["Title"],"keyword":"fixture","search_fields":["Title"]}',
  },
  "base +record-batch-update": {
    json: '{"records":[{"record_id":"recFixture","fields":{"Title":"fixture"}}]}',
  },
  "whiteboard +update": {
    "whiteboard-token": "BoardFixture",
    source: '{"nodes":[{"type":"text"}]}',
  },
};
function sample(flag) {
  if (flag.enum?.length) return flag.enum[0];
  if (flag.default !== undefined) return flag.default;
  if (Object.hasOwn(samples, flag.name)) return samples[flag.name];
  if (/^int|float/.test(flag.type)) return "1";
  if (flag.type === "bool") return "true";
  return "Fixture" + flag.name.replaceAll("-", "");
}
// V1 checks supplied flags strictly. Give each operation just its resource identifiers.
const bitableProbeIds = {
  "+base-get": [],
  "+base-create": [],
  "+base-copy": [],
  "+table-create": [],
  "+record-batch-update": ["table-id"],
  "+record-delete": ["table-id", "record-id"],
  "+dashboard-list": [],
  "+table-list": [],
  "+table-get": ["table-id"],
  "+field-list": ["table-id"],
  "+field-get": ["table-id", "field-id"],
  "+view-get": ["table-id", "view-id"],
  "+view-list": ["table-id"],
  "+form-get": ["table-id", "form-id"],
  "+record-get": ["table-id", "record-id"],
  "+record-list": ["table-id"],
  "+record-search": ["table-id"],
  "+record-batch-create": ["table-id"],
};
function argumentsFor(spec) {
  const flags = {};
  const tableDefs =
    spec.service === "sheets" ? (sheetDefs[spec.command]?.flags ?? []) : [];
  for (const def of [...spec.flags, ...tableDefs]) {
    if (
      (def.required === true || def.required === "required") &&
      def.default === undefined
    )
      flags[def.name] = sample(def);
  }
  if (spec.service === "base") {
    const ids = bitableProbeIds[spec.command] || [
      "table-id",
      "record-id",
      "field-id",
      "view-id",
      "block-id",
      "dashboard-id",
      "role-id",
      "form-id",
      "workflow-id",
    ];
    for (const key of ["base-token", ...ids])
      flags[key] = sample({ name: key });
  }
  if (spec.service === "sheets") {
    if (spec.command !== "+create" && spec.command !== "+workbook-create")
      flags["spreadsheet-token"] = samples["spreadsheet-token"];
    if ([...spec.flags, ...tableDefs].some((f) => f.name === "sheet-id"))
      flags["sheet-id"] = samples["sheet-id"];
    delete flags.url;
  }
  return Object.assign(flags, overrides[spec.service + " " + spec.command]);
}
// Deliberate alternatives where a single shortcut selects different endpoints.
const variants = {
  "base +field-get": [
    { "table-id": "FixtureTableName", "field-id": "FixtureFieldName" },
  ],
  "base +view-get": [
    { "table-id": "FixtureTableName", "view-id": "FixtureViewName" },
  ],
  "base +record-get": [
    { "table-id": "FixtureTableName", "record-id": "recFixture,recFixture2" },
  ],
  "docs +fetch": [
    { "doc-format": "markdown", detail: "with-ids" },
    { doc: "https://docs.example.invalid/wiki/WikiFixture" },
  ],
  "docs +create": [{ "doc-format": "markdown", content: "# Title\nBody" }],
  "docs +media-download": [{ type: "whiteboard" }, { type: "image" }],
  "whiteboard +query": [{ output_as: "image", output: "board.png" }],
  "whiteboard +update": [
    {
      input_format: "mermaid",
      source: "sequenceDiagram\n    Alice->>Bob: fixture",
    },
  ],
  "drive +task_result": [
    { scenario: "export", "file-token": "FileFixture" },
    { scenario: "task_check", "task-id": "123" },
    { scenario: "wiki_move", "task-id": "123" },
  ],
  "drive +upload": [{ file: "large-fixture.bin" }],
  "drive +preview": [{ "list-only": true }],
};

function routeOf(req) {
  if (typeof req !== "object" || !req) return null;
  const value = req.path ?? req.url;
  if (typeof value !== "string" || !req.method) return null;
  // Paths come from the actual preview; dynamic segments contain synthetic IDs.
  const route = { method: req.method.toUpperCase(), path: value.split("?")[0] };
  const tool = req.body?.tool_name ?? req.data?.tool_name;
  if (typeof tool === "string") route.tool = tool;
  return route;
}
async function probe(spec, flags) {
  const args = [
    "--permission",
    "--allow-fs-read=" + root,
    "--allow-fs-read=" + fixture,
    "--import",
    "data:text/javascript," + encodeURIComponent(networkGuard),
    path.join(root, "bin/lark-ka.mjs"),
    "--profile",
    "cnooc",
    spec.service,
    spec.command,
    "--as",
    "user",
    "--dry-run",
    ...Object.entries(flags).flatMap(([k, v]) => ["--" + k, String(v)]),
  ];
  try {
    const { stdout } = await run(process.execPath, args, {
      cwd: fixture,
      env: {
        HOME: fixture,
        PATH: path.dirname(process.execPath),
        LARK_KA_CONFIG_DIR: fixture,
      },
      timeout: 5000,
      maxBuffer: 300000,
    });
    if (/^lark-ka [\d.]+ \(Node\.js\)/.test(stdout))
      return {
        flags,
        status: "blocked-by-parser",
        routes: [],
        error:
          "The CLI printed the package version instead of previewing the shortcut's --version parameter",
      };
    const result = JSON.parse(stdout);
    const data = result.data ?? result;
    const routes = (data.requests ?? []).map(routeOf).filter(Boolean);
    return {
      flags,
      status: routes.length ? "dry-run-routes" : "no-http-in-preview",
      routes,
    };
  } catch (e) {
    let error;
    try {
      error = JSON.parse(e.stderr.trim().split("\n").at(-1)).error.message;
    } catch {
      error = e.killed
        ? "CLI preview timed out"
        : String(e.stderr || e.message).slice(0, 400);
    }
    const status =
      /available for Feishu SaaS|only.*(?:SaaS|bot)|requires bot identity|require --as bot/i.test(
        error,
      )
        ? "blocked-by-profile"
        : /Unknown flag:/.test(error)
          ? "blocked-by-parser"
          : "fixture-unresolved";
    return {
      flags,
      status,
      routes: [],
      error: error
        .replaceAll(fixture, "<fixture>")
        .replaceAll(root, "<package>"),
    };
  }
}
try {
  await mkdir(path.join(fixture, "local"));
  await writeFile(
    path.join(fixture, "config.json"),
    JSON.stringify({ currentApp: "cnooc", apps: [cfg] }),
  );
  for (const [file, body] of [
    ["fixture.txt", "fixture"],
    [
      "fixture.png",
      Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ", "base64"),
    ],
    ["fixture.md", "# Fixture"],
    ["fixture.html", "<p>fixture</p>"],
  ])
    await writeFile(path.join(fixture, file), body);
  await writeFile(path.join(fixture, "large-fixture.bin"), "");
  await truncate(path.join(fixture, "large-fixture.bin"), 20 * 1024 * 1024 + 1);
  const commands = new Array(catalog.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= catalog.length) break;
      const spec = catalog[index];
      const flags = argumentsFor(spec);
      const scenarios = [await probe(spec, flags)];
      for (const changes of variants[spec.service + " " + spec.command] ?? []) {
        const extra = { ...flags, ...changes };
        for (const key of Object.keys(extra))
          if (extra[key] === undefined) delete extra[key];
        scenarios.push(await probe(spec, extra));
      }
      const routes = [
        ...new Map(
          scenarios.flatMap((s) => s.routes).map((r) => [JSON.stringify(r), r]),
        ).values(),
      ];
      const status = routes.length ? "dry-run-routes" : scenarios[0].status;
      commands[index] = {
        service: spec.service,
        command: spec.command,
        source: spec.source,
        status,
        routes,
        scenarios,
      };
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const counts = {};
  for (const item of commands)
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  const report = {
    version,
    node: process.version,
    method:
      "Actual Node CLI --dry-run, cnooc native/user profile, synthetic fixtures",
    isolation:
      "Each child receives only synthetic configuration, read-only filesystem permissions, disabled child processes and blocked network connections.",
    limitations: [
      "A route preview does not establish tenant deployment, user scopes or backend behavior.",
      "Representative inputs only. Optional flags, chained steps, response-dependent calls, and event transports may require distinct tests. An empty preview is not an available API.",
      "Fixture flags and synthetic resource IDs are for tracing, not recommended production invocations. A command can have both observed routes and a failing variant; inspect each scenario.",
    ],
    counts,
    commands,
  };
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ total: commands.length, counts }));
} finally {
  await rm(fixture, { recursive: true, force: true });
}
