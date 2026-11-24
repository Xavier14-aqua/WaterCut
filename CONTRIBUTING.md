# 参与开发

先阅读 [架构与学习入口](./docs/architecture/README.md) 和 [功能定位表](./docs/architecture/模块与功能定位.md)，再按 [开发与验证说明](./docs/development/README.md) 安装锁定依赖并运行检查。

提交前执行 `npm run check`、`npm test`；涉及入口、文件路径或交付的改动，还应构建便携包并执行对应原生场景与分发审计。每批改动说明职责、行为影响及验证；格式整理和逻辑修改分开提交。

数据库结构变化需要迁移测试及旧项目兼容验证。多表编辑共享事务，跨库同步保留恢复机制；异步任务先取消并等待收尾，再清理临时目录。不要用跳过断言、失败重试或关闭 SQLite 持久化掩盖问题。

产品范围见 [初版方案](./docs/product/初版方案.md)，当前验收见 [发布清单](./docs/releases/RELEASE_CHECKLIST.md)。反馈问题请附版本、Windows 版本、复现步骤及预期结果，不附私人素材或 API Key。
