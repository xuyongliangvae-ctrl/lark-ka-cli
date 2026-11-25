# CLI 保留命令清单

当前包仅提供需求清单第 90 版列出的命令。共 304 条清单记录；`--help`、`--version` 和 `--expect-version` 同时作为全局选项保留。

本清单描述保留范围。接口实际可用性仍由部署环境、应用权限、员工授权和资源权限决定。

## auth（9）

| 命令                  |
| --------------------- |
| `auth login`          |
| `auth status`         |
| `auth whoami`         |
| `auth scopes`         |
| `auth check`          |
| `auth list`           |
| `auth logout`         |
| `auth qrcode`         |
| `auth _server-bridge` |

## config（9）

| 命令                        |
| --------------------------- |
| `config init`               |
| `config bind`               |
| `config show`               |
| `config remove`             |
| `config default-as`         |
| `config strict-mode`        |
| `config plugins show`       |
| `config policy show`        |
| `config keychain-downgrade` |

## profile（5）

| 命令             |
| ---------------- |
| `profile add`    |
| `profile list`   |
| `profile use`    |
| `profile rename` |
| `profile remove` |

## doctor（1）

| 命令     |
| -------- |
| `doctor` |

## skills（2）

| 命令          |
| ------------- |
| `skills list` |
| `skills read` |

## schema（1）

| 命令     |
| -------- |
| `schema` |

## api（1）

| 命令  |
| ----- |
| `api` |

## update（1）

| 命令     |
| -------- |
| `update` |

## completion（4）

| 命令                    |
| ----------------------- |
| `completion bash`       |
| `completion zsh`        |
| `completion fish`       |
| `completion powershell` |

## \_\_complete（1）

| 命令         |
| ------------ |
| `__complete` |

## \_\_completeNoDesc（1）

| 命令               |
| ------------------ |
| `__completeNoDesc` |

## help（1）

| 命令   |
| ------ |
| `help` |

## mcp（1）

| 命令        |
| ----------- |
| `mcp serve` |

## docs（9）

| 命令                      |
| ------------------------- |
| `docs +create`            |
| `docs +fetch`             |
| `docs +media-download`    |
| `docs +media-insert`      |
| `docs +media-preview`     |
| `docs +media-upload`      |
| `docs +search`            |
| `docs +update`            |
| `docs +whiteboard-update` |

## drive（51）

| 命令                                                 |
| ---------------------------------------------------- |
| `drive +create-folder`                               |
| `drive +create-shortcut`                             |
| `drive +delete`                                      |
| `drive +inspect`                                     |
| `drive +move`                                        |
| `drive +search`                                      |
| `drive +download`                                    |
| `drive +export`                                      |
| `drive +export-download`                             |
| `drive +import`                                      |
| `drive +task_result`                                 |
| `drive +upload`                                      |
| `drive +pull`                                        |
| `drive +push`                                        |
| `drive +status`                                      |
| `drive +sync`                                        |
| `drive +cover`                                       |
| `drive +preview`                                     |
| `drive +add-comment`                                 |
| `drive +apply-permission`                            |
| `drive +secure-label-list`                           |
| `drive +secure-label-update`                         |
| `drive +version-delete`                              |
| `drive +version-get`                                 |
| `drive +version-history`                             |
| `drive +version-revert`                              |
| `drive files copy`                                   |
| `drive files create_folder`                          |
| `drive files list`                                   |
| `drive files patch`                                  |
| `drive metas batch_query`                            |
| `drive file.comment.reply.reactions update_reaction` |
| `drive file.comment.replys create`                   |
| `drive file.comment.replys delete`                   |
| `drive file.comment.replys list`                     |
| `drive file.comment.replys update`                   |
| `drive file.comments batch_query`                    |
| `drive file.comments create_v2`                      |
| `drive file.comments list`                           |
| `drive file.comments patch`                          |
| `drive permission.members auth`                      |
| `drive permission.members create`                    |
| `drive permission.members transfer_owner`            |
| `drive permission.public get`                        |
| `drive permission.public patch`                      |
| `drive file.statistics get`                          |
| `drive file.view_records list`                       |
| `drive quota_details get`                            |
| `drive user remove_subscription`                     |
| `drive user subscription`                            |
| `drive user subscription_status`                     |

