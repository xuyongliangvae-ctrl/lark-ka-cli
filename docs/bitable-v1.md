# 海能 Work 多维表格 Bitable v1

海能 Work Profile 提供已对齐的 Base 快捷命令和 46 个 Bitable v1 原生接口入口。用 `lark-ka --profile cnooc base --help` 查询当前可用命令。原生命令格式为 `base <资源> <方法>`。路径和查询参数通过 `--params` 传入，请求体通过 `--data` 传入。用 `lark-ka --profile cnooc schema base.<资源>.<方法>` 查看字段、权限候选和原始 API 文档。

```bash
lark-ka --profile cnooc base app get --as user --params '{"app_token":"bascnExample"}'
lark-ka --profile cnooc base app.table.record search --as user --params '{"app_token":"bascnExample","table_id":"tblExample","page_size":20}' --data '{"field_names":["名称"]}'
lark-ka --profile cnooc base app.table.record batch_create --as user --params '{"app_token":"bascnExample","table_id":"tblExample"}' --data '{"records":[{"fields":{"名称":"联调记录"}}]}' --dry-run
```

员工 OAuth 使用应用已开通的 Scope 及员工自身资源权限。Base 元数据、表、字段、视图、记录、表单和仪表盘分别有细粒度权限。高级权限角色及自动化流程需要相应权限。CLI 会在权限报错中显示服务器返回的 Scope 候选。删除、权限管理和自动化启停在真实执行时要求 `--yes`，可先使用 `--dry-run` 查看请求。

## 接口对照

路径均从 `/open-apis/bitable/v1` 起。方法、路径参数、查询参数和请求体来自拍平后的官方 SDK 与接口单页。

