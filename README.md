# lark-ka-cli

面向飞书 / Lark / 私有化部署的 **Node.js 原生 CLI**。要求 **Node.js >=22**。运行、安装和业务请求均不依赖 Go、Go 二进制或 Go 源码。

命令名为 `lark-ka`。安装包仅注册此命令，可与官方 `lark-cli` 共存。

## 本地运行

```bash
npm ci
node bin/lark-ka.mjs --version
node bin/lark-ka.mjs --help
npm test
npm run check
npm run compatibility
```

也可以在该目录执行 `npm link` 后使用 `lark-ka`。本工程没有安装后下载官方内核的脚本。

## 通过参数配置客户环境

所有客户地址、App ID、Scope 和登录方式都可以通过 `config init` 参数传入，保存到独立 Profile。换客户时创建新的 Profile 并替换参数值即可，无需编辑 JSON 文件或修改源码。

下面以 `customer-a` 为例。所有 `.example.invalid` 地址、App ID 和 Scope 都是占位值，执行前替换为客户提供的实际配置。若在源码目录验证，可将 `lark-ka` 换成 `node bin/lark-ka.mjs`。

```bash
# 发布后从实际企业 npm 仓库安装；本地也可以安装生成的 tgz。
npm install -g @lark-ka/hn-work-cli@7.54.0 --registry="https://npm.customer-a.example.invalid/"

# 只传客户参数，不需要配置文件。
lark-ka config init --name customer-a \
  --brand custom \
  --app-id cli_EXAMPLE_APP_ID \
  --open-base-url "https://open.customer-a.example.invalid" \
  --accounts-base-url "https://accounts.customer-a.example.invalid" \
  --web-base-url "https://docs.customer-a.example.invalid" \
  --authorize-url "https://accounts.customer-a.example.invalid/REPLACE_WITH_AUTHORIZATION_PATH" \
  --token-url "https://open.customer-a.example.invalid/REPLACE_WITH_TOKEN_PATH" \
  --user-info-url "https://open.customer-a.example.invalid/REPLACE_WITH_USER_INFO_PATH" \
  --auth-flow authorization-code \
  --client-id-param client_id \
  --redirect-uri "http://127.0.0.1:8989/lark/oauth/callback" \
  --scope "该应用已批准的全部员工 Scope" \
  --docs-backend native \
  --default-as user \
  --strict-mode user
```

员工在内网或 VPN 环境使用。回调 URL 需先在客户自建应用后台登记。客户的实际 OAuth 参数名称可能是 `client_id` 或 `app_id`，以对应接口说明为准。

### 配置 App Secret

两种方式任选其一，不能同时指定：

- `--app-secret-stdin`：从标准输入读取并保存到受限的本地凭据文件。预置一次后，后续授权、注销、状态检查不需要重复设置 Secret 环境变量。
- `--app-secret-env CUSTOMER_A_APP_SECRET`：只保存环境变量名称。CLI 每次运行都需由实际执行环境提供该变量。

例如，在实际执行 CLI 的员工电脑或管理终端中，用安全输入流为已有 Profile 配置 Secret：

```bash
# Bash / zsh 交互式终端示例，输入时不回显；不用于后台无交互的安装命令。
read -rs CUSTOMER_A_APP_SECRET
printf '%s' "$CUSTOMER_A_APP_SECRET" | lark-ka config init --name customer-a --app-secret-stdin
unset CUSTOMER_A_APP_SECRET
```

若使用环境变量引用模式，在创建或更新 Profile 时增加 `--app-secret-env CUSTOMER_A_APP_SECRET`。豆包后台不同阶段的命令若不共享该环境变量，应使用一次预置并保存凭据的方式。

### 后续命令与切换客户

地址和 Scope 已保存，后续只需要同一个 Profile 名称：

```bash
lark-ka --profile customer-a auth login --json
lark-ka --profile customer-a auth whoami --as user --json
lark-ka --profile customer-a auth status --connector
lark-ka --profile customer-a auth logout
```

