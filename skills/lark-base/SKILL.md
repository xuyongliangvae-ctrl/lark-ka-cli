---
name: lark-base
version: 1.2.3
description: "使用海能 Work Bitable v1 读取并管理 Base、数据表、字段、视图、记录、表单、仪表盘、角色和工作流。支持定位 Base 链接、Schema、分页和预览写入。"
metadata:
  requires:
    bins: ["lark-ka"]
  cliHelp: "lark-ka --profile cnooc base --help"
---

# 海能 Work 多维表格

本指南适用于 `lark-ka 7.54.1` 的海能 Work 配置。多维表格通过员工身份调用 Bitable v1。用 `lark-ka --profile cnooc auth status --connector` 核对当前身份和授权。以下命令中的标识均需替换为实际值。

## 定位 Base 和数据表

普通 `/base/{token}` 链接中的路径标识是 Base 标识，快捷命令传 `--base-token`，原生命令在 `--params` 中传 `app_token`。链接查询参数里的 `table` 和 `view` 分别定位数据表和视图。Wiki 链接先用 `lark-ka --profile cnooc wiki +node-get` 解析，当节点类型为 `bitable` 时取 `obj_token`。只有标题时，用 `lark-ka --profile cnooc drive +search --query '表名' --doc-types bitable --as user` 查找，再核对标题和归属。

~~~bash
lark-ka --profile cnooc base +base-get --as user --base-token base_example
lark-ka --profile cnooc base +table-list --as user --base-token base_example --limit 20
lark-ka --profile cnooc base +table-get --as user --base-token base_example --table-id tbl_example
~~~

## 快捷命令

| 目标 | 命令 | 参数与结果 |
| --- | --- | --- |
| 创建、复制或查看 Base | `+base-create`、`+base-copy`、`+base-get` | 创建传 `--name`。复制可传 `--without-content` 只复制结构。查看使用 `--base-token`，响应中的 `data.base.base_token` 是 Base 标识。 |
| 创建、列出或查看数据表 | `+table-create`、`+table-list`、`+table-get` | 创建传 `--name`，可加 `--fields`、`--view` 的 JSON。详情返回 `table`、`fields`、`views`。如果表已创建而视图创建失败，按返回的 `table_id` 补建视图。 |
| 列出或查看字段、视图 | `+field-list`、`+field-get`、`+view-list`、`+view-get` | 用 `--table-id` 定位数据表。详情分别使用 `--field-id` 或 `--view-id`，接受标识或确切名称。 |
| 列出、搜索或按标识取记录 | `+record-list`、`+record-search`、`+record-get` | 列出与搜索每页最多 500 条。按标识读取可重复传 `--record-id`，最多 200 个，CLI 每次向服务端查询最多 100 个。 |
| 批量新增、更新和删除记录 | `+record-batch-create`、`+record-batch-update`、`+record-delete` | 写入 JSON 按实际字段名构造。`+record-delete` 按记录标识删除。 |
| 读取表单和列出仪表盘 | `+form-get`、`+dashboard-list` | 表单需传数据表标识和 `--form-id`。仪表盘用 `--base-token` 并从 `data.dashboards` 读取列表。 |

字段投影、关键词匹配和排序使用实际字段名。`+record-search` 的 `--search-field` 对目标字段执行 `contains` 匹配。`--filter-json` 用 `conjunction`、`conditions` 或 `children` 表示条件，条件项使用 `field_name`、`operator` 和 `value`。按标识取记录返回完整可见字段，并分别列出 `absent_record_ids` 和 `forbidden_record_ids`。需要投影时用列出或搜索记录，显式指定 `--format json` 读取结构化结果。

~~~bash
lark-ka --profile cnooc base +record-search --as user --base-token base_example \
  --table-id tbl_example --keyword '待核对' --search-field '名称' --limit 20 --format json
~~~

