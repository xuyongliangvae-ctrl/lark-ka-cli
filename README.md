# lark-ka-cli

面向飞书 / Lark / 私有化部署的 **Node.js 原生 CLI**。要求 **Node.js >=22**。运行、安装和业务请求均不依赖 Go、Go 二进制或 Go 源码。

命令名为 `lark-ka`。安装包仅注册此命令，可与官方 `lark-cli` 共存。

## 命令范围

当前代码按需求清单保留 **304 条命令记录**，完整列表见 [命令清单](docs/commands.md)。基础配置、员工授权、本地查询工具和 `mcp serve` 继续提供；业务命令仅包含以下七类。

| 业务          | 命令前缀     | 范围                                                           |
| ------------- | ------------ | -------------------------------------------------------------- |
| 云文档        | `docs`       | 创建、读取、编辑、搜索、素材与文档画板                         |
| 云空间        | `drive`      | 文件目录、上传下载、导入导出、同步、评论、权限和版本           |
| 原生 Markdown | `markdown`   | 创建、读取、覆盖、局部修改与比较                               |
| 多维表格      | `base`       | Base、数据表、字段、记录、视图、表单、仪表盘、角色和工作流     |
| 电子表格      | `sheets`     | 工作簿、工作表、单元格、行列、筛选、图片、图表、透视表和迷你图 |
| 幻灯片        | `slides`     | 演示文稿、页面、图片和历史版本                                 |
| 画板          | `whiteboard` | 查询与更新                                                     |

`data/command-surface.json` 是命令保留清单。执行、帮助、补全、Schema、元数据和打包内容遵循同一范围。清单外的业务命令及其 Skills 已移除。通用 `api` 命令保留，路径由调用方显式提供。

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
npm install -g @lark-ka/hn-work-cli@7.54.4 --registry="https://npm.customer-a.example.invalid/"

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

先查询当前命令帮助或 Schema，再构造参数。海能 Work 配置可通过 `--document-search-api suite` 选择套件文档搜索；文档读写使用 `--docs-backend native`。开放平台域名、应用和员工令牌来自当前 Profile。

```bash
lark-ka --profile customer-a drive +search --as user --query '周报' --page-size 5
lark-ka --profile customer-a docs +fetch --as user --doc DOC_TOKEN
lark-ka --profile customer-a sheets +workbook-info --spreadsheet-token SHEET_TOKEN
lark-ka --profile customer-a base +base-get --base-token BASE_TOKEN

# 原生命令的请求结构
lark-ka schema base.app.table.record.search
lark-ka --profile customer-a base app.table.record search --as user \
  --params '{"app_token":"BASE_TOKEN","table_id":"TABLE_ID","page_size":20}' \
  --data '{"field_names":["名称"]}' --dry-run

# 本地工具和通用 API
lark-ka --profile customer-a doctor
lark-ka skills list
lark-ka mcp serve
lark-ka --profile customer-a api GET /open-apis/bitable/v1/apps/BASE_TOKEN --as user
```

套件文档搜索使用 `POST /open-apis/suite/docs-api/search/object`。结果在 `data.docs_entities`，续页使用返回的 `page_token`。缩小查询范围以满足服务端的分页窗口限制。原生 Base 接口使用 Bitable v1，接口对照见 [多维表格说明](docs/bitable-v1.md)。

JSON 结果写 stdout，错误写 stderr；支持 `@file` / stdin、分页、dry-run 和多种输出格式。`--jq` 支持字段路径、数组展开、索引及路径管道。

## 验证范围

保留清单决定命令入口，接口的实际执行还取决于部署环境、应用权限、员工授权和资源权限。`npm test` 覆盖参数校验、请求预览、本地 HTTP 模拟、授权和打包范围。`npm run compatibility` 生成保留命令的登记报告；见 [兼容性说明](docs/compatibility.md)。

本包使用受限本地文件保存配置与凭据。运行时不读取原 Go 工程，也不自动刷新客户接口目录。

## 分发与豆包工作

```bash
# 安装已发布的明确版本
npm install -g @lark-ka/hn-work-cli@7.54.4 --registry=https://registry.npmjs.org/
lark-ka --version --expect-version 7.54.4

# 打包当前工作区供本地验证
npm pack
```

源码中的删减需要发布新版本后才会影响 npm 安装；旧版本的包内容不会自动变化。豆包后台的安装版本与 `--expect-version` 应保持一致。连接器配置见 [豆包工作说明](docs/doubao-connector.md)。

## 更新命令定义

```bash
node scripts/generate-catalog.mjs /path/to/reference-project
npm run metadata:fetch
```

生成流程按 `data/command-surface.json` 筛选元数据，不恢复已删除的命令或 Skills。获取元数据会显式访问开放平台；部署运行使用包内快照。
