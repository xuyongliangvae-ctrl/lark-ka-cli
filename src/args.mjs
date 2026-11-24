import { CliError } from "./errors.mjs";

const BOOLEAN_FLAGS = new Set([
  "help",
  "version",
  "dry-run",
  "page-all",
  "json",
  "recommend",
  "verify",
  "app-secret-stdin",
  "force-init",
  "new",
  "yes",
  "force",
  "ascii",
  "quiet",
  "debug",
  "verbose",
  "all",
  "print-schema",
  "with-resources",
  "reply-in-thread",
  "watch",
  "recursive",
  "overwrite",
  "reverse",
  "check",
  "local",
  "global",
  "has-chatted",
  "exclude-external-users",
  "left-organization",
  "has-enterprise-email",
  "no-wait",
  "no-color",
  "no-truncate",
  "connector",
]);

for (const name of [
  "allow-sensitive",
  "apply",
  "apply-enabled",
  "before",
  "compact",
  "complete",
  "completed",
  "confirm-send",
  "created-by-me",
  "delete-local",
  "delete-remote",
  "disable-search-by-user",
  "enrich-feed-thread",
  "exclude-external-users",
  "exclude-muted",
  "followed-by-me",
  "force",
  "from-clipboard",
  "full-comment",
  "has-chatted",
  "has-enterprise-email",
  "head",
  "hidden",
  "highlight",
  "html",
  "i-have-read-guide",
  "ignore-case",
  "include-children",
  "include-complete",
  "include-formulas",
  "include-spam-trash",
  "inspect",
  "is-at-me",
  "is-manager",
  "json",
  "labels",
  "left-organization",
  "list-only",
  "match-case",
  "match-entire-cell",
  "mine",
  "multiple",
  "need-notification",
  "no-detail",
  "no-open",
  "no-reactions",
  "no-validate",
  "notify",
  "only-comment",
  "only-title",
  "overwrite",
  "page-all",
  "plain-text",
  "print-filter-schema",
  "print-output-schema",
  "print-patch-template",
  "quick",
  "quiet",
  "regex",
  "remove",
  "remove-event",
  "reply-in-thread",
  "request-receipt",
  "require-login",
  "search-by-regex",
  "set-bot-manager",
  "set-plain-text",
  "show-lint-details",
  "stdin",
  "stop-on-error",
  "tail",
  "url-only",
  "visible",
  "without-content",
  "yes",
])
  BOOLEAN_FLAGS.add(name);
const SHORT_FLAGS = new Map([
  ["h", "help"],
  ["v", "version"],
  ["q", "jq"],
  ["o", "output"],
]);
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function flagValue(text) {
  if (text === "true") return true;
  if (text === "false") return false;
  return text;
}

