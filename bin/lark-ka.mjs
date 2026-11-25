#!/usr/bin/env node
import { parseArgs } from "../src/args.mjs";
import { formatOutput } from "../src/io.mjs";
import { knownFlags } from "../src/metadata.mjs";
import { CliError, toErrorEnvelope } from "../src/errors.mjs";
import { execute, help, VERSION, isCommandGroup } from "../src/cli.mjs";
import { discoveryProfile } from "../src/management.mjs";
import { STREAM_DONE } from "../src/mcp.mjs";
if (Number(process.versions.node.split(".")[0]) < 22) {
  process.stderr.write(
    '{"ok":false,"error":{"type":"runtime","message":"Node.js >=22 is required"}}\n',
  );
  process.exit(1);
}
process.stdout.on("error", (error) => {
  if (error.code === "EPIPE") process.exit(0);
  else throw error;
});
try {
  const rawArgs = process.argv.slice(2);
  if (["__complete", "__completeNoDesc"].includes(rawArgs[0])) {
    const result = await execute(rawArgs, {});
    process.stdout.write(result.__raw || "");
    process.exit(0);
  }
  const { positionals, flags } = parseArgs(rawArgs);
  const showVersion = flags.version === true;
  if (
    process.env.LARKSUITE_CLI_AUTH_PROXY &&
    !flags.help &&
    !showVersion &&
    !flags["dry-run"]
  )
    throw new CliError(
      "configuration",
      "This Node.js version does not implement the Go auth-sidecar protocol",
      {
        hint: "Use a separately configured Node credential backend; do not fall back to direct credentials in a sandbox requiring isolation.",
      },
    );
  for (const key of Object.keys(flags))
    if (!knownFlags.has(key))
      throw new CliError("validation", `Unknown flag: --${key}`, {
        hint: "Use --help to check the command flags.",
      });
  const expectedVersion = flags["expect-version"];
  if (expectedVersion !== undefined) {
    if (
      !showVersion ||
      typeof expectedVersion !== "string" ||
      !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(
        expectedVersion,
      )
    )
      throw new CliError(
        "validation",
        "Use --version --expect-version <exact version>",
      );
    if (expectedVersion !== VERSION)
      throw new CliError(
        "version_mismatch",
        "The installed CLI does not match the requested version",
        {
          detail: { installed: VERSION, expected: expectedVersion },
          hint: "Install the version configured by the connector.",
        },
      );
  }
  if (showVersion) {
    process.stdout.write(`lark-ka ${VERSION} (Node.js)\n`);
  } else if (
    flags.help ||
    !positionals.length ||
    positionals[0] === "help" ||
    isCommandGroup(positionals)
  ) {
    process.stdout.write(
      help(
        positionals[0] === "help" ? positionals.slice(1) : positionals,
        await discoveryProfile(flags),
      ),
    );
  } else {
    const data = await execute(positionals, flags);
    if (data?.__raw !== undefined) process.stdout.write(data.__raw);
    else if (data !== STREAM_DONE)
      process.stdout.write(
        formatOutput(data, {
          format: flags["dry-run"] ? "json" : flags.format || "json",
          jq: flags.jq,
        }),
      );
  }
} catch (error) {
  process.stderr.write(JSON.stringify(toErrorEnvelope(error)) + "\n");
  process.exitCode =
    error.exitCode ||
    (error.code && typeof error.code === "number" && error.code) ||
    1;
}
