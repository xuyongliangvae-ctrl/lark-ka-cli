import { readFile } from "node:fs/promises";
import { CliError } from "./errors.mjs";
import { findAPI } from "./metadata.mjs";

// This is the complete supported command surface, including local tools.
// Registrations and generators share the same list so removed commands cannot
// return through an alias, help, completion, or a regenerated catalog.
export const commandSurface = JSON.parse(
  await readFile(
    new URL("../data/command-surface.json", import.meta.url),
    "utf8",
  ),
);
export const documentedCommands = commandSurface.commands;
const nativeServices = new Set(["base", "drive", "sheets", "slides"]);
const nativeCommands = new Map(
  documentedCommands
    .filter((c) => nativeServices.has(c.split(" ")[0]) && !c.includes(" +"))
    .map((c) => [c.replaceAll(" ", "."), c]),
);
const argumentCommands = new Set([
  "api",
  "schema",
  "__complete",
  "__completeNoDesc",
  "skills read",
  "skills list",
  "auth qrcode",
  "profile add",
  "profile use",
  "profile rename",
  "profile remove",
  "config default-as",
  "config strict-mode",
]);
const exactCommands = new Set(documentedCommands);
const groups = new Set();
for (const command of documentedCommands) {
  for (const variant of [command, command.replaceAll(".", " ")]) {
    const words = variant.split(" ");
    for (let i = 1; i < words.length; i++)
      groups.add(words.slice(0, i).join(" "));
  }
}

export function supportedCommand(words) {
  const exact = words.join(" ");
  if (exactCommands.has(exact)) return exact;
  const native = nativeCommands.get(words.join("."));
  if (native) return native;
  const spec = findAPI(words);
  if (spec) {
    const canonical = `${spec.service} ${spec.resource} ${spec.method}`;
    if (exactCommands.has(canonical)) return canonical;
  }
  return [...argumentCommands].find((c) => exact.startsWith(c + " "));
}

export function isSupportedGroup(words) {
  return groups.has(words.join(" "));
}

export function assertSupportedCommand(words, { allowGroup = false } = {}) {
  if (!words.length && allowGroup) return;
  if (words[0] === "help")
    return assertSupportedCommand(words.slice(1), { allowGroup: true });
  if (supportedCommand(words) || (allowGroup && isSupportedGroup(words)))
    return;
  throw new CliError(
    "validation",
    `Command is not included in this CLI: ${words.join(" ")}`,
    {
      hint: "Run lark-ka --help to see the supported commands.",
    },
  );
}