function isJsonInput(value) {
  return (
    typeof value === "string" &&
    (value === "-" || value.startsWith("@") || /^[\[{]/.test(value.trimStart()))
  );
}

function numericToken(token) {
  return /^-(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token);
}

const fileVersionCommands = new Set([
  "+download",
  "+version-get",
  "+version-delete",
  "+version-revert",
  "+preview",
  "+cover",
]);
function usesFileVersion(words) {
  return words[0] === "drive" && fileVersionCommands.has(words[1]);
}

function put(flags, key, value) {
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key) || UNSAFE_KEYS.has(key)) {
    throw new CliError("validation", `Invalid flag name: --${key}`);
  }
  if (Object.hasOwn(flags, key)) {
    flags[key] = Array.isArray(flags[key])
      ? [...flags[key], value]
      : [flags[key], value];
  } else {
    Object.defineProperty(flags, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}

export function parseArgs(argv) {
  if (
    !Array.isArray(argv) ||
    argv.some((token) => typeof token !== "string" || token.includes("\0"))
  ) {
    throw new CliError(
      "validation",
      "Arguments must be strings without NUL bytes.",
    );
  }
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (typeof token !== "string" || token.includes("\0")) {
      throw new CliError(
        "validation",
        "Arguments must be strings without NUL bytes.",
      );
    }
    if (token === "--") {
      for (const value of argv.slice(i + 1)) {
        if (typeof value !== "string" || value.includes("\0"))
          throw new CliError(
            "validation",
            "Arguments must be strings without NUL bytes.",
          );
        positionals.push(value);
      }
      break;
    }
    if (!token.startsWith("-") || token === "-" || numericToken(token)) {
      positionals.push(token);
      continue;
    }
    if (token.startsWith("--")) {
      const equal = token.indexOf("=");
      const key = token.slice(2, equal === -1 ? undefined : equal);
      if (key === "version") {
        const candidate = equal === -1 ? argv[i + 1] : token.slice(equal + 1);
        if (usesFileVersion(positionals) || /^[0-9]+$/.test(candidate ?? "")) {
          if (!/^[0-9]+$/.test(candidate ?? ""))
            throw new CliError(
              "validation",
              "Drive --version requires a numeric file version from +version-history",
            );
          put(flags, key, candidate); // Keep the exact ID, including large integers.
          if (equal === -1) i++;
          continue;
        }
      }
      if (
        key === "remove" &&
        positionals[0] === "task" &&
        ["+assign", "+followers"].includes(positionals[1])
      ) {
        const ids = equal === -1 ? argv[i + 1] : token.slice(equal + 1);
        if (!ids || ids.startsWith("-"))
          throw new CliError(
            "validation",
            "Task member --remove requires member IDs",
          );
        put(flags, key, ids);
        if (equal === -1) i++;
        continue;
      }
      const isBoolean =
        BOOLEAN_FLAGS.has(key) ||
        (key === "blocks" &&
          positionals[0] === "docs" &&
          positionals[1] === "+fetch");
      if (key.startsWith("no-") && !BOOLEAN_FLAGS.has(key)) {
        if (equal !== -1)
          throw new CliError(
            "validation",
            `Negated flag --${key} does not take a value.`,
          );
        put(flags, key.slice(3), false);
        continue;
      }
      if (equal !== -1) {
        const value = token.slice(equal + 1);
        const input = key === "json" && isJsonInput(value);
        if (isBoolean && !input && value !== "true" && value !== "false") {
          throw new CliError(
            "validation",
            `Boolean flag --${key} requires true or false.`,
          );
        }
        put(flags, key, isBoolean && !input ? flagValue(value) : value);
      } else if (key === "json" && isJsonInput(argv[i + 1])) {
        put(flags, key, argv[++i]);
      } else if (isBoolean) {
        if (argv[i + 1] === "true" || argv[i + 1] === "false")
          put(flags, key, flagValue(argv[++i]));
        else put(flags, key, true);
      } else if (
        i + 1 < argv.length &&
        (!argv[i + 1].startsWith("-") || numericToken(argv[i + 1]))
      ) {
        put(flags, key, argv[++i]);
      } else {
        put(flags, key, true);
      }
      continue;
    }
    const short = token[1];
    const key = SHORT_FLAGS.get(short);
    if (!key)
      throw new CliError("validation", `Unknown short flag: -${short}`, {
        hint: "Run the command with --help to see supported flags.",
      });
    const tail = token.slice(2).replace(/^=/, "");
    if (BOOLEAN_FLAGS.has(key)) {
      if (tail) {
        if (tail === "true" || tail === "false")
          put(flags, key, flagValue(tail));
        else
          throw new CliError(
            "validation",
            `Boolean flag -${short} does not accept ${JSON.stringify(tail)}.`,
          );
      } else put(flags, key, true);
    } else if (tail) put(flags, key, tail);
    else if (
      i + 1 < argv.length &&
      (!argv[i + 1].startsWith("-") || numericToken(argv[i + 1]))
    )
      put(flags, key, argv[++i]);
    else throw new CliError("validation", `Flag -${short} requires a value.`);
  }
  if (Array.isArray(flags.version))
    throw new CliError("validation", "Specify --version only once");
  if (typeof flags.version === "string" && !usesFileVersion(positionals))
    throw new CliError(
      "validation",
      "A file --version value requires a Drive command that accepts a version",
    );
  return { positionals, flags };
}