部署时在 Profile 中预置该应用已批准的完整员工 Scope 清单，并在应用支持续期时包含 `offline_access`。员工运行 `auth login` 时会在一次 OAuth 请求中申请整组权限。显式传入 `--scope` 可为单次联调指定范围。未配置清单时，CLI 会尝试从应用信息读取允许员工身份使用的 Scope。租户若限制应用信息接口读取，在部署时填写已批准的清单即可。

配置第二个客户时，复制初始化命令，将 `--name` 改为 `customer-b`，并替换对应地址、App ID、Scope 和凭据。随后所有业务命令使用 `--profile customer-b`；同一个 npm 包可服务多个客户。

### 可选接口参数

| 参数                                  | 用途                                                           |
| ------------------------------------- | -------------------------------------------------------------- |
| `--refresh-token-url`                 | 刷新 token 的完整地址；客户刷新接口与换取 token 接口不同时使用 |
| `--token-encoding json\|form`         | 换码与续期请求的编码。海能 Work 7.54 使用 JSON                 |
| `--device-url`                        | 使用设备授权流程时的完整授权接口地址                           |
| `--tenant-token-url`                  | 需要机器人身份时，获取 tenant token 的完整地址                 |
| `--mcp-url`                           | 客户实际可用的 MCP 文档服务完整地址                            |
| `--docs-backend native\|mcp\|docs-ai` | 选择原生 docx、MCP 或 docs_ai 文档接口                         |

JSON 配置方式仍然可用，适合统一保存部署模板：

```bash
lark-ka config init --name customer-a --deployment @./config/cnooc.example.json
```

命令行显式参数优先于 JSON 模板。公有版可选择 `--brand feishu` 或 `--brand lark`。`gjgw` 保留为兼容的私有化品牌名称；所有私有化客户均通过参数或 Profile 提供实际地址，公开代码不内置客户域名。原先依赖默认域名的 Profile 需补齐客户地址参数。

默认配置目录是 `~/.lark-ka-cli`；可通过 `LARK_KA_CONFIG_DIR` 覆盖，也支持 `LARKSUITE_CLI_CONFIG_DIR`。凭据和会话使用独立的、权限为 `0600` 的本地 JSON 文件，按应用和接口环境隔离。

## 使用示例

海能 Work 7.54 使用 `cnooc` 私有化 Profile。已配置的 `--brand custom --name cnooc` 和 `--brand cnooc` 会选择套件文档搜索与通讯录 v1。也可在初始化时显式设置 `--document-search-api suite --contact-search-version v1`。开放平台域名和员工令牌来自当前 Profile。

```sh
lark-ka --profile cnooc drive +search --as user --query '周报' --page-size 5
lark-ka --profile cnooc docs +search --as user --query '周报' --filter '{"docs_types":["doc"]}'
lark-ka --profile cnooc contact +search-user --as user --query '姓名' --page-size 20
```

两条文档搜索命令调用 `POST /open-apis/suite/docs-api/search/object`。文档在 `data.docs_entities`，续页使用返回的 `data.page_token`。接口限定 `offset + count < 200`，超出窗口时应缩小搜索范围。该接口要求员工令牌具备文档搜索或相应云盘权限，现有 `docx:document` 仅覆盖文档读写。搜索用户调用 `GET /open-apis/search/v1/user`，可使用 `--page-token` 续页。在其他租户使用对应的新版搜索时，可显式指定 `--document-search-api v2` 和 `--contact-search-version v3`。

海能 Work 的员工授权使用 Accounts 域下的 `/open-apis/authen/v1/authorize` 和 `client_id`。签发用户令牌和续期使用 OpenAPI 域的 `POST /open-apis/authen/v2/oauth/token`，均发送 JSON。获取当前员工身份使用 `GET /open-apis/authen/v1/user_info`。初始化示例保留客户域名占位符，接口路径已填入。

群聊搜索 `im +chat-search` 使用 `GET /open-apis/im/v1/chats/search`。多维表格的元数据、字段、视图、表单、仪表盘和常用记录操作已适配 Bitable v1 的相应接口。对表、字段和记录列表翻页时使用服务端返回的 `page_token`。

