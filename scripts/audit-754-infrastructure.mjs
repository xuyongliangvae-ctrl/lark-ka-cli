// Describe network dependencies outside the generated REST-method/shortcut list.
// Only route defaults and public SDK behavior are read. Never read local profiles.
import { readFile } from "node:fs/promises";
import { endpoints } from "../src/config.mjs";

function route(entry, method, path, context, evidence, source) {
  return { entry, method, path, context, evidence, source };
}

export async function infrastructureRows() {
  const auth = endpoints("cnooc");
  const defs = JSON.parse(
    await readFile(new URL("../data/events.json", import.meta.url), "utf8"),
  );
  const code = "已核对源码";
  const authMock = "本机 OAuth 模拟服务";
  const eventMock = "本机模拟订阅与事件分发";
  const authSource = "src/config.mjs · src/auth.mjs";
  const rows = [
    route(
      "auth login；auth _server-bridge authorize",
      "GET",
      auth.authorizePath,
      "租户授权单页列 client_id；浏览器打开授权页，回调须登记到应用。可通过 authorizeUrl/authorizePath 覆盖地址。",
      authMock,
      authSource,
    ),
    route(
      "auth login；auth _server-bridge exchange",
      "POST",
      auth.tokenPath,
      "租户授权码单页列 application/json; charset=utf-8，grant_type=authorization_code；tokenUrl/tokenPath 可覆盖。",
      authMock,
      authSource,
    ),
    route(
      "员工令牌续期",
      "POST",
      auth.refreshTokenPath || auth.tokenPath,
      "租户续期单页列 application/json; charset=utf-8，grant_type=refresh_token。可独立设 refreshTokenUrl/refreshTokenPath。",
      "本机并发刷新与失败模拟",
      authSource,
    ),
    route(
      "auth whoami --as user；auth status --verify/--connector；doctor --verify；登录后身份确认",
      "GET",
      auth.userInfoPath,
      "用当前员工 access_token 获取用户身份。userInfoUrl/userInfoPath 可覆盖。",
      authMock,
      authSource,
    ),
    route(
      "获取自建应用租户令牌",
      "POST",
      auth.tenantTokenPath,
      "应用身份请求和 auth scopes 可能使用此路径；外部令牌或有效缓存会跳过。",
      "本机租户令牌模拟服务",
      authSource,
    ),
    route(
      "auth whoami --as bot",
      "GET",
      "/open-apis/bot/v3/info/",
      "使用应用令牌查询机器人；应用须有相应机器人能力。",
      code,
      "src/cli.mjs",
    ),
    route(
      "auth scopes",
      "GET",
      "/open-apis/application/v6/applications/:app_id",
      "用应用令牌读取应用信息；仅返回 scopes 中 token_types 包含 user 的项。",
      "本机应用详情模拟响应",
      "src/management.mjs",
    ),
    route(
      "auth login（device 模式）",
      "POST",
      auth.devicePath,
      "仅显式选择设备流时请求 device_code；--device-code 恢复流程可跳过此步。",
      code,
      authSource,
    ),
    route(
      "auth login（设备授权轮询）",
      "POST",
      auth.tokenPath,
      "此模式使用 device_code grant。租户换码、刷新单页只补证这条 HTTP 路径，设备 grant 在租户的可用性待确认。",
      code,
      "src/auth.mjs",
    ),
    route(
      "config init --new（申请及轮询）",
      "POST",
      "/oauth/v1/app/registration",
      "这是 SaaS 的路径示例。私有部署必须显式指定 registrationUrl，轮询可另设 registrationPollUrl；包内指定自建应用可跳过。",
      "本机模拟 begin/poll",
      "src/management.mjs",
    ),
    route(
      "config init --new（用户确认页）",
      "GET",
      "/page/cli",
      "注册服务未返回 verification_uri_complete 时，CLI 把此页面链接显示给用户。",
      code,
      "src/management.mjs",
    ),
    route(
      "event consume、event +subscribe、各业务域的监听命令",
      "POST",
      "/callback/ws/endpoint",
      "Node SDK 使用应用凭据发现 WSS 地址。随后连接服务端返回的地址；事件订阅和端口连通性需单独验证。",
      "本机预览与模拟 SDK；实际发现请求由 SDK 实现",
      "src/events.mjs · @larksuiteoapi/node-sdk WSClient.pullConnectConfig",
    ),
  ];
  for (const def of defs.filter((d) => d.preConsume)) {
    for (const [key, label] of [
      ["subscribePath", "订阅"],
      ["unsubscribePath", "取消订阅"],
    ]) {
      rows.push(
        route(
          `event consume ${def.key}（${label}）`,
          "POST",
          def.preConsume[key],
          `CLI 允许 ${def.authTypes.join("/")}；声明 Scope ${def.scopes.join(", ")}。`,
          eventMock,
          "data/events.json · src/events.mjs",
        ),
      );
    }
  }
  rows.push(
    route(
      "event consume minutes.minute.generated_v1（补取标题）",
      "GET",
      "/open-apis/minutes/v1/minutes/:minute_token",
      "收到事件后按员工身份读取妙记元数据。",
      eventMock,
      "src/events.mjs",
    ),
    route(
      "event consume vc.note.generated_v1（补取产物）",
      "GET",
      "/open-apis/vc/v1/notes/:note_id",
      "收到事件后按员工身份读取纪要和逐字稿引用。",
      eventMock,
      "src/events.mjs",
    ),
  );
  return { rows, defs };
}

