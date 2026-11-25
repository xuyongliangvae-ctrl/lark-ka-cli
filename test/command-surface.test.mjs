import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access, mkdtemp, rm, symlink } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  documentedCommands,
  assertSupportedCommand,
} from "../src/command-surface.mjs";
import { execute, help } from "../src/cli.mjs";
import { apiSpecs, findAPI, shortcuts, knownFlags } from "../src/metadata.mjs";
import { completionCandidates } from "../src/management.mjs";
import { mcpTools } from "../src/mcp.mjs";
import {
  pruneAPICatalog,
  retainedShortcutCatalog,
} from "../scripts/catalog-surface.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);
const readJSON = async (file) =>
  JSON.parse(await readFile(new URL(file, import.meta.url), "utf8"));
const removed = await readJSON("./fixtures/removed-commands.json");
const canonicalAPI = (spec) =>
  `${spec.service} ${spec.resource} ${spec.method}`;

test("the document command list exactly matches all published business commands", () => {
  assert.equal(documentedCommands.length, 304);
  assert.equal(new Set(documentedCommands).size, 304);
  assert.equal(shortcuts.length, 177);
  assert.equal(apiSpecs().length, 90);
  for (const spec of shortcuts)
    for (const flag of spec.flags)
      assert.ok(
        knownFlags.has(flag.name),
        `${spec.service} ${spec.command} --${flag.name}`,
      );
  const business = new Set([
    ...shortcuts.map((s) => `${s.service} ${s.command}`),
    ...apiSpecs().map(canonicalAPI),
  ]);
  const domains = new Set([
    "docs",
    "drive",
    "markdown",
    "base",
    "sheets",
    "slides",
    "whiteboard",
  ]);
  assert.deepEqual(
    [...business].sort(),
    documentedCommands.filter((c) => domains.has(c.split(" ")[0])).sort(),
  );
  for (const command of documentedCommands) {
    assert.doesNotThrow(
      () => assertSupportedCommand(command.split(" ")),
      command,
    );
    assert.doesNotThrow(() => help(command.split(" ")), command);
  }
  assert.doesNotThrow(() =>
    assertSupportedCommand([
      "auth",
      "qrcode",
      "https://accounts.example.invalid/authorize",
    ]),
  );
  for (const spec of apiSpecs()) {
    for (const words of [
      canonicalAPI(spec).split(" "),
      [spec.id],
      `${spec.service} ${spec.resource.replaceAll(".", " ")} ${spec.method}`.split(
        " ",
      ),
    ]) {
      assert.equal(findAPI(words)?.id, spec.id);
      assert.doesNotThrow(() => assertSupportedCommand(words));
    }
  }
});

test("all removed commands and native aliases are rejected before configuration or authentication", async () => {
  const options = {
    get config() {
      throw new Error("Removed commands must not load configuration");
    },
  };
  for (const command of removed) {
    const variants = [command.split(" ")];
    if (!command.includes(" +") && command.split(" ").length >= 3) {
      variants.push(
        [command.replaceAll(" ", ".")],
        command.replaceAll(".", " ").split(" "),
      );
    }
    for (const words of variants) {
      await assert.rejects(
        execute(words, {}, options),
        (e) => e.type === "validation" && /not included/.test(e.message),
        words.join(" "),
      );
      assert.throws(() => help(words), /not included/, words.join(" "));
      assert.equal(findAPI(words), undefined, words.join(" "));
      assert.deepEqual(
        completionCandidates([...words, "--"]),
        [],
        words.join(" "),
      );
    }
  }
});

test("schema and completion cannot restore removed commands", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hn-surface-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = {
    config: { brand: "custom" },
    env: { LARK_KA_CONFIG_DIR: dir },
  };
  for (const command of removed) {
    await assert.rejects(
      execute(["schema", command.replaceAll(" ", ".")], {}, options),
      /Unknown schema/,
    );
  }
  const top = completionCandidates([""]);
  for (const service of [
    "im",
    "contact",
    "calendar",
    "task",
    "event",
    "apps",
    "mail",
    "okr",
    "minutes",
    "vc",
    "approval",
    "wiki",
    "attendance",
    "skill",
  ]) {
    assert.ok(!top.includes(service), service);
  }
  assert.deepEqual(
    mcpTools()
      .map((t) => t.name)
      .sort(),
    [
      "lark_docs_create",
      "lark_docs_fetch",
      "lark_docs_search",
      "lark_docs_update",
    ],
  );
});

