import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { authLogin, authURL, getUserToken } from "../src/auth.mjs";
import { endpoints } from "../src/config.mjs";

async function localServer(t, handle) {
  const server = http.createServer(handle);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test("HaiNeng employee signs in through Accounts and exchanges and renews a UTF-8 JSON grant on OpenAPI", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hn-oauth-"));
  const previousDir = process.env.LARK_KA_CONFIG_DIR;
  const previousToken = process.env.LARKSUITE_CLI_USER_ACCESS_TOKEN;
  process.env.LARK_KA_CONFIG_DIR = dir;
  delete process.env.LARKSUITE_CLI_USER_ACCESS_TOKEN;
  t.after(async () => {
    if (previousDir === undefined) delete process.env.LARK_KA_CONFIG_DIR;
    else process.env.LARK_KA_CONFIG_DIR = previousDir;
    if (previousToken !== undefined)
      process.env.LARKSUITE_CLI_USER_ACCESS_TOKEN = previousToken;
    await rm(dir, { recursive: true, force: true });
  });

  let authorize, callback;
  const accounts = await localServer(t, (req, res) => {
    authorize = { method: req.method, url: new URL(req.url, accounts) };
    callback = new URL(authorize.url.searchParams.get("redirect_uri"));
    const redirect = new URL(callback);
    redirect.searchParams.set("code", "test-code");
    redirect.searchParams.set("state", authorize.url.searchParams.get("state"));
    res.writeHead(302, { Location: redirect.href }).end();
  });
  const requests = [];
  const open = await localServer(t, async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      method: req.method,
      path: req.url,
      headers: req.headers,
      body,
    });
    const responses = [
      {
        access_token: "access-one",
        refresh_token: "refresh-one",
        expires_in: 1,
      },
      { code: 0, data: { open_id: "ou_employee" } },
      {
        access_token: "access-two",
        refresh_token: "refresh-two",
        expires_in: 7200,
      },
    ];
    res
      .writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify(responses[requests.length - 1]));
  });
  const config = endpoints("cnooc", {
    accountsBaseUrl: accounts,
    openBaseUrl: open,
    appId: "cli_fixture",
    appSecret: "fixture-secret",
    scope: "offline_access docs:read",
    storageKey: "fixture",
  });
  const controller = new AbortController();
  let simulateBrowser;
  const result = await authLogin(
    config,
    { "no-open": true, "callback-port": 0, timeout: 4 },
    {
      signal: controller.signal,
      emit: ({ verification_url }) => {
        simulateBrowser = fetch(verification_url).then(async (res) => {
          await res.text();
          return res.status;
        });
        simulateBrowser.catch(() => controller.abort());
      },
    },
  );
  assert.equal(await simulateBrowser, 200);
  assert.equal(result.user.open_id, "ou_employee");
  assert.equal(authorize.method, "GET");
  assert.equal(authorize.url.pathname, "/open-apis/authen/v1/authorize");
  assert.equal(authorize.url.searchParams.get("client_id"), "cli_fixture");
  assert.equal(authorize.url.searchParams.has("app_id"), false);
  assert.equal(authorize.url.searchParams.get("response_type"), "code");
  assert.equal(authorize.url.searchParams.get("scope"), config.scope);
  assert.ok(authorize.url.searchParams.get("state"));
  assert.equal(callback.hostname, "127.0.0.1");
  assert.equal(await getUserToken(config), "access-two");
  assert.deepEqual(
    requests.map(({ method, path }) => [method, path]),
    [
      ["POST", "/open-apis/authen/v2/oauth/token"],
      ["GET", "/open-apis/authen/v1/user_info"],
      ["POST", "/open-apis/authen/v2/oauth/token"],
    ],
  );
  for (const index of [0, 2])
    assert.equal(
      requests[index].headers["content-type"],
      "application/json; charset=utf-8",
    );
  assert.deepEqual(JSON.parse(requests[0].body), {
    grant_type: "authorization_code",
    code: "test-code",
    redirect_uri: callback.href,
    client_id: "cli_fixture",
    client_secret: "fixture-secret",
  });
  assert.equal(requests[1].headers.authorization, "Bearer access-one");
  assert.deepEqual(JSON.parse(requests[2].body), {
    grant_type: "refresh_token",
    refresh_token: "refresh-one",
    client_id: "cli_fixture",
    client_secret: "fixture-secret",
  });
});

test("explicit OAuth endpoints and encoding override HaiNeng defaults and other private deployments keep form grants", () => {
  const custom = endpoints("custom", {
    name: "cnooc",
    tokenEncoding: "form",
    clientIdParam: "app_id",
    accountsBaseUrl: "https://accounts.example.invalid",
    openBaseUrl: "https://open.example.invalid",
    authorizePath: "/login",
    tokenUrl: "https://tokens.example.invalid/exchange",
    refreshTokenPath: "/renew",
  });
  assert.equal(custom.tokenEncoding, "form");
  assert.equal(custom.clientIdParam, "app_id");
  assert.equal(
    authURL(custom, "authorize"),
    "https://accounts.example.invalid/login",
  );
  assert.equal(
    authURL(custom, "token"),
    "https://tokens.example.invalid/exchange",
  );
  assert.equal(
    authURL(custom, "refresh"),
    "https://open.example.invalid/renew",
  );
  assert.equal(endpoints("custom", { name: "cnooc" }).tokenEncoding, "json");
  assert.equal(endpoints("custom", { name: "another" }).tokenEncoding, "form");
  assert.equal(endpoints("feishu", { name: "cnooc" }).tokenEncoding, "form");
  assert.equal(endpoints("gjgw").tokenEncoding, "form");
  assert.throws(
    () => endpoints("custom", { tokenEncoding: "csv" }),
    /tokenEncoding/,
  );
});
