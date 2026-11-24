import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { configure, loadConfig, readStore, endpoints } from "../src/config.mjs";
import { authURL, getBotToken } from "../src/auth.mjs";

async function isolated(t) {
  const old = { ...process.env };
  const dir = await mkdtemp(path.join(os.tmpdir(), "lark-config-args-"));
  process.env.LARK_KA_CONFIG_DIR = dir;
  for (const key of [
    "LARKSUITE_CLI_APP_ID",
    "LARKSUITE_CLI_APP_SECRET",
    "LARKSUITE_CLI_BRAND",
    "LARK_KA_PROFILE",
    "LARK_KA_DEPLOYMENT",
    "LARKSUITE_CLI_TENANT_ACCESS_TOKEN",
  ])
    delete process.env[key];
  t.after(async () => {
    for (const key of Object.keys(process.env))
      if (!(key in old)) delete process.env[key];
    Object.assign(process.env, old);
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test("refresh endpoint supports independent full URL, path, and exchange endpoint fallback", () => {
  const c = endpoints("custom", {
    openBaseUrl: "https://open.customer.example",
    tokenUrl: "https://login.customer.example/exchange",
  });
  assert.equal(
    authURL(c, "refresh"),
    "https://login.customer.example/exchange",
  );
  assert.equal(
    authURL({ ...c, refreshTokenPath: "/refresh" }, "refresh"),
    "https://open.customer.example/refresh",
  );
  assert.equal(
    authURL(
      {
        ...c,
        refreshTokenPath: "/refresh",
        refreshTokenUrl: "https://login.customer.example/refresh-v2",
      },
      "refresh",
    ),
    "https://login.customer.example/refresh-v2",
  );
});

test("a named missing profile cannot send environment credentials to a default host", async (t) => {
  await isolated(t);
  const env = { ...process.env, LARKSUITE_CLI_APP_ID: "cli_fixture" };
  await assert.rejects(
    loadConfig({ profile: "private" }, env),
    /Profile private does not exist/,
  );
  const explicit = await loadConfig(
    { profile: "private" },
    {
      ...env,
      LARKSUITE_CLI_BRAND: "https://configured.example.invalid",
    },
  );
  assert.equal(explicit.openBaseUrl, "https://configured.example.invalid");
  assert.equal(explicit.profileName, "private");
});

test("config init with a private API host uses only the configured deployment", async (t) => {
  await isolated(t);
  await assert.rejects(
    configure({ name: "cnooc", "app-id": "cli_example" }, async () => ""),
    /OpenAPI base URL/,
  );
  await configure(
    {
      name: "customer-b",
      "app-id": "cli_example",
      "open-base-url": "https://api.customer-b.example.invalid",
    },
    async () => "",
  );
  const config = await loadConfig({ profile: "customer-b" });
  assert.equal(config.brand, "custom");
  assert.equal(config.openBaseUrl, "https://api.customer-b.example.invalid");
  assert.equal(config.accountsBaseUrl, undefined);
  assert.equal(config.mcpUrl, undefined);
  assert.throws(() => authURL(config, "authorize"), /not configured/);
});

test("existing cnooc profiles resolve 7.54 search routes and explicit settings survive reload", async (t) => {
  await isolated(t);
  const input = async () => "";
  await configure(
    {
      name: "cnooc",
      brand: "custom",
      "app-id": "cli_example",
      "open-base-url": "https://tenant.example.invalid",
    },
    input,
  );
  const oldProfile = await loadConfig({ profile: "cnooc" });
  assert.equal(oldProfile.documentSearchApi, "suite");
  assert.equal(oldProfile.capabilities.contactSearch, "v1");
  await configure(
    {
      name: "cnooc",
      "document-search-api": "v2",
      "contact-search-version": "v3",
    },
    input,
  );
  const overridden = await loadConfig({ profile: "cnooc" });
  assert.equal(overridden.documentSearchApi, "v2");
  assert.equal(overridden.capabilities.contactSearch, "v3");
  assert.equal(oldProfile.storageKey, overridden.storageKey);
  await assert.rejects(
    configure({ name: "cnooc", "document-search-api": "unknown" }, input),
    /documentSearchApi must be/,
  );
  assert.equal(
    (await loadConfig({ profile: "cnooc" })).documentSearchApi,
    "v2",
  );
  assert.equal(
    endpoints("cnooc", { name: "other-name" }).documentSearchApi,
    "suite",
  );
  assert.equal(endpoints("feishu", { name: "cnooc" }).documentSearchApi, "v2");
});

test("tenant token requests actually use the independently configured endpoint", async (t) => {
  await isolated(t);
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    requests.push({ url: req.url, body: JSON.parse(text) });
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        code: 0,
        tenant_access_token: "tenant-custom",
        expire: 7200,
      }),
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((r) => server.close(r));
  });
  const c = endpoints("custom", {
    openBaseUrl: "https://unused.customer.example",
    tenantTokenUrl: `http://127.0.0.1:${server.address().port}/tenant-custom`,
    appId: "cli_custom",
    appSecret: "mock-secret",
    storageKey: "tenant-custom",
  });
  assert.equal(await getBotToken(c), "tenant-custom");
  assert.deepEqual(requests, [
    {
      url: "/tenant-custom",
      body: { app_id: "cli_custom", app_secret: "mock-secret" },
    },
  ]);
});

test("explicit path parameters replace a previously stored complete URL", async (t) => {
  await isolated(t);
  await configure(
    {
      name: "a",
      brand: "custom",
      "app-id": "cli_a",
      "open-base-url": "https://open.customer.example",
      "token-url": "https://login.customer.example/old-token",
    },
    async (v) => v,
  );
  await configure({ name: "a", "token-path": "/new-token" }, async (v) => v);
  const c = await loadConfig({ profile: "a" });
  assert.equal(c.tokenUrl, undefined);
  assert.equal(authURL(c, "token"), "https://open.customer.example/new-token");
});

test("stdin credential overrides a legacy secret contained in an optional deployment file", async (t) => {
  await isolated(t);
  await configure(
    { name: "a", deployment: "@mock.json", "app-secret-stdin": true },
    async (input) =>
      input === "-"
        ? "new-secret"
        : JSON.stringify({
            brand: "custom",
            appId: "cli_a",
            openBaseUrl: "https://open.customer.example",
            appSecret: "old-secret",
            appSecretEnv: "OLD_ENV",
          }),
  );
  const c = await loadConfig({ profile: "a" });
  assert.equal(c.appSecret, "new-secret");
  const store = await readStore("config.json");
  assert.equal(store.apps[0].appSecret, undefined);
  assert.equal(store.apps[0].appSecretEnv, undefined);
});