数据表、字段和视图列表每页最多 100 条。`has_more` 为真时，用响应的 `page_token` 作为下次的 `--page-token`，也可使用 `--page-all`。这些列表的数值偏移只接受 0。存在后续页时，单页结果只代表该页数据。海能接口明确返回 `total: 0`、`has_more: false` 时，CLI 将省略的集合转换为空列表。

新增、更新前先核对字段类型和实际名称。批量新增、更新可以用 `records` 数组，每项包含 `fields`，更新时再填 `record_id`。`+record-batch-update` 也接受 `record_id_list` 加 `patch`，将同一份变更应用到指定记录。`+record-batch-create` 可传 UUIDv4 `--client-token` 作为重试的幂等键。

~~~bash
lark-ka --profile cnooc base +record-batch-create --as user --base-token base_example \
  --table-id tbl_example --json '{"records":[{"fields":{"名称":"待核对事项"}}]}' --dry-run
~~~

## Bitable v1 原生命令

调用形式为 `lark-ka --profile cnooc base <资源> <方法>`。用 `lark-ka --profile cnooc schema base.<资源>.<方法>` 获取参数和 JSON 请求体定义。用 `--params` 提供路径和查询参数，用 `--data` 提供 JSON 请求体。

| 资源 | 已提供的方法 |
| --- | --- |
| `app` | `copy`、`create`、`get`、`update` |
| `app.dashboard` | `copy`、`list` |
| `app.role` | `create`、`delete`、`list`、`update` |
| `app.role.member` | `batch_create`、`batch_delete`、`create`、`delete`、`list` |
| `app.table` | `batch_create`、`batch_delete`、`create`、`delete`、`list`、`patch` |
| `app.table.field` | `create`、`delete`、`list`、`update` |
| `app.table.form` | `get`、`patch` |
| `app.table.form.field` | `list`、`patch` |
| `app.table.record` | `batch_create`、`batch_delete`、`batch_get`、`batch_update`、`create`、`delete`、`get`、`list`、`search`、`update` |
| `app.table.view` | `create`、`delete`、`get`、`list`、`patch` |
| `app.workflow` | `list`、`update` |

~~~bash
lark-ka --profile cnooc schema base.app.table.record.search
lark-ka --profile cnooc base app.table.record search --as user \
  --params '{"app_token":"base_example","table_id":"tbl_example","page_size":20}' \
  --data '{"field_names":["名称"]}' --dry-run
~~~

## 权限和写入确认

CLI 的 `error.detail.scopeAlternatives` 会列出接口返回的权限候选。接口接受多个替代权限时，优先开通满足该操作的细粒度权限。更新应用授权后由员工重新授权。访问或写入还需要目标 Base 或目录的资源权限。

| 操作 | 权限 |
| --- | --- |
| 读取 Base、数据表、字段、视图 | `base:app:read`、`base:table:read`、`base:field:read`、`base:view:read`。快捷表详情还会读取字段与视图。 |
| 快捷列记录和搜索、按标识批量读取 | `base:record:retrieve` 用于快捷列记录和搜索。`base:record:read` 用于按标识批量读取。 |
| 读表单、列仪表盘和角色 | `base:form:read`、`base:dashboard:read`、`base:role:read`。角色与角色成员操作还依赖 Base 高级权限。 |
| 创建 Base、数据表和可选视图 | `base:app:create`、`base:table:create`。创建视图用 `base:view:write_only`。 |
| 新增、更新和删除记录 | `base:record:create`、`base:record:update`、`base:record:delete`。 |
| 查询工作流 | 海能 Work 联调返回的权限候选为 `bitable:app:readonly` 或 `bitable:app`。 |

先用 `--dry-run` 确认资源标识和请求体。删除对象、修改角色和角色成员、调整共享设置或改变工作流启停前，确认用户要求和影响范围。遇到 `confirmation_required` 时，将具体目标及变更提交用户确认后再加 `--yes`。收到部分成功时，先读回实际状态，再处理失败项。
