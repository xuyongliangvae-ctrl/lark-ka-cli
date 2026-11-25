# Drive 文件整理工作流

先阅读 [认证和权限规则](../../lark-shared/SKILL.md)。本流程只使用命令清单内的 Drive、文档和表格能力。

1. 确定 Drive 文件夹或搜索范围。使用 `drive files list`、`drive +search` 和 `drive +inspect` 盘点资源，并记录文件类型、真实 token、当前目录及标题。列表存在续页时继续获取，不能把单页当完整清单。
2. 需要理解内容时，通过 `docs +fetch`、电子表格或多维表格对应技能读取内容。先生成可审阅的分类和目标目录方案。
3. 用户明确确认执行范围后，用 `drive +create-folder` 创建目标目录，用 `drive +move` 调整位置。执行前记录原目录和实际创建的文件夹 token。
4. 用 `drive files list` 和 `drive +inspect` 读回核对。异步任务按 `drive +task_result` 的帮助继续查询。
5. 执行失败或用户要求恢复时，先展示已发生的移动及原目录；确认后用 `drive +move` 恢复。仅在用户确认后清理本次新建且已核实为空的文件夹。

Wiki 节点、知识空间管理不在本包的命令范围内。此流程不修改共享范围、协作者、所有者或密级；用户需要此类操作时，单独核对对应权限命令和影响范围。

参考 [列文件](lark-drive-files-list.md)、[搜索](lark-drive-search.md)、[检查资源](lark-drive-inspect.md)、[移动](lark-drive-move.md)。