test("the real CLI rejects removed commands including help paths in an empty profile", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hn-surface-cli-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const env = {
    ...process.env,
    LARK_KA_CONFIG_DIR: dir,
    LARKSUITE_CLI_CONFIG_DIR: dir,
  };
  for (const key of Object.keys(env))
    if (/^(?:LARK_KA_|LARKSUITE_CLI_)/.test(key) && !key.endsWith("CONFIG_DIR"))
      delete env[key];
  for (const args of [
    ["im", "+messages-send"],
    ["calendar", "--help"],
    ["help", "event"],
    ["base", "+data-query", "--help"],
    ["skill", "list"],
  ]) {
    await assert.rejects(
      run(process.execPath, ["bin/lark-ka.mjs", ...args], { cwd: root, env }),
      (e) => {
        assert.equal(e.stdout, "");
        const error = JSON.parse(e.stderr).error;
        assert.equal(error.type, "validation");
        assert.match(error.message, /not included/);
        return true;
      },
    );
  }
});

test("catalog regeneration cannot restore removed API and shortcut definitions", async () => {
  const oldAPI = {
    services: [
      {
        name: "im",
        resources: {
          messages: { methods: { create: { id: "im.messages.create" } } },
        },
      },
      {
        name: "drive",
        resources: {
          files: {
            methods: {
              list: { id: "drive.files.list" },
              delete: { id: "drive.files.delete" },
            },
          },
        },
      },
    ],
  };
  const filtered = pruneAPICatalog(oldAPI);
  assert.deepEqual(
    filtered.services.map((s) => s.name),
    ["drive"],
  );
  assert.deepEqual(Object.keys(filtered.services[0].resources.files.methods), [
    "list",
  ]);
  const definitions = await readJSON("../data/sheets/flag-defs.json");
  const result = retainedShortcutCatalog(
    [
      ...shortcuts,
      { service: "im", command: "+messages-send" },
      { service: "base", command: "+data-query" },
    ],
    definitions,
  );
  assert.deepEqual(
    result.map((s) => `${s.service} ${s.command}`).sort(),
    shortcuts.map((s) => `${s.service} ${s.command}`).sort(),
  );
});

test("the npm archive physically excludes removed implementations, data and skills", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hn-surface-pack-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await run(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", dir],
    { cwd: root, maxBuffer: 4 * 1024 * 1024 },
  );
  const info = JSON.parse(result.stdout)[0];
  const files = info.files.map((f) => f.path);
  for (const file of [
    "src/events.mjs",
    "src/domains/im.mjs",
    "src/domains/collaboration.mjs",
    "src/domains/apps.mjs",
    "src/domains/base-v3.mjs",
    "data/events.json",
    "data/base-v3-shortcuts.json",
  ]) {
    assert.ok(!files.includes(file), file);
    await assert.rejects(access(path.join(root, file)), { code: "ENOENT" });
  }
  for (const file of files)
    assert.ok(
      !/^skills\/lark-(?:im|apps|approval|attendance|calendar|contact|event|mail|minutes|okr|task|vc|wiki|workflow|openapi-explorer|skill-maker)(?:[-/])/.test(
        file,
      ),
      file,
    );
  await run("tar", ["-xzf", path.join(dir, info.filename), "-C", dir]);
  const manifest = JSON.parse(
    await readFile(path.join(dir, "package/data/command-surface.json"), "utf8"),
  );
  assert.deepEqual(manifest.commands, documentedCommands);
  await symlink(
    path.join(root, "node_modules"),
    path.join(dir, "package/node_modules"),
    "dir",
  );
  const child = await run(
    process.execPath,
    [path.join(dir, "package/bin/lark-ka.mjs"), "--help"],
    {
      cwd: root,
      env: { ...process.env, NODE_PATH: path.join(root, "node_modules") },
    },
  );
  assert.match(
    child.stdout,
    /177 shortcut definitions; 90 metadata API methods/,
  );
});
