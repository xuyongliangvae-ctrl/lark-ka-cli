import readline from "node:readline";
import { shortcuts } from "./metadata.mjs";
import { CliError, toErrorEnvelope } from "./errors.mjs";
import { VERSION } from "./version.mjs";
export const STREAM_DONE = Symbol.for("lark-ka.stream-done");
const curated = {
  lark_docs_search: ["docs", "+search"],
  lark_docs_fetch: ["docs", "+fetch"],
  lark_docs_create: ["docs", "+create"],
  lark_docs_update: ["docs", "+update"],
};
export function mcpTools() {
  return Object.entries(curated).map(([name, words]) => {
    const spec = shortcuts.find(
      (s) => s.service === words[0] && s.command === words[1],
    );
    const properties = Object.fromEntries(
      (spec?.flags || []).map((f) => [
        f.name,
        {
          type:
            f.type === "bool"
              ? "boolean"
              : f.type === "int"
                ? "integer"
                : "string",
          description: f.description,
          ...(f.enum?.length ? { enum: f.enum } : {}),
        },
      ]),
    );
    return {
      name,
      description: spec?.description || name,
      inputSchema: {
        type: "object",
        properties: {
          as: { type: "string", enum: ["user", "bot"] },
          args: { type: "object", properties, additionalProperties: false },
        },
        required: ["args"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: spec?.risk === "read" },
    };
  });
}
export async function serveMCP(execute, { profile, signal } = {}) {
  const lines = readline.createInterface({ input: process.stdin });
  const calls = new Map();
  const pending = new Set();
  const send = (response) =>
    process.stdout.write(JSON.stringify(response) + "\n");
  const processFrame = async (line) => {
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Invalid JSON" },
      });
      return;
    }
    const reply = (result) => send({ jsonrpc: "2.0", id: req.id, result });
    const error = (code, message) =>
      send({ jsonrpc: "2.0", id: req.id, error: { code, message } });
    if (req.method === "notifications/cancelled") {
      calls.get(req.params?.requestId)?.abort();
      return;
    }
    if (req.id === undefined) return;
    if (req.method === "initialize") {
      const requested = req.params?.protocolVersion;
      reply({
        protocolVersion: [
          "2024-11-05",
          "2025-03-26",
          "2025-06-18",
          "2025-11-25",
        ].includes(requested)
          ? requested
          : "2024-11-05",
        serverInfo: { name: "lark-ka-cli-node", version: VERSION },
        capabilities: { tools: {} },
      });
      return;
    }
    if (req.method === "ping") {
      reply({});
      return;
    }
    if (req.method === "tools/list") {
      reply({ tools: mcpTools() });
      return;
    }
    if (req.method !== "tools/call") {
      error(-32601, "Method not found");
      return;
    }
    const words = Object.hasOwn(curated, req.params?.name)
      ? curated[req.params.name]
      : undefined;
    if (!words) {
      error(-32602, "Unknown tool");
      return;
    }
    const controller = new AbortController();
    calls.set(req.id, controller);
    try {
      const tool = mcpTools().find((t) => t.name === req.params.name),
        input = req.params.arguments || {},
        args = input.args || {};
      for (const key of Object.keys(args))
        if (!Object.hasOwn(tool.inputSchema.properties.args.properties, key))
          throw new CliError("validation", `Unknown argument ${key}`);
      const flags = {
        ...args,
        ...(profile ? { profile } : {}),
        ...(input.as ? { as: input.as } : {}),
      };
      const data = await execute(words, flags, { signal: controller.signal });
      reply({ content: [{ type: "text", text: JSON.stringify(data) }] });
    } catch (e) {
      reply({
        isError: true,
        content: [{ type: "text", text: JSON.stringify(toErrorEnvelope(e)) }],
      });
    } finally {
      calls.delete(req.id);
    }
  };
  const stop = () => {
    for (const c of calls.values()) c.abort();
    lines.close();
  };
  signal?.addEventListener("abort", stop, { once: true });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const task = processFrame(line);
    pending.add(task);
    task.finally(() => pending.delete(task));
  }
  await Promise.allSettled(pending);
  signal?.removeEventListener("abort", stop);
  return STREAM_DONE;
}