## markdown（5）

| 命令                  |
| --------------------- |
| `markdown +create`    |
| `markdown +diff`      |
| `markdown +fetch`     |
| `markdown +overwrite` |
| `markdown +patch`     |

## base（64）

| 命令                                 |
| ------------------------------------ |
| `base +base-copy`                    |
| `base +base-create`                  |
| `base +base-get`                     |
| `base +table-create`                 |
| `base +table-get`                    |
| `base +table-list`                   |
| `base +field-get`                    |
| `base +field-list`                   |
| `base +record-batch-create`          |
| `base +record-batch-update`          |
| `base +record-delete`                |
| `base +record-get`                   |
| `base +record-list`                  |
| `base +record-search`                |
| `base +view-get`                     |
| `base +view-list`                    |
| `base +form-get`                     |
| `base +dashboard-list`               |
| `base app copy`                      |
| `base app create`                    |
| `base app get`                       |
| `base app update`                    |
| `base app.table batch_create`        |
| `base app.table batch_delete`        |
| `base app.table create`              |
| `base app.table delete`              |
| `base app.table list`                |
| `base app.table patch`               |
| `base app.table.field create`        |
| `base app.table.field delete`        |
| `base app.table.field list`          |
| `base app.table.field update`        |
| `base app.table.record batch_create` |
| `base app.table.record batch_delete` |
| `base app.table.record batch_get`    |
| `base app.table.record batch_update` |
| `base app.table.record create`       |
| `base app.table.record delete`       |
| `base app.table.record get`          |
| `base app.table.record list`         |
| `base app.table.record search`       |
| `base app.table.record update`       |
| `base app.table.view create`         |
| `base app.table.view delete`         |
| `base app.table.view get`            |
| `base app.table.view list`           |
| `base app.table.view patch`          |
| `base app.table.form get`            |
| `base app.table.form patch`          |
| `base app.table.form.field list`     |
| `base app.table.form.field patch`    |
| `base app.dashboard copy`            |
| `base app.dashboard list`            |
| `base app.role create`               |
| `base app.role delete`               |
| `base app.role list`                 |
| `base app.role update`               |
| `base app.role.member batch_create`  |
| `base app.role.member batch_delete`  |
| `base app.role.member create`        |
| `base app.role.member delete`        |
| `base app.role.member list`          |
| `base app.workflow list`             |
| `base app.workflow update`           |

## sheets（122）

