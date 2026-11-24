// Compare the packaged CLI's metadata methods and the captured shortcut requests
// with an exported API directory. This script never sends requests to a tenant.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { apiSpecs, packagedShortcuts } from "../src/metadata.mjs";
import { VERSION } from "../src/version.mjs";
import {
  infrastructureRows,
  optionalBranches,
  otherDependencies,
} from "./audit-754-infrastructure.mjs";

const { values } = parseArgs({
  options: {
    catalog: { type: "string" },
    shortcuts: {
      type: "string",
      default: "artifacts/shortcut-route-inventory.json",
    },
    supplement: { type: "string" },
    out: { type: "string", default: "artifacts" },
    source: {
      type: "string",
      default: "海能 Work UAT 租户开发文档「服务端 API 列表」",
    },
    date: { type: "string" },
  },
});
if (!values.catalog)
  throw Error(
    "Specify --catalog PATH containing one HTTP_METHOD /open-apis/path per line",
  );

// Only replace a whole parameter segment; e.g. /search and /list are distinct.
function segments(route) {
  return route
    .split(/[?#]/, 1)[0]
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      /^:[\w.-]+$|^\{[\w.-]+\}$|^<[\w.-]+>$|^%3[cC][\w.-]+%3[eE]$/.test(segment)
        ? "{}"
        : segment,
    );
}
function signature(method, parts) {
  return `${method} /${parts.join("/")}`;
}
function parseRoute(method, route) {
  const pathname = /^https?:\/\//i.test(route)
    ? new URL(route).pathname
    : route;
  return {
    method: method.toUpperCase(),
    path: pathname.split(/[?#]/, 1)[0].replace(/\/+$/, ""),
  };
}
async function readCatalog(file) {
  const rows = [];
  for (const line of (await readFile(file, "utf8"))
    .split("\n")
    .map((x) => x.trim())) {
    if (!line || line.startsWith("#")) continue;
    const match = /^(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)\s+(\S+)$/i.exec(
      line,
    );
    if (!match) throw Error(`Invalid catalog row: ${line}`);
    rows.push(parseRoute(match[1], match[2]));
  }
  return rows;
}
function lookup(rows) {
  const ids = new Map();
  const byMethod = new Map();
  for (const row of rows) {
    const parts = segments(row.path);
    ids.set(signature(row.method, parts), row);
    const candidates = byMethod.get(row.method) || [];
    candidates.push({ row, parts });
    byMethod.set(row.method, candidates);
  }
  return {
    ids,
    match(r, fixtures) {
      const parts = segments(r.path);
      const exact = ids.get(signature(r.method, parts));
      if (exact) return exact;
      if (!fixtures.size) return undefined;
      // Only wildcard a segment that the probe supplied as a synthetic ID.
      // This keeps fixed action suffixes like /search and /batch_get distinct.
      return (byMethod.get(r.method) || []).find((candidate) => {
        const theirs = candidate.parts;
        return (
          theirs.length === parts.length &&
          theirs.every(
            (p, i) =>
              p === parts[i] ||
              (p === "{}" &&
                (fixtures.has(parts[i]) ||
                  /fixture/i.test(parts[i]) ||
                  /^sheet01(?:!|%21)/i.test(parts[i]))),
          )
        );
      })?.row;
    },
  };
}
function addFixtureValues(target, flags) {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) return;
  for (const [key, value] of Object.entries(flags)) {
    if (
      !/(?:^|[-_])(?:id|ids|token|key|code|guid|mailbox|url)(?:$|[-_])/i.test(
        key,
      ) ||
      /(?:^|[-_])(?:type|format|scope)(?:$|[-_])/.test(key)
    )
      continue;
    const strings = Array.isArray(value) ? value : [value];
    for (const v of strings)
      if (typeof v === "string" && !v.includes("/") && v.length) {
        for (const part of v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)) {
          target.add(part);
          target.add(encodeURIComponent(part));
        }
      }
  }
}
const catalogRows = await readCatalog(values.catalog);
if (!catalogRows.length) throw Error("Empty tenant catalog");
const catalog = lookup(catalogRows);
const official = lookup(
  values.supplement ? await readCatalog(values.supplement) : [],
);
const captures = JSON.parse(await readFile(values.shortcuts, "utf8"));
const byCommand = new Map(
  captures.commands.map((c) => [`${c.service} ${c.command}`, c]),
);
const sourceNames = new Set(
  packagedShortcuts.map((c) => `${c.service} ${c.command}`),
);
if (
  byCommand.size !== sourceNames.size ||
  captures.commands.length !== sourceNames.size ||
  [...byCommand.keys()].some((k) => !sourceNames.has(k))
)
  throw Error("Shortcut inventory does not exactly match this CLI version");
if (captures.version && captures.version !== VERSION)
  throw Error("Shortcut inventory version does not match package version");

function compare({
  kind,
  service,
  name,
  routes,
  fixtures = new Set(),
  sampled = false,
  observation = "",
  scenarios = [],
  access = "",
  scopes = "",
}) {
  const matched = new Set(),
    supplemental = new Set(),
    absent = [];
  const unique = new Map();
  for (const r of routes) {
    const parsed = parseRoute(r.method, r.path);
    if (!parsed.path.startsWith("/open-apis/")) continue;
    unique.set(`${parsed.method} ${parsed.path}`, parsed);
  }
  for (const [key, r] of unique) {
    const inCatalog = catalog.match(r, fixtures);
    const inDocs = official.match(r, fixtures);
    if (inCatalog) matched.add(`${inCatalog.method} ${inCatalog.path}`);
    if (inDocs) supplemental.add(`${inDocs.method} ${inDocs.path}`);
    if (!inCatalog && !inDocs) absent.push(key);
  }
  const count = matched.size + supplemental.size;
  const status = !unique.size
    ? "未取得可比 HTTP 路径"
    : !count
      ? "目录未命中"
      : absent.length
        ? "部分路径命中"
        : "已列路径命中";
  const scenarioErrors = [
    ...new Set(
      scenarios
        .filter((s) => s.error)
        .map(
          (s) =>
            `${s.status}: ${typeof s.error === "string" ? s.error : JSON.stringify(s.error)}`,
        ),
    ),
  ];
  return {
    kind,
    service,
    name,
    status,
    matched: [...matched],
    supplemental: [...supplemental],
    absent,
    access,
    scopes,
    evidence: sampled
      ? [observation, ...scenarioErrors].filter(Boolean).join("；")
      : "CLI 元数据声明的 HTTP 方法与路径",
  };
}
const rows = [];
for (const spec of apiSpecs()) {
  const route = spec.path.startsWith("/open-apis/")
    ? spec.path
    : `${spec.servicePath.replace(/\/$/, "")}/${spec.path.replace(/^\//, "")}`;
  rows.push(
    compare({
      kind: "元数据 API",
      service: spec.service,
      name: `${spec.service} ${spec.resource} ${spec.method}`,
      routes: [{ method: spec.httpMethod, path: route }],
      access: (spec.accessTokens || []).join(", "),
      scopes: (spec.scopes || []).join(", "),
    }),
  );
}
for (const spec of packagedShortcuts) {
  const name = `${spec.service} ${spec.command}`,
    capture = byCommand.get(name);
  // resolveRef() returns this marker for a wiki object's token in a dry run.
  const fixtures = new Set(["me", "primary", "__WIKI_OBJECT_TOKEN__"]);
  for (const s of capture.scenarios || []) addFixtureValues(fixtures, s.flags);
  rows.push(
    compare({
      kind: "快捷命令",
      service: spec.service,
      name,
      routes: capture.routes || [],
      fixtures,
      sampled: true,
      observation: capture.status,
      scenarios: capture.scenarios || [],
    }),
  );
}
const order = new Intl.Collator("en");
rows.sort(
  (a, b) =>
    order.compare(a.service, b.service) || order.compare(a.name, b.name),
);
const statuses = [
  "已列路径命中",
  "部分路径命中",
  "目录未命中",
  "未取得可比 HTTP 路径",
];
const columns = [
  "类型",
  "业务域",
  "命令",
  "路径匹配结果",
  "UAT 目录命中",
  "租户单页补证",
  "目录未找到",
  "CLI 元数据令牌类型",
  "CLI 元数据 Scope 选项",
  "UAT 实际调用",
  "证据",
];
function csvCell(str) {
  return '"' + String(str).replaceAll('"', '""') + '"';
}
const lines = rows.map((r) => [
  r.kind,
  r.service,
  r.name,
  r.status,
  r.matched.join("\n"),
  r.supplemental.join("\n"),
  r.absent.join("\n"),
  r.access,
  r.scopes,
  "未进行",
  r.evidence,
]);
await mkdir(values.out, { recursive: true });
await writeFile(
  path.join(values.out, "hn-754-interface-audit.csv"),
  "\ufeff" +
    [columns, ...lines].map((r) => r.map(csvCell).join(",")).join("\r\n") +
    "\r\n",
);
const matches = rows.filter((r) => r.kind === "元数据 API");
const probes = rows.filter((r) => r.kind === "快捷命令");
const md = [
  `# 海能 Work ${VERSION} CLI 接口对照`,
  "",
  `核对范围为 ${matches.length} 条注册 API 方法和 ${probes.length} 条快捷命令，共 ${rows.length} 条。`,
  "",
  `来源为${values.source}。${values.date ? "目录采集于 " + values.date + "。" : ""}采集文件含 ${catalogRows.length} 条 HTTP 行，规范化去重后为 ${catalog.ids.size} 项。`,
  "",
  "另对 93 个官方候选文档逐项复核，在海能开放平台访问其原路径并按中文标题检索。画板、导出等接口在该租户有不同的文档路径。计入单页补证前已核对 HTTP 方法、接口路径及用途。遇到同名事件、邮件和审批接口，还要核对实体及令牌类型；实体不同或仅支持应用身份的接口不能替代员工调用。",
  "",
  "本机已配置海能 Profile。`auth status --connector` 返回 `loggedIn: false`，`auth whoami --as user` 返回未登录。缺少可用员工令牌，主表的每条命令均标记为尚未向 UAT 发起实际业务请求。",
  "",
  "元数据 API 按实际方法、服务前缀和路径比较。快捷命令使用受控样例获得的请求或识别出的本地门禁，覆盖范围取决于样例、后端与命令选项。逐段匹配路径变量，保留固定路径段和 HTTP 方法。",
  "",
  "目录命中证明接口在租户文档中有记录。员工令牌、已授 Scope、具体请求体、资源 ACL 与业务响应仍需实测。未命中表示本次目录未收录该路径，也可能是目录别名或未捕获参数。未取得 HTTP 路径的命令保留其原因。CSV 同时提供精确路径、元数据令牌类型及 Scope 选项。",
  "",
  "| CLI 入口 | 总数 | " + statuses.join(" | ") + " |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
];
const services = [...new Set(rows.map((row) => row.service))];
function summaryRow(label, entries) {
  const counts = statuses.map(
    (status) => entries.filter((row) => row.status === status).length,
  );
  return `| ${[label, entries.length, ...counts].join(" | ")} |`;
}
md.push(summaryRow("元数据 API", matches), summaryRow("快捷命令", probes));
const observations = Object.entries(
  captures.commands.reduce((counts, cmd) => {
    counts[cmd.status] = (counts[cmd.status] ?? 0) + 1;
    return counts;
  }, {}),
);
const labels = {
  "dry-run-routes": "生成 HTTP 请求预览",
  "blocked-by-profile": "被当前部署或员工身份限制",
  "blocked-by-parser": "参数被当前 CLI 拒绝",
  "fixture-unresolved": "样例还需补充",
  "no-http-in-preview": "未生成 HTTP 请求",
};
md.push(
  "",
  "快捷命令样例结果为" +
    observations
      .map(([status, total]) => `${labels[status] || status} ${total} 条`)
      .join("、") +
    "。",
  "",
  "## 按业务域汇总",
  "",
  "| 业务域 | 总数 | " + statuses.join(" | ") + " |",
  "| --- | ---: | ---: | ---: | ---: | ---: |",
);
for (const service of services)
  md.push(
    summaryRow(
      service,
      rows.filter((row) => row.service === service),
    ),
  );
md.push(
  "",
  "## 租户单页与目录差异",
  "",
  "服务端 API 目录可能保留旧路径或省略当前接口。下列项已另核对本租户的接口单页。",
  "",
  "| 功能 | 单页所列的方法和路径 | 单页位置与差异 |",
  "| --- | --- | --- |",
  "| 导出产物下载 | `GET /open-apis/drive/v1/export_tasks/file/:file_token/download` | `/document/uAjLw4CM/ukTMukTMukTM/reference/drive-v1/export_task/download`。服务端 API 目录的下载路径省略 `v1`，当前单页与 CLI 路径一致。 |",
  "| 修改表格下拉列表 | `PUT /open-apis/sheets/v2/spreadsheets/:spreadsheetToken/dataValidation/:sheetId` | `/document/ukTMukTMukTM/uATMzUjLwEzM14CMxMTN/datavalidation/update-datavalidation`。更新范围由请求体的 `ranges` 指定；带 `validationId` 路径的接口已标记为历史接口。 |",
  "| 读正文、下载画板 | `GET /open-apis/docx/v1/documents/:document_id/raw_content`，`GET /open-apis/board/v1/whiteboards/:whiteboard_id/download_as_image` | 租户单页 `/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document/raw_content` 和 `/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/board-v1/whiteboard/download_as_image` 分别确认两条路径。 |",
  "| 读取画板节点 | `GET /open-apis/board/v1/whiteboards/:whiteboard_id/nodes` | `/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/board-v1/whiteboard-node/list` 允许 `user_access_token` 和 `tenant_access_token`。`whiteboard +query` 的节点模式和图片模式均有租户单页依据。 |",
  "| 审批实例详情 | `GET /open-apis/approval/v4/instances/:instance_id` | 租户 `/document/uAjLw4CM/ukTMukTMukTM/reference/approval-v4/instance/get` 只列 `tenant_access_token`。CLI 的员工身份详情请求走 `GET /open-apis/approval/v4/instances/detail`。切换到应用身份会改变可见范围，该单页无法证明员工接口可用。 |",
  "| 员工 OAuth | `GET /open-apis/authen/v1/authorize`，`POST /open-apis/authen/v2/oauth/token` | 授权使用 `client_id`；换码及刷新使用 JSON。三篇租户单页见[鉴权表](hn-754-infrastructure-audit.md)。 |",
  "",
  "## 本版修正及下一步验证",
  "",
  "| 场景 | 7.54 的适配与边界 | 联调重点 |",
  "| --- | --- | --- |",
  "| 云文档搜索 | `docs +search`、`drive +search` 使用 Suite 搜索，映射 `search_key`、`count`、`offset`、`docs_entities` 和旧版翻页边界。 | 使用员工令牌及租户接口页接受的搜索权限。核对返回标题与员工可见范围。 |",
  "| 员工搜索 | `contact +search-user` 按关键词 GET `search/v1/user`，返回员工数据和续页游标。 | 使用获批的 `contact:user:search` 验证可见同事与下一页；人员字段以当前员工实际权限为准。 |",
  "| 群聊搜索 | `im +chat-search` 使用 GET `/open-apis/im/v1/chats/search`。 | 验证员工可见群、关键词与续页游标。高级筛选依赖部署所支持的接口。 |",
  "| 原生文档 | HaiNeng 原生文档配置走 Docx 路径。 | 以 `docx:document` 和可写测试目录验证创建空文档、追加块、再读回正文。 |",
  "| 多维表格 | Base、表、字段、视图、记录、表单与仪表盘的 13 个命令走 Bitable v1；逐项见下表。 | 核对表、字段、记录权限及 Base 内部 ACL。公有接口列出 `base:record:retrieve`。请在租户接口页核对 `base:record:read` 的适用范围，并在测试表验证写入。[查询记录接口说明](https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/reference/bitable-v1/app-table-record/search.md) |",
  "",
  "对“部分路径命中”的命令，先逐项核对未命中的环节。读取成功、正文保存、附件上传等环节可能分别访问不同接口。对于只在 CLI 中找到的路径，先按业务名检查租户 API 单页；找到替代接口后，再校验方法、输入、输出和分页。缺少证据的能力在试点中标记为待确认。",
);
md.push(
  "",
  "## 其他 CLI 入口",
  "",
  "以下入口按用途单列。它们要么在本地运行，要么调用部署配置或调用者选定的服务。API 对照表统计固定业务入口。",
  "",
  "| 入口 | 对照方式 |",
  "| --- | --- |",
  "| `api` | 通用 HTTP 方法和路径由调用者传入。可用 `--dry-run` 检查参数，再按所用路径查租户目录。 |",
  "| `auth`、`doctor` | 当前员工身份检查及授权、换码和续期依赖 Profile 的实际端点、回调登记和应用凭据。以员工身份完成授权与续期后才能验证闭环。 |",
  "| `config`、`profile` | 主要读写本机配置。自动注册、绑定等模式还可能依赖额外部署服务。 |",
  "| `event` | 事件名、订阅类型、WebSocket 和凭据影响数据接收。注册单个 HTTP 路径不足以证明事件会回传。 |",
  "| `mcp serve` | 本机通过 stdio 提供 MCP，具体工具调用沿用其对应快捷命令的路由。 |",
  "| `schema`、`skills`、`completion`、帮助与版本 | 读取随包元数据、Skill 和本机配置，命令输出在本地验证。 |",
  "| `update` | 读取配置的 npm 仓库，按需安装包。可用性取决于发布状态和安装源。 |",
);
const esc = (v) =>
  String(v)
    .replaceAll("|", "\\|")
    .replace(/[\r\n]+/g, " ");
const { rows: infra, defs: events } = await infrastructureRows();
const pathEvidence = (r) => {
  const hit = catalog.match(r, new Set());
  const page = official.match(r, new Set());
  return (
    [hit && "目录命中", page && "租户单页已确认"].filter(Boolean).join("、") ||
    "目录未命中"
  );
};
const infraMd = [
  `# ${VERSION} 鉴权、应用管理与事件接口`,
  "",
  "本表按运行阶段列出固定 HTTP 路径。授权地址可能被包内 Profile 的 URL 或路径覆盖。以下为 CLI 默认路径与源码使用条件，最终登录地址取决于部署配置。HTTP 目录仅提供方法与路径证据。此处标记的本机测试均使用模拟服务、SDK 或 CLI 预览；海能 UAT 的实际业务请求尚未执行。",
  "",
];
infraMd.push(
  "租户单页依据可从当前已登录的租户开放平台打开：",
  "",
  "- 授权码获取页面 `/document/common-capabilities/sso/api/obtain-oauth-code`。",
  "- 授权码换取员工令牌页面 `/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/get-user-access-token`。",
  "- 刷新员工令牌页面 `/document/uAjLw4CM/ukTMukTMukTM/authentication-management/access-token/refresh-user-access-token`。",
  "",
);
const infraHeading = [
  "| 入口 / 阶段 | HTTP 方法及路径 | UAT 文档 | 适用条件 | 本机证据 | 代码位置 |",
  "| --- | --- | --- | --- | --- | --- |",
];
const infraMdRow = (r) =>
  `| ${esc(r.entry)} | \`${esc(r.method + " " + r.path)}\` | ${pathEvidence(r)} | ${esc(r.context)} | ${esc(r.evidence)} | ${esc(r.source)} |`;
infraMd.push(
  `## 鉴权、应用信息与事件的 ${infra.length} 个调用阶段`,
  "",
  ...infraHeading,
  ...infra.map(infraMdRow),
);
infraMd.push(
  "",
  "## 本机端点、动态地址与非 REST 协议",
  "",
  "| 入口 | 通信方式 | 验证范围 |",
  "| --- | --- | --- |",
  ...otherDependencies.map((r) => `| ${r.map(esc).join(" | ")} |`),
);
infraMd.push(
  "",
  "## 其他后端或品牌限定的业务分支",
  "",
  "以下为主清单中因品牌门禁而未触发的 Spark 调用，以及文档与搜索的可选后端。切换品牌或后端会改变实际路由。",
  "",
  ...infraHeading,
  ...optionalBranches.map(infraMdRow),
);
infraMd.push(
  "",
  `## 包内 ${events.length} 个事件定义`,
  "",
  "事件标识是订阅名。它们的投递权限和员工可见范围要在租户事件目录及实际客户端验证。",
  "",
  "| 事件标识 | CLI 模式 | CLI 身份 | 本地声明 Scope |",
  "| --- | --- | --- | --- |",
);
for (const e of events) {
  const mode = e.rawOnly
    ? "原始应用事件（event +subscribe）"
    : e.userFlow === "mail-watch"
      ? "mail +watch 专用"
      : "event consume";
  infraMd.push(
    `| \`${esc(e.key)}\` | ${mode} | ${esc((e.rawOnly ? e.rawAuthTypes : e.authTypes).join("/"))} | ${esc((e.scopes || []).join(", "))} |`,
  );
}
await writeFile(
  path.join(values.out, "hn-754-infrastructure-audit.md"),
  infraMd.join("\n") + "\n",
);
const infraLines = [
  [
    "分类",
    "入口或阶段",
    "方法",
    "路径",
    "租户文档",
    "适用条件",
    "本机证据",
    "UAT 实际调用",
    "源码",
  ],
  ...[
    ["鉴权、事件和应用管理", infra],
    ["额外部署分支", optionalBranches],
  ].flatMap(([kind, set]) =>
    set.map((r) => [
      kind,
      r.entry,
      r.method,
      r.path,
      pathEvidence(r),
      r.context,
      r.evidence,
      "未进行",
      r.source,
    ]),
  ),
];
await writeFile(
  path.join(values.out, "hn-754-infrastructure-audit.csv"),
  "\ufeff" +
    infraLines.map((r) => r.map(csvCell).join(",")).join("\r\n") +
    "\r\n",
);
md.push(
  "",
  `鉴权、应用信息、事件等 ${infra.length} 个调用阶段的逐路径证据、${events.length} 个事件标识及额外后端分支见[基础接口对照](hn-754-infrastructure-audit.md)。`,
);
const partialNotes = {
  "base +record-download-attachment":
    "Drive 素材下载已列；还要验证多维表格定位附件的请求。",
  "base +record-upload-attachment":
    "Drive 素材上传已列；写入记录附件及字段检查还要验证。",
  "docs +fetch": "逐一核对 Wiki 节点解析、正文和块列表。",
  "docs +media-download":
    "按普通素材、画板分别核对下载请求，两者依赖不同服务。",
  "drive +export":
    "创建导出任务、查状态、下载导出产物是三个独立请求，需核对下载路径前缀。",
  "drive +task_result":
    "按场景选择导入、导出、Wiki 或文件任务接口，需分别核对。",
  "sheets +cells-set-image": "素材上传、把图片写入表格是两个独立步骤。",
  "vc +notes": "会议与录制元数据和会议纪要内容分属不同接口。",
  "wiki +node-delete": "查询节点与执行删除分属不同方法。",
};
const partial = rows.filter((r) => r.status === "部分路径命中");
md.push(
  "",
  "## 多接口命令的部分命中情况",
  "",
  "| 命令 | 尚缺 UAT 路由证据 | 决定联调结果的环节 |",
  "| --- | --- | --- |",
);
for (const r of partial)
  md.push(
    `| \`${r.name}\` | ${r.absent.map((x) => "`" + esc(x) + "`").join("<br>")} | ${partialNotes[r.name] || "逐条验证表中未命中的方法与路径。"} |`,
  );
for (const svc of services) {
  md.push(
    "",
    `## ${svc}`,
    "",
    "| 命令 | 类型 | 匹配结果 | 接口及证据 |",
    "| --- | --- | --- | --- |",
  );
  for (const r of rows.filter((x) => x.service === svc)) {
    const detail = [
      ...r.matched.map((v) => `目录：\`${esc(v)}\``),
      ...r.supplemental.map((v) => `单页：\`${esc(v)}\``),
      ...r.absent.map((v) => `未命中：\`${esc(v)}\``),
    ];
    if (r.kind === "快捷命令") detail.push(esc(r.evidence));
    md.push(
      `| \`${esc(r.name)}\` | ${r.kind} | ${r.status} | ${detail.filter(Boolean).join("<br>")} |`,
    );
  }
}
await writeFile(
  path.join(values.out, "hn-754-interface-audit.md"),
  md.join("\n") + "\n",
);
console.log(
  JSON.stringify(
    {
      toolVersion: VERSION,
      catalogEntries: catalog.ids.size,
      metadata: matches.length,
      shortcuts: probes.length,
      statusCounts: Object.fromEntries(
        statuses.map((s) => [s, rows.filter((x) => x.status === s).length]),
      ),
    },
    null,
    2,
  ),
);