7.54.1 起，海能 Work 的 `base +base-create --name '项目台账'` 使用 Bitable v1 创建多维表格。按条件查询记录使用 `base:record:retrieve`，按记录 ID 获取使用 `base:record:read`。如果开放平台在权限拒绝时返回可用的 Scope，CLI 会在错误详情的 `scopeAlternatives` 中列出。

海能 Work 发布包内提供 46 个原生 Base API 命令和已适配的快捷命令。用 `lark-ka --profile cnooc base --help` 查看命令，用 `lark-ka schema base.app.table.record.search` 核对原生命令参数。[多维表格接口对照](docs/bitable-v1.md)

```bash
# 不调用真实 API 的请求预览
node bin/lark-ka.mjs im +messages-send --as user \
  --chat-id oc_EXAMPLE --text "hello" --dry-run

# 通用 API 与元数据 API 命令
node bin/lark-ka.mjs api GET /open-apis/calendar/v4/calendars --as user
node bin/lark-ka.mjs calendar calendars list --as user
node bin/lark-ka.mjs schema calendar.calendars.list

# 文档、表格、多维表格
node bin/lark-ka.mjs docs +fetch --doc DOC_TOKEN --as user
node bin/lark-ka.mjs sheets +workbook-info --spreadsheet-token SHEET_TOKEN
node bin/lark-ka.mjs base +base-get --base-token BASE_TOKEN

# 内置 MCP stdio 服务与事件
node bin/lark-ka.mjs mcp serve
node bin/lark-ka.mjs event consume im.message.receive_v1 --max-events 1 --timeout 30
```

JSON 结果写 stdout，错误写 stderr；支持 `@file` / stdin、分页、dry-run、JSON / table / CSV / NDJSON 输出。`--jq` 当前支持字段路径、数组展开、索引及路径管道，不包含完整 jq 语言。

## 迁移范围与验证边界

`data/shortcuts.json` 根据原项目静态导出快捷命令，`data/api-metadata.json` 保存开放平台元数据和本地覆盖项；运行时不读取原 Go 工程，也不自动从公网刷新客户接口。

`npm run compatibility` 生成 `docs/compatibility.json`，列出每条命令的实现登记与已知差异；可读版见 [兼容性说明](docs/compatibility.md)。**命令入口覆盖不等于 Go 版每个选项、输出归一化及所有边界行为均已等价**。高级文档格式、白板、邮件合成、同步等分支以兼容性报告和测试为准；不支持的输入会明确报错，不会伪装成已成功执行。

7.54.0 已对照海能 Work 测试租户的服务端 API 目录和部分接口单页。本地 HTTP 测试覆盖授权回调与 state、换码、续期、身份检查、请求结构和业务工作流。员工令牌、实际业务数据和资源权限仍待在租户内联调。

本版本的本地凭据方案不等同于“真实飞书 token 全部保存在集中认证后端”的方案。

## 分发与豆包工作

```bash
# 公开版本发布至 npm 官方后安装，要求 Node.js >=22。
npm install -g @lark-ka/hn-work-cli@7.54.0 --registry=https://registry.npmjs.org/

# 国内镜像同步到该版本后也可以安装。
npm install -g @lark-ka/hn-work-cli@7.54.0 --registry=https://registry.npmmirror.com/
lark-ka --version

# 本地打包与安装。
npm pack
npm install -g /absolute/path/to/lark-ka-hn-work-cli-7.54.2.tgz
```

豆包工作安装版本和版本检查需填写同一版本。例如版本 `7.54.2` 使用 `lark-ka --version --expect-version 7.54.2`。该命令仅在实际版本匹配时退出成功。

镜像同步可能有延迟，可通过 `npm view @lark-ka/hn-work-cli@7.54.0 version --registry=https://registry.npmmirror.com/` 查询。企业后台配置见 [docs/doubao-connector.md](docs/doubao-connector.md)。

## 更新命令定义

```bash
# 仅开发时从指定参考工程导出声明；不是运行依赖。
node scripts/generate-catalog.mjs /path/to/reference-project
npm run metadata:fetch
```

元数据获取命令显式访问官方开放平台。私有化部署可使用审核过的本地元数据快照，发布运行时不必访问公有开放平台。
