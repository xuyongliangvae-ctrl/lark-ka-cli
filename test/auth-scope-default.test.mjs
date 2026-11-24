import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { authLogin, authStatus } from "../src/auth.mjs";
import { endpoints } from "../src/config.mjs";
import { CliError } from "../src/errors.mjs";

const config = endpoints("cnooc", {
  accountsBaseUrl: "http://127.0.0.1",
  openBaseUrl: "http://127.0.0.1",
  appId: "cli_fixture",
});

const captureScope = async (config, flags, options = {}) => {
  const controller = new AbortController();
  let scope;
  await assert.rejects(
    authLogin(
      config,
      { "no-open": true, "callback-port": 0, ...flags },
      {
        ...options,
        signal: controller.signal,
        emit: ({ verification_url }) => {
          scope = new URL(verification_url).searchParams.get("scope");
          controller.abort();
        },
      },
    ),
    /Login cancelled/,
  );
  return scope;
};

test("login requests normalized explicit scopes before using the configured scopes", async () => {
  const configured = {
    ...config,
    scope: ["docx:document offline_access", "docx:document"],
  };
  const options = {
    getBotToken: () => assert.fail("unexpected application discovery"),
  };
  assert.equal(
    await captureScope(
      configured,
      { scope: ["docs:read, docs:write", "docs:read"] },
      options,
    ),
    "docs:read docs:write",
  );
  assert.equal(
    await captureScope(configured, {}, options),
    "docx:document offline_access",
  );
  await assert.rejects(
    authLogin(configured, { scope: " ,  " }, options),
    /at least one approved employee OAuth scope/,
  );
  await assert.rejects(
    authLogin(
      config,
      { scope: Array.from({ length: 201 }, (_, i) => `docs:scope:${i}`) },
      options,
    ),
    /at most 200 distinct scopes/,
  );
});

test("unconfigured login discovers the app's enabled user-token scopes only", async () => {
  let reads = 0;
  const scope = await captureScope(
    config,
    {},
    {
      getBotToken: async () => "app-token-fixture",
      fetchJSON: async (url, options) => {
        reads++;
        assert.equal(
          String(url),
          "http://127.0.0.1/open-apis/application/v6/applications/cli_fixture?lang=zh_cn",
        );
        assert.equal(options.headers.Authorization, "Bearer app-token-fixture");
        return {
          data: {
            app: {
              scopes: [
                { scope: "docx:document", token_types: ["tenant", "user"] },
                { scope: "docx:document", token_types: ["user"] },
                { scope: "offline_access", tokenTypes: ["user"] },
                { scope: "approved:high", token_types: ["user"], level: 3 },
                { scope: "not:enabled", token_types: ["user"], enabled: false },
                { scope: "tenant:only", token_types: ["tenant"] },
                { scope: "unclassified:scope" },
                { scope: "malformed:type", token_types: "user" },
                {
                  scope: "malformed:scope, extra:scope",
                  token_types: ["user"],
                },
              ],
            },
          },
        };
      },
    },
  );
  assert.equal(scope, "docx:document offline_access approved:high");
  assert.equal(reads, 1);
});

test("discovery failures keep upstream details and suggest the configured scope list", async () => {
  const upstream = new CliError("api", "Access denied", {
    code: 5,
    detail: { apiCode: 99991672, status: 403 },
  });
  const options = {
    getBotToken: async () => "app-token-fixture",
    fetchJSON: async () => {
      throw upstream;
    },
    emit: () => assert.fail("OAuth URL opened after discovery failed"),
  };
  await assert.rejects(authLogin(config, {}, options), (error) => {
    assert.equal(error, upstream);
    assert.deepEqual(error.detail, { apiCode: 99991672, status: 403 });
    assert.match(error.hint, /config init --scope/);
    return true;
  });
  await assert.rejects(
    authLogin(
      config,
      {},
      { ...options, fetchJSON: async () => ({ data: {} }) },
    ),
    (error) =>
      error.type === "permission" && /config init --scope/.test(error.hint),
  );
});

test("resuming an OAuth device flow skips scope discovery", async () => {
  const controller = new AbortController();
  const resumed = authLogin(
    { authFlow: "device" },
    { "device-code": "fixture-device" },
    {
      signal: controller.signal,
      getBotToken: () =>
        assert.fail("device-code resume must not access application scopes"),
    },
  );
  controller.abort();
  await assert.rejects(resumed, { name: "AbortError" });
});

test("the scope returned by the platform is authoritative even when empty", async (t) => {
  const configDir = await mkdtemp(path.join(tmpdir(), "lark-auth-scope-"));
  const previousDir = process.env.LARK_KA_CONFIG_DIR;
  const previousUserToken = process.env.LARKSUITE_CLI_USER_ACCESS_TOKEN;
  process.env.LARK_KA_CONFIG_DIR = configDir;
  delete process.env.LARKSUITE_CLI_USER_ACCESS_TOKEN;
  t.after(async () => {
    if (previousDir === undefined) delete process.env.LARK_KA_CONFIG_DIR;
    else process.env.LARK_KA_CONFIG_DIR = previousDir;
    if (previousUserToken !== undefined)
      process.env.LARKSUITE_CLI_USER_ACCESS_TOKEN = previousUserToken;
    await rm(configDir, { recursive: true, force: true });
  });
  const server = http.createServer((request, response) => {
    const payload = request.url.endsWith("/oauth/token")
      ? { access_token: "access-fixture", expires_in: 7200, scope: "" }
      : { data: { open_id: "ou_fixture" } };
    response
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(payload));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  let browser;
  const sessionConfig = {
    ...config,
    openBaseUrl: `http://127.0.0.1:${server.address().port}`,
    profileName: "fixture",
    storageKey: "fixture",
  };
  const result = await authLogin(
    sessionConfig,
    { "no-open": true, "callback-port": 0, scope: "docx:document", timeout: 4 },
    {
      emit: ({ verification_url, redirect_uri }) => {
        const callback = new URL(redirect_uri);
        callback.searchParams.set("code", "local-test-code");
        callback.searchParams.set(
          "state",
          new URL(verification_url).searchParams.get("state"),
        );
        browser = fetch(callback).then((response) => response.text());
      },
    },
  );
  await browser;
  assert.equal(result.scope, "");
  assert.equal((await authStatus(sessionConfig)).scope, "");
});
