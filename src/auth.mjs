import http from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { CliError } from "./errors.mjs";
import { fetchJSON } from "./http.mjs";
import { readStore, writeStore, withLock, validURL } from "./config.mjs";
const expiry = (seconds, fallback = 7200) => {
  const value = Number(seconds ?? fallback);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER / 1000
  )
    throw new CliError("auth", "Token response contains an invalid expiry", {
      code: 3,
    });
  return Date.now() + value * 1000;
};
const unbox = (response) => response.data || response;
const secretString = (value, field) => {
  if (typeof value !== "string" || !value || /\s|[\u0000-\u001f]/.test(value))
    throw new CliError("auth", `Token response is missing a valid ${field}`, {
      code: 3,
    });
  return value;
};
const revision = (session) =>
  session?.generation ??
  JSON.stringify([
    session?.accessToken,
    session?.refreshToken,
    session?.expiresAt,
  ]);
export const sessionArchiveKey = (storageKey, openId) =>
  `${storageKey}:user:${encodeURIComponent(openId)}`;
export const isProfileSessionKey = (key, storageKey) =>
  key === storageKey || key.startsWith(`${storageKey}:user:`);
export function profileSessions(store, storageKey) {
  const users = new Map();
  // The current alias wins over a stale archive of the same employee.
  const candidates = [
    [storageKey, store[storageKey]],
    ...Object.entries(store).filter(
      ([key]) => key !== storageKey && isProfileSessionKey(key, storageKey),
    ),
  ];
  for (const [, session] of candidates) {
    const openId = session?.user?.open_id;
    if (typeof openId !== "string" || !openId || users.has(openId)) continue;
    if (session.profileStorageKey && session.profileStorageKey !== storageKey)
      continue;
    users.set(openId, session);
  }
  return [...users.values()];
}
async function tokenStore(name) {
  const store = await readStore(name, {});
  if (!store || typeof store !== "object" || Array.isArray(store))
    throw new CliError("config", `${name} must contain a JSON object`);
  return store;
}
export function authURL(c, type) {
  const pairs = {
    token: ["tokenUrl", "openBaseUrl", "tokenPath"],
    refresh: ["refreshTokenUrl", "openBaseUrl", "refreshTokenPath"],
    tenant: ["tenantTokenUrl", "openBaseUrl", "tenantTokenPath"],
    userInfo: ["userInfoUrl", "openBaseUrl", "userInfoPath"],
    authorize: ["authorizeUrl", "accountsBaseUrl", "authorizePath"],
    device: ["deviceUrl", "accountsBaseUrl", "devicePath"],
  };
  if (type === "refresh" && !c.refreshTokenUrl && !c.refreshTokenPath)
    return authURL(c, "token");
  if (type === "tenant" && !c.tenantTokenPath && !c.tenantTokenUrl)
    return authURL(
      {
        ...c,
        tenantTokenPath: "/open-apis/auth/v3/tenant_access_token/internal",
      },
      "tenant",
    );
  if (!pairs[type])
    throw new CliError("config", `Unknown authorization endpoint ${type}`);
  const [explicit, base, suffix] = pairs[type];
  if (c[explicit]) return validURL(c[explicit], explicit);
  if (!c[base] || !c[suffix])
    throw new CliError("config", `${type} endpoint is not configured`);
  const route = c[suffix];
  let decoded;
  try {
    decoded = decodeURIComponent(route);
  } catch {
    throw new CliError("config", `${suffix} contains invalid percent encoding`);
  }
  if (
    typeof route !== "string" ||
    !route.startsWith("/") ||
    route.startsWith("//") ||
    /[\\\u0000-\u0020#]/.test(decoded) ||
    /(?:^|\/)\.\.?(?:\/|$)/.test(decoded)
  )
    throw new CliError(
      "config",
      `${suffix} must be a safe absolute endpoint path`,
    );
  return new URL(route, validURL(c[base], base)).href;
}
export function tokenRequest(c, grant, signal) {
  const fields = { ...grant, client_id: c.appId };
  if (c.appSecret) fields.client_secret = c.appSecret;
  return {
    method: "POST",
    signal,
    ...(c.tokenEncoding === "json"
      ? {
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: fields,
        }
      : { body: new URLSearchParams(fields) }),
  };
}
export async function saveSession(c, token, user, { expectedSession } = {}) {
  secretString(token?.access_token, "access_token");
  if (token.refresh_token !== undefined && token.refresh_token !== "")
    secretString(token.refresh_token, "refresh_token");
  const expiresAt = expiry(token.expires_in);
  const refreshSeconds =
    token.refresh_token_expires_in ?? token.refresh_expires_in;
  const refreshExpiresAt =
    refreshSeconds === undefined ? undefined : expiry(refreshSeconds);
  return withLock("sessions-write", async () => {
    const tokens = await tokenStore("sessions.json");
    const old = tokens[c.storageKey] || {};
    if (expectedSession && revision(old) !== revision(expectedSession)) {
      if (old.accessToken && old.expiresAt > Date.now() + 1000) return old;
      throw new CliError(
        "auth",
        "User session changed or was logged out while the token was refreshing",
        { code: 3 },
      );
    }
    const keepOld = !!expectedSession || !user;
    // Preserve legacy current-only sessions when another employee logs in.
    // This happens after CAS validation, so a stale refresh can never recreate
    // either the current alias or an archived employee following logout.
    if (
      typeof old.user?.open_id === "string" &&
      old.user.open_id &&
      old.accessToken
    ) {
      tokens[sessionArchiveKey(c.storageKey, old.user.open_id)] = {
        ...old,
        profileStorageKey: c.storageKey,
        appId: c.appId,
      };
    }
    tokens[c.storageKey] = {
      generation: randomUUID(),
      accessToken: token.access_token,
      refreshToken:
        token.refresh_token || (keepOld ? old.refreshToken : undefined),
      expiresAt,
      refreshExpiresAt:
        refreshExpiresAt ?? (keepOld ? old.refreshExpiresAt : undefined),
      scope: token.scope ?? (keepOld ? old.scope : "") ?? "",
      user: user || old.user,
      profileStorageKey: c.storageKey,
      appId: c.appId,
    };
    if (
      typeof tokens[c.storageKey].user?.open_id === "string" &&
      tokens[c.storageKey].user.open_id
    )
      tokens[
        sessionArchiveKey(c.storageKey, tokens[c.storageKey].user.open_id)
      ] = tokens[c.storageKey];
    await writeStore("sessions.json", tokens);
    return tokens[c.storageKey];
  });
}
export async function getUserToken(c, { signal } = {}) {
  if (process.env.LARKSUITE_CLI_USER_ACCESS_TOKEN)
    return process.env.LARKSUITE_CLI_USER_ACCESS_TOKEN;
  let session = (await tokenStore("sessions.json"))[c.storageKey];
  if (!session?.accessToken)
    throw new CliError("auth", "User is not logged in", {
      code: 3,
      hint: 'Run lark-ka auth login --scope "approved scopes".',
    });
  if (session.expiresAt > Date.now() + 60000) return session.accessToken;
  return withLock("refresh:" + c.storageKey, async () => {
    session = (await tokenStore("sessions.json"))[c.storageKey];
    if (session?.expiresAt > Date.now() + 60000) return session.accessToken;
    if (
      !session?.refreshToken ||
      (session.refreshExpiresAt && session.refreshExpiresAt <= Date.now())
    )
      throw new CliError("auth", "User authorization has expired", {
        code: 3,
        hint: "Run lark-ka auth login again.",
      });
    const refreshed = unbox(
      await fetchJSON(
        authURL(c, "refresh"),
        tokenRequest(
          c,
          {
            grant_type: "refresh_token",
            refresh_token: session.refreshToken,
          },
          signal,
        ),
      ),
    );
    return (
      await saveSession(c, refreshed, undefined, { expectedSession: session })
    ).accessToken;
  });
}
export async function getBotToken(c, { signal } = {}) {
  if (process.env.LARKSUITE_CLI_TENANT_ACCESS_TOKEN)
    return process.env.LARKSUITE_CLI_TENANT_ACCESS_TOKEN;
  if (!c.appSecret)
    throw new CliError(
      "auth",
      "Bot identity requires an App Secret or tenant token",
      { code: 3 },
    );
  return withLock("tenant:" + c.storageKey, async () => {
    const old = (await tokenStore("tenant-tokens.json"))[c.storageKey];
    if (old?.expiresAt > Date.now() + 60000 && old.token) return old.token;
    const response = unbox(
      await fetchJSON(authURL(c, "tenant"), {
        method: "POST",
        body: { app_id: c.appId, app_secret: c.appSecret },
        signal,
      }),
    );
    const token = secretString(
      response.tenant_access_token,
      "tenant_access_token",
    );
    const expiresAt = expiry(response.expire ?? response.expires_in);
    await withLock("tenant-tokens-write", async () => {
      const tokens = await tokenStore("tenant-tokens.json");
      tokens[c.storageKey] = { token, expiresAt };
      await writeStore("tenant-tokens.json", tokens);
    });
    return token;
  });
}

export async function getApplicationUserScopes(
  c,
  {
    signal,
    getBotToken: getToken = getBotToken,
    fetchJSON: fetcher = fetchJSON,
  } = {},
) {
  const token = await getToken(c, { signal });
  const data = unbox(
    await fetcher(
      new URL(
        `/open-apis/application/v6/applications/${encodeURIComponent(c.appId)}?lang=zh_cn`,
        c.openBaseUrl,
      ),
      { headers: { Authorization: `Bearer ${token}` }, signal },
    ),
  );
  const scopes = (data.app ?? data).scopes;
  if (!Array.isArray(scopes)) return [];
  return [
    ...new Set(
      scopes
        .filter((scope) => {
          const types = scope?.token_types ?? scope?.tokenTypes;
          return (
            scope?.enabled !== false &&
            Array.isArray(types) &&
            types.includes("user")
          );
        })
        .map((scope) => scope.scope)
        .filter(
          (scope) => typeof scope === "string" && /^[^\s,]+$/.test(scope),
        ),
    ),
  ];
}

function normalizedScopes(value) {
  const entries = Array.isArray(value) ? value : [value];
  if (entries.some((entry) => typeof entry !== "string"))
    throw new CliError("validation", "OAuth scopes must be strings");
  const scopes = [
    ...new Set(
      entries.flatMap((entry) => entry.split(/[\s,]+/)).filter(Boolean),
    ),
  ];
  if (scopes.length > 200)
    throw new CliError(
      "validation",
      "OAuth login supports at most 200 distinct scopes",
      {
        hint: "Choose a smaller set of approved employee permissions with --scope.",
      },
    );
  return scopes.join(" ");
}

async function loginScopes(c, requested, options) {
  if (requested !== undefined || c.scope !== undefined) {
    const scope = normalizedScopes(
      requested === undefined ? c.scope : requested,
    );
    if (!scope)
      throw new CliError(
        "validation",
        "Specify at least one approved employee OAuth scope",
      );
    return scope;
  }
  const hint =
    'Save approved employee scopes with lark-ka config init --scope "…" or pass --scope to auth login.';
  try {
    const scope = normalizedScopes(await getApplicationUserScopes(c, options));
    if (!scope)
      throw new CliError(
        "permission",
        "The application reported no approved employee OAuth scopes",
        { code: 3 },
      );
    return scope;
  } catch (error) {
    if (error instanceof CliError && !options.signal?.aborted && !error.hint)
      error.hint = hint;
    throw error;
  }
}

export async function currentUser(c, token) {
  const accessToken =
    token === undefined
      ? await getUserToken(c)
      : secretString(token, "access_token");
  const user = unbox(
    await fetchJSON(authURL(c, "userInfo"), {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  );
  if (typeof user.open_id !== "string" || !user.open_id)
    throw new CliError("auth", "Current-user response has no open_id", {
      code: 3,
    });
  return user;
}
export async function authStatus(c, { verify = false } = {}) {
  let session = (await tokenStore("sessions.json"))[c.storageKey];
  if (!session && !process.env.LARKSUITE_CLI_USER_ACCESS_TOKEN)
    return {
      loggedIn: false,
      identity: "none",
      profile: c.profileName,
      appId: c.appId,
      brand: c.brand,
    };
  try {
    const token = await getUserToken(c);
    session = (await tokenStore("sessions.json"))[c.storageKey];
    const user = verify ? await currentUser(c, token) : session?.user;
    return {
      loggedIn: true,
      identity: "user",
      profile: c.profileName,
      appId: c.appId,
      brand: c.brand,
      verified: !!verify,
      user,
      scope: session?.scope,
      expiresAt: session?.expiresAt,
    };
  } catch (e) {
    if (e.type === "auth" || e.status === 401)
      return {
        loggedIn: false,
        identity: "none",
        reason: "expired",
        profile: c.profileName,
      };
    throw e;
  }
}
function openBrowser(url) {
  const app =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  const child = spawn(app[0], app[1], {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  child.on("error", () => {});
  child.unref();
}
export async function authLogin(
  c,
  flags,
  {
    emit = (data) => process.stderr.write(JSON.stringify(data) + "\n"),
    signal,
    getBotToken,
    fetchJSON: scopeFetchJSON,
  } = {},
) {
  if (signal?.aborted)
    throw new CliError("auth", "Login cancelled", { code: 3 });
  if (c.authFlow !== "device") {
    if (!["authorization-code", "authorization_code"].includes(c.authFlow))
      throw new CliError(
        "config",
        "authFlow must be device or authorization-code",
      );
    if (flags["no-wait"] || flags["device-code"])
      throw new CliError(
        "validation",
        "--no-wait and --device-code are only supported with device flow",
      );
  }
  const scope = flags["device-code"]
    ? undefined
    : await loginScopes(c, flags.scope, {
        signal,
        getBotToken,
        fetchJSON: scopeFetchJSON,
      });
  if (signal?.aborted)
    throw new CliError("auth", "Login cancelled", { code: 3 });
  if (c.authFlow === "device")
    return deviceLogin(c, { ...flags, scope }, { emit, signal });
  const state = randomBytes(32).toString("hex");
  const callback = new URL(
    flags["redirect-uri"] ||
      c.redirectUri ||
      `http://${flags["callback-host"] || "127.0.0.1"}:${flags["callback-port"] ?? 8989}${flags["callback-path"] || "/lark/oauth/callback"}`,
  );
  if (
    callback.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(callback.hostname) ||
    callback.search ||
    callback.hash ||
    callback.username ||
    callback.password
  )
    throw new CliError(
      "validation",
      "Local authorization callback must use an HTTP loopback URL without query or credentials",
    );
  let finish;
  const result = new Promise((resolve, reject) => {
    finish = { resolve, reject };
  });
  result.catch(() => {});
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, callback.origin);
    if (url.pathname !== callback.pathname) {
      res.writeHead(404).end();
      return;
    }
    const received = Buffer.from(url.searchParams.get("state") || ""),
      expected = Buffer.from(state);
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      res.writeHead(400).end("Invalid state");
      return;
    }
    if (url.searchParams.has("error")) {
      res.writeHead(400).end("Authorization declined");
      finish.reject(
        new CliError("auth", "User declined authorization", { code: 3 }),
      );
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400).end("Missing code");
      return;
    }
    res
      .writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      })
      .end("授权完成，可以关闭本页。");
    finish.resolve(code);
  });
  server.on("error", (e) =>
    finish.reject(
      new CliError(
        "auth",
        `Cannot start OAuth callback: ${e.code || e.message}`,
        { code: 3 },
      ),
    ),
  );
  let timeout;
  const abort = () =>
    finish.reject(new CliError("auth", "Login cancelled", { code: 3 }));
  signal?.addEventListener("abort", abort, { once: true });
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(
        Number(callback.port || 80),
        callback.hostname === "[::1]" ? "::1" : callback.hostname,
        resolve,
      );
    });
    callback.port = String(server.address().port);
    const url = new URL(authURL(c, "authorize"));
    url.searchParams.set(c.clientIdParam || "app_id", c.appId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", callback.href);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", scope);
    emit({
      event: "authorization_required",
      verification_url: url.href,
      verification_uri: url.href,
      redirect_uri: callback.href,
    });
    if (!flags["no-open"]) openBrowser(url.href);
    timeout = setTimeout(
      () => finish.reject(new CliError("auth", "Login timed out", { code: 3 })),
      Number(flags.timeout || 600) * 1000,
    );
    const code = await result;
    const token = unbox(
      await fetchJSON(
        authURL(c, "token"),
        tokenRequest(
          c,
          {
            grant_type: "authorization_code",
            code,
            redirect_uri: callback.href,
          },
          signal,
        ),
      ),
    );
    const user = await currentUser(c, token.access_token);
    const grantedScope = token.scope ?? scope;
    await saveSession(c, { ...token, scope: grantedScope }, user);
    return {
      loggedIn: true,
      identity: "user",
      user,
      scope: grantedScope,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
async function deviceLogin(c, flags, { emit, signal }) {
  let device;
  if (flags["device-code"])
    device = {
      device_code: flags["device-code"],
      interval: 5,
      expires_in: 600,
    };
  else {
    const headers = c.appSecret
      ? {
          Authorization: `Basic ${Buffer.from(`${c.appId}:${c.appSecret}`).toString("base64")}`,
        }
      : {};
    device = unbox(
      await fetchJSON(authURL(c, "device"), {
        method: "POST",
        headers,
        body: new URLSearchParams({ client_id: c.appId, scope: flags.scope }),
        signal,
      }),
    );
    if (!device.device_code)
      throw new CliError(
        "auth",
        "Device authorization response has no device_code",
        { code: 3 },
      );
    const url = device.verification_uri_complete || device.verification_uri;
    const event = {
      event: "device_authorization",
      verification_url: url,
      device_code: device.device_code,
      expires_in: device.expires_in,
    };
    if (flags["no-wait"]) return event;
    emit(event);
    if (url && !flags["no-open"]) openBrowser(url);
  }
  const end = Date.now() + Number(device.expires_in || 600) * 1000;
  let interval = Math.max(1, Number(device.interval || 5));
  while (Date.now() < end) {
    await delay(interval * 1000, undefined, { signal });
    let response;
    try {
      response = unbox(
        await fetchJSON(
          authURL(c, "token"),
          tokenRequest(
            c,
            {
              grant_type: "urn:ietf:params:oauth:grant-type:device_code",
              device_code: device.device_code,
            },
            signal,
          ),
        ),
      );
    } catch (e) {
      if (
        e.oauthError === "authorization_pending" ||
        /authorization_pending/.test(e.message)
      )
        continue;
      if (e.oauthError === "slow_down" || /slow_down/.test(e.message)) {
        interval += 5;
        continue;
      }
      throw e;
    }
    const user = await currentUser(c, response.access_token);
    const scope = response.scope ?? flags.scope;
    await saveSession(c, { ...response, scope }, user);
    return {
      loggedIn: true,
      identity: "user",
      user,
      ...(scope !== undefined && { scope }),
    };
  }
  throw new CliError("auth", "Device authorization timed out", { code: 3 });
}
export async function authLogout(c) {
  await withLock("sessions-write", async () => {
    const tokens = await tokenStore("sessions.json");
    for (const key of Object.keys(tokens))
      if (isProfileSessionKey(key, c.storageKey)) delete tokens[key];
    await writeStore("sessions.json", tokens);
  });
  return process.env.LARKSUITE_CLI_USER_ACCESS_TOKEN
    ? {
        loggedIn: true,
        identity: "user",
        profile: c.profileName,
        localSessionCleared: true,
        reason: "environment_token",
        hint: "The local session was cleared. Unset LARKSUITE_CLI_USER_ACCESS_TOKEN to stop using the externally supplied token.",
      }
    : { loggedIn: false, profile: c.profileName };
}
