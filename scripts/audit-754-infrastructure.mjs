// Describe network dependencies outside the generated REST-method/shortcut list.
// Only route defaults are read. Never read local profiles.
import { endpoints } from "../src/config.mjs";

function route(entry, method, path, context, evidence, source) {
  return { entry, method, path, context, evidence, source };
}

export async function infrastructureRows() {
  const auth = endpoints("cnooc");
  const defs = [];
  const code = "已核对源码";
  const authMock = "本机 OAuth 模拟服务";
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
  ];
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
];
