# 参与开发

在 Windows 上安装 Node.js 24，然后运行 `npm ci`、`npm run typecheck`、`npm test` 和 `npm run make`。涉及项目数据库结构的修改须增加迁移测试，并确认旧项目能打开。提交问题时请写明 WaterCut 版本、Windows 版本、复现步骤、预期与实际结果；不要附带含私人素材或 API Key 的真实项目。

`npm test` 与 Actions 共用 `vitest.config.mts`：最多 2 个 worker，普通单元测试 5 秒，数据库 / 迁移 / 文件任务 30 秒。耗时报告写入忽略目录 `out/review-unit/report.json`，CI 即使失败也上传此报告。不要靠跳过断言、重试或关闭 SQLite 持久化规避慢测；临时数据库的批量建表 / 降级应使用事务。测试中的异步导入导出使用 `testFileJobs` 传递当前测试的取消信号，`afterEach` 必须先取消并等待任务收尾，再删除临时目录。

提出功能改动前请查阅 [初版方案](./docs/初版方案.md)。当前发布目标和未完成项记录在 [发布清单](./docs/RELEASE_CHECKLIST.md)。