| 类别             | CLI 命令                             | 方法     | 相对路径                                                                |
| ---------------- | ------------------------------------ | -------- | ----------------------------------------------------------------------- |
| 多维表格         | `base app copy`                      | `POST`   | `/apps/{app_token}/copy`                                                |
| 多维表格         | `base app create`                    | `POST`   | `/apps`                                                                 |
| 多维表格         | `base app get`                       | `GET`    | `/apps/{app_token}`                                                     |
| 多维表格         | `base app update`                    | `PUT`    | `/apps/{app_token}`                                                     |
| 数据表           | `base app.table batch_create`        | `POST`   | `/apps/{app_token}/tables/batch_create`                                 |
| 数据表           | `base app.table batch_delete`        | `POST`   | `/apps/{app_token}/tables/batch_delete`                                 |
| 数据表           | `base app.table create`              | `POST`   | `/apps/{app_token}/tables`                                              |
| 数据表           | `base app.table delete`              | `DELETE` | `/apps/{app_token}/tables/{table_id}`                                   |
| 数据表           | `base app.table list`                | `GET`    | `/apps/{app_token}/tables`                                              |
| 数据表           | `base app.table patch`               | `PATCH`  | `/apps/{app_token}/tables/{table_id}`                                   |
| 视图             | `base app.table.view create`         | `POST`   | `/apps/{app_token}/tables/{table_id}/views`                             |
| 视图             | `base app.table.view delete`         | `DELETE` | `/apps/{app_token}/tables/{table_id}/views/{view_id}`                   |
| 视图             | `base app.table.view get`            | `GET`    | `/apps/{app_token}/tables/{table_id}/views/{view_id}`                   |
| 视图             | `base app.table.view list`           | `GET`    | `/apps/{app_token}/tables/{table_id}/views`                             |
| 视图             | `base app.table.view patch`          | `PATCH`  | `/apps/{app_token}/tables/{table_id}/views/{view_id}`                   |
| 记录             | `base app.table.record batch_create` | `POST`   | `/apps/{app_token}/tables/{table_id}/records/batch_create`              |
| 记录             | `base app.table.record batch_delete` | `POST`   | `/apps/{app_token}/tables/{table_id}/records/batch_delete`              |
| 记录             | `base app.table.record batch_get`    | `POST`   | `/apps/{app_token}/tables/{table_id}/records/batch_get`                 |
| 记录             | `base app.table.record batch_update` | `POST`   | `/apps/{app_token}/tables/{table_id}/records/batch_update`              |
| 记录             | `base app.table.record create`       | `POST`   | `/apps/{app_token}/tables/{table_id}/records`                           |
| 记录             | `base app.table.record delete`       | `DELETE` | `/apps/{app_token}/tables/{table_id}/records/{record_id}`               |
| 记录             | `base app.table.record get`          | `GET`    | `/apps/{app_token}/tables/{table_id}/records/{record_id}`               |
| 记录             | `base app.table.record list`         | `GET`    | `/apps/{app_token}/tables/{table_id}/records`                           |
| 记录             | `base app.table.record search`       | `POST`   | `/apps/{app_token}/tables/{table_id}/records/search`                    |
| 记录             | `base app.table.record update`       | `PUT`    | `/apps/{app_token}/tables/{table_id}/records/{record_id}`               |
| 字段             | `base app.table.field create`        | `POST`   | `/apps/{app_token}/tables/{table_id}/fields`                            |
| 字段             | `base app.table.field delete`        | `DELETE` | `/apps/{app_token}/tables/{table_id}/fields/{field_id}`                 |
| 字段             | `base app.table.field list`          | `GET`    | `/apps/{app_token}/tables/{table_id}/fields`                            |
| 字段             | `base app.table.field update`        | `PUT`    | `/apps/{app_token}/tables/{table_id}/fields/{field_id}`                 |
| 仪表盘           | `base app.dashboard copy`            | `POST`   | `/apps/{app_token}/dashboards/{block_id}/copy`                          |
| 仪表盘           | `base app.dashboard list`            | `GET`    | `/apps/{app_token}/dashboards`                                          |
| 表单             | `base app.table.form get`            | `GET`    | `/apps/{app_token}/tables/{table_id}/forms/{form_id}`                   |
| 表单             | `base app.table.form patch`          | `PATCH`  | `/apps/{app_token}/tables/{table_id}/forms/{form_id}`                   |
| 表单问题         | `base app.table.form.field list`     | `GET`    | `/apps/{app_token}/tables/{table_id}/forms/{form_id}/fields`            |
| 表单问题         | `base app.table.form.field patch`    | `PATCH`  | `/apps/{app_token}/tables/{table_id}/forms/{form_id}/fields/{field_id}` |
| 高级权限角色     | `base app.role create`               | `POST`   | `/apps/{app_token}/roles`                                               |
| 高级权限角色     | `base app.role delete`               | `DELETE` | `/apps/{app_token}/roles/{role_id}`                                     |
| 高级权限角色     | `base app.role list`                 | `GET`    | `/apps/{app_token}/roles`                                               |
| 高级权限角色     | `base app.role update`               | `PUT`    | `/apps/{app_token}/roles/{role_id}`                                     |
| 高级权限角色成员 | `base app.role.member batch_create`  | `POST`   | `/apps/{app_token}/roles/{role_id}/members/batch_create`                |
| 高级权限角色成员 | `base app.role.member batch_delete`  | `POST`   | `/apps/{app_token}/roles/{role_id}/members/batch_delete`                |
| 高级权限角色成员 | `base app.role.member create`        | `POST`   | `/apps/{app_token}/roles/{role_id}/members`                             |
| 高级权限角色成员 | `base app.role.member delete`        | `DELETE` | `/apps/{app_token}/roles/{role_id}/members/{member_id}`                 |
| 高级权限角色成员 | `base app.role.member list`          | `GET`    | `/apps/{app_token}/roles/{role_id}/members`                             |
| 自动化流程       | `base app.workflow list`             | `GET`    | `/apps/{app_token}/workflows`                                           |
| 自动化流程       | `base app.workflow update`           | `PUT`    | `/apps/{app_token}/workflows/{workflow_id}`                             |

## 验证范围

- 46 个方法和路径均已在海能 UAT 网关核对。CLI 测试覆盖每条原生命令的请求预览和必需路径参数。
- 员工身份实测覆盖 Base 创建与元数据、表、字段、视图、记录列表及单条批量读取、条件查询、仪表盘列表，另在专用测试 Base 上完成新增记录及读回。
- 表单及表单字段的接口通过权限校验，仍需真实表单资源验证返回内容。角色和自动化流程的实际数据查询依赖相应权限。其他写入路径以本地模拟和请求预览为准。
- SDK 中的块工作流列表、创建字段分组和升级表单接口在当前海能租户返回 HTTP 404，因此海能版本的接口目录仅提供已核实的路由。