export const otherDependencies = [
  [
    "员工授权回调",
    "浏览器访问本机 GET `/lark/oauth/callback`；回调地址可配置。",
    "本机 OAuth 模拟服务验证 state 和授权码。",
  ],
  [
    "设备验证页",
    "浏览器打开设备服务返回的 verification_uri_complete 或 verification_uri。",
    "具体 URL 由授权服务决定。",
  ],
  [
    "事件连接和控制",
    "SDK 连接发现服务返回的 WSS URL；`event status` 和 `event stop` 访问本机回环 GET `/status`、POST `/stop`。",
    "本机事件测试使用替代 SDK；实际 UAT 长连接未联调。",
  ],
  [
    "通用 API、上传、下载",
    "`api` 的路径由参数决定；下载时可能使用接口返回的 URL。",
    "固定业务接口见主清单；外部地址依赖实际响应。",
  ],
  [
    "npm 更新",
    "`update --check` 调用 npm view；执行更新时调用 npm install。",
    "本机测试替代 npm 子进程；安装源由环境配置决定。",
  ],
  [
    "文档后端与 MCP",
    "海能原生 Docx 使用主清单路由；显式选择远程 MCP 时，文档工具调用 POST 至配置的 mcpUrl。`mcp serve` 使用本机 stdio。",
    "本机模拟 MCP HTTP/SSE 与 stdio 握手。",
  ],
  [
    "本地管理与命令说明",
    "`schema`、版本、帮助、补全、Skills 管理、常规 `config`/`profile`、`auth qrcode/list/logout` 主要操作元数据或本机文件。`auth check/status` 读会话，临近过期时可触发续期。",
    "本机配置/命令测试；`auth logout` 清理本机凭据。",
  ],
];

// These HTTP branches belong to commands already tabulated in the main report.
// Their explicit presence here records why an all-private-profile run cannot capture them.
export const optionalBranches = [
  ...[
    ["apps +list", "GET", ""],
    ["apps +create", "POST", ""],
    ["apps +update", "PATCH", "/:app_id"],
    ["apps +access-scope-get", "GET", "/:app_id/access-scope"],
    ["apps +access-scope-set", "PUT", "/:app_id/access-scope"],
    ["apps +html-publish", "POST", "/:app_id/upload_and_release_html_code"],
  ].map(([entry, method, suffix]) =>
    route(
      entry,
      method,
      `/open-apis/spark/v1/apps${suffix}`,
      "海能 Profile 在调用前返回不可用；代码启用条件为 feishu 品牌及员工身份。",
      "海能模拟配置已验证门禁",
      "src/domains/apps.mjs",
    ),
  ),
  ...[
    ["docs +create", "POST", ""],
    ["docs +fetch", "POST", "/:document_id/fetch"],
    ["docs +update", "PUT", "/:document_id"],
  ].map(([entry, method, suffix]) =>
    route(
      entry,
      method,
      `/open-apis/docs_ai/v1/documents${suffix}`,
      "仅显式启用 docs_ai 时调用；海能 Profile 默认使用原生 Docx。",
      "源码分支",
      "src/domains/content.mjs",
    ),
  ),
  route(
    "docs +search；drive +search",
    "POST",
    "/open-apis/search/v2/doc_wiki/search",
    "切换 documentSearchApi=v2 时使用；海能默认 suite 搜索。",
    "源码分支",
    "src/domains/content.mjs",
  ),
  route(
    "contact +search-user",
    "POST",
    "/open-apis/contact/v3/users/search",
    "切换 contactSearchVersion=v3 时使用；海能默认 v1 搜索。",
    "本机覆盖配置预览",
    "src/domains/collaboration.mjs",
  ),
  route(
    "im +chat-search",
    "POST",
    "/open-apis/im/v2/chats/search",
    "其他部署的群搜索。海能使用 GET /open-apis/im/v1/chats/search。",
    "源码分支",
    "src/domains/im.mjs",
  ),
];
