---
name: lark-shared
description: "海能 Work CLI 的初始化、员工 OAuth 授权、身份、权限错误与命令查询规则。"
metadata:
  requires:
    bins: ["lark-ka"]
  cliHelp: "lark-ka auth --help; lark-ka config --help"
---

# 认证、配置与命令范围

本包使用 `lark-ka`。可用命令以 `lark-ka --help`、对应业务的 `--help` 和包内 `data/command-surface.json` 为准。调用前先查参数；业务命令仅包含云文档、云空间、原生 Markdown、多维表格、电子表格、幻灯片和画板。

## 初始化与员工授权

管理员通过 `config init` 保存客户域名、应用、回调地址及已批准的完整员工 Scope 清单。已有 Profile 时沿用它；不要因业务接口报错而覆盖客户配置。

```bash
lark-ka config show --profile customer-a
lark-ka --profile customer-a auth login --json
lark-ka --profile customer-a auth status --connector
lark-ka --profile customer-a auth whoami --as user --json
```

`auth login` 未显式指定 `--scope` 时，使用 Profile 已配置的权限清单；缺少清单时尝试读取应用的员工权限。联调指定部分权限时使用 `auth login --scope "docx:document offline_access" --json`。授权 URL 中空格分隔的多个 Scope 同属一个 `scope` 参数。服务端授权可能累积，授权页可能只显示新增权限，以返回的权限和接口校验结果判断。

授权码流会启动本机回调服务。保持登录命令运行，在同一台电脑浏览器中确认授权。回调地址与客户应用后台登记的地址必须一致。运行环境支持的设备流可使用 `--no-wait` 和 `--device-code` 分步完成；不要复用旧的授权码或链接。

`auth logout` 清除本机员工会话。服务端的历史授权需员工在海能 Work 应用授权管理中解除。

## 身份与权限错误

- 员工身份用 `--as user`，资源仍受员工自身的可见范围和协作权限限制。
- 应用身份用 `--as bot`，由自建应用的应用权限和资源权限决定。
- 接口错误中的 `error.detail.scopeAlternatives` 给出可用权限候选。应用未开通时先由管理员开通并发布；员工令牌缺少权限时，重新执行员工授权。
- 不要把资源权限不足当作本机配置丢失，也不要自动扩大授权范围。

## 输出和请求预览

JSON 结果在 stdout，错误在 stderr。判断成功看 `ok` 或退出码。用 `schema <服务.资源.方法>` 查看原生命令，用 `--dry-run` 检查写入请求。批量写入前确认资源标识、范围和用户意图；遇到 `confirmation_required` 时，在确认后沿用原参数添加 `--yes`。

```bash
lark-ka schema base.app.table.record.search
lark-ka base +record-batch-create --base-token BASE_TOKEN --table-id TABLE_ID \
  --json '{"records":[{"fields":{"名称":"示例"}}]}' --dry-run
```

不要在输出中暴露 App Secret、访问令牌或刷新令牌。可通过 `--app-secret-stdin` 预置本机凭据，或通过 `--app-secret-env` 保存运行环境变量名。

## 本地工具

`doctor` 检查配置与运行环境。`skills list` 和 `skills read` 读取本包技能。`update`、`completion bash|zsh|fish|powershell`、`auth qrcode` 和 `mcp serve` 按各自帮助使用。