| 命令                                      |
| ----------------------------------------- |
| `sheets +create`                          |
| `sheets +export`                          |
| `sheets +info`                            |
| `sheets +workbook-create`                 |
| `sheets +workbook-export`                 |
| `sheets +workbook-info`                   |
| `sheets +copy-sheet`                      |
| `sheets +create-sheet`                    |
| `sheets +delete-sheet`                    |
| `sheets +sheet-copy`                      |
| `sheets +sheet-create`                    |
| `sheets +sheet-delete`                    |
| `sheets +sheet-hide`                      |
| `sheets +sheet-info`                      |
| `sheets +sheet-move`                      |
| `sheets +sheet-rename`                    |
| `sheets +sheet-set-tab-color`             |
| `sheets +sheet-unhide`                    |
| `sheets +update-sheet`                    |
| `sheets +append`                          |
| `sheets +batch-set-style`                 |
| `sheets +batch-update`                    |
| `sheets +cells-batch-clear`               |
| `sheets +cells-batch-set-style`           |
| `sheets +cells-clear`                     |
| `sheets +cells-get`                       |
| `sheets +cells-merge`                     |
| `sheets +cells-replace`                   |
| `sheets +cells-search`                    |
| `sheets +cells-set`                       |
| `sheets +cells-set-image`                 |
| `sheets +cells-set-style`                 |
| `sheets +cells-unmerge`                   |
| `sheets +csv-get`                         |
| `sheets +csv-put`                         |
| `sheets +find`                            |
| `sheets +merge-cells`                     |
| `sheets +range-copy`                      |
| `sheets +range-fill`                      |
| `sheets +range-move`                      |
| `sheets +range-sort`                      |
| `sheets +read`                            |
| `sheets +replace`                         |
| `sheets +set-style`                       |
| `sheets +unmerge-cells`                   |
| `sheets +write`                           |
| `sheets +write-image`                     |
| `sheets +add-dimension`                   |
| `sheets +cols-resize`                     |
| `sheets +delete-dimension`                |
| `sheets +dim-delete`                      |
| `sheets +dim-freeze`                      |
| `sheets +dim-group`                       |
| `sheets +dim-hide`                        |
| `sheets +dim-insert`                      |
| `sheets +dim-move`                        |
| `sheets +dim-ungroup`                     |
| `sheets +dim-unhide`                      |
| `sheets +insert-dimension`                |
| `sheets +move-dimension`                  |
| `sheets +rows-resize`                     |
| `sheets +update-dimension`                |
| `sheets +cond-format-create`              |
| `sheets +cond-format-delete`              |
| `sheets +cond-format-list`                |
| `sheets +cond-format-update`              |
| `sheets +create-filter-view`              |
| `sheets +create-filter-view-condition`    |
| `sheets +delete-dropdown`                 |
| `sheets +delete-filter-view`              |
| `sheets +delete-filter-view-condition`    |
| `sheets +dropdown-delete`                 |
| `sheets +dropdown-get`                    |
| `sheets +dropdown-set`                    |
| `sheets +dropdown-update`                 |
| `sheets +filter-create`                   |
| `sheets +filter-delete`                   |
| `sheets +filter-list`                     |
| `sheets +filter-update`                   |
| `sheets +filter-view-create`              |
| `sheets +filter-view-delete`              |
| `sheets +filter-view-list`                |
| `sheets +filter-view-update`              |
| `sheets +get-dropdown`                    |
| `sheets +get-filter-view`                 |
| `sheets +get-filter-view-condition`       |
| `sheets +list-filter-view-conditions`     |
| `sheets +list-filter-views`               |
| `sheets +set-dropdown`                    |
| `sheets +update-dropdown`                 |
| `sheets +update-filter-view`              |
| `sheets +update-filter-view-condition`    |
| `sheets +create-float-image`              |
| `sheets +delete-float-image`              |
| `sheets +float-image-create`              |
| `sheets +float-image-delete`              |
| `sheets +float-image-list`                |
| `sheets +float-image-update`              |
| `sheets +get-float-image`                 |
| `sheets +list-float-images`               |
| `sheets +media-upload`                    |
| `sheets +update-float-image`              |
| `sheets +chart-create`                    |
| `sheets +chart-delete`                    |
| `sheets +chart-list`                      |
| `sheets +chart-update`                    |
| `sheets +pivot-create`                    |
| `sheets +pivot-delete`                    |
| `sheets +pivot-list`                      |
| `sheets +pivot-update`                    |
| `sheets +sparkline-create`                |
| `sheets +sparkline-delete`                |
| `sheets +sparkline-list`                  |
| `sheets +sparkline-update`                |
| `sheets spreadsheets create`              |
| `sheets spreadsheets get`                 |
| `sheets spreadsheets patch`               |
| `sheets spreadsheet.sheets find`          |
| `sheets spreadsheet.sheet.filters create` |
| `sheets spreadsheet.sheet.filters delete` |
| `sheets spreadsheet.sheet.filters get`    |
| `sheets spreadsheet.sheet.filters update` |

## slides（14）

| 命令                                            |
| ----------------------------------------------- |
| `slides +create`                                |
| `slides +media-upload`                          |
| `slides +replace-slide`                         |
| `slides xml_presentation.history list`          |
| `slides xml_presentation.history revert`        |
| `slides xml_presentation.history revert_status` |
| `slides xml_presentation.slide create`          |
| `slides xml_presentation.slide delete`          |
| `slides xml_presentation.slide get`             |
| `slides xml_presentation.slide replace`         |
| `slides xml_presentation.slide_image list`      |
| `slides xml_presentation.slide_image render`    |
| `slides xml_presentations create`               |
| `slides xml_presentations get`                  |

## whiteboard（2）

| 命令                 |
| -------------------- |
| `whiteboard +query`  |
| `whiteboard +update` |
