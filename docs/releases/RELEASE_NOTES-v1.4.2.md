# WaterCut v1.4.2：Windows CI 修复

2026-11-21。修复 Windows 托管 runner 上新建项目耗时导致的测试超时，以及导出任务尚未结束就删除临时目录的竞态。项目格式 v11、总库 v4 不变，无新增迁移。继续提供免安装 Windows x64 ZIP。

## 依据与处理

GitHub [失败运行 #4](https://github.com/Xavier14-aqua/WaterCut/actions/runs/44561766144) 的真实日志显示 127 项中 79 项因默认 5000 ms 超时失败，另有一项未处理的 `package.partial` 文件 ENOENT。类型检查通过，打包、原生回归和审计未执行。原 v1.4.1 Release 与标签保留，不把其旧失败运行重写为成功。

- 新建项目的完整建表、字段升级、变更触发器和初始记录统一放入 `BEGIN IMMEDIATE` / `COMMIT`。失败则回滚、关闭连接，仅移除本次新建目录；已有项目保留。继续使用 SQLite 默认持久化，没有禁用同步或日志。
- 旧格式测试样本的批量删表、删字段和触发器降级也放入事务，减少重复磁盘提交。
- 本地和 CI 共用 Vitest 配置，最多 2 个 worker。纯单元测试仍为 5 秒；数据库 / 迁移 / 文件测试及清理钩子为 30 秒。保留所有断言，新增 JSON 耗时报告，失败时也上传到 Actions。
- 导入 / 导出测试显式跟踪任务，将 Vitest 超时信号传给真实 I/O。清理顺序为取消 → 等待完整任务（含 finally）结束 → 删除临时目录。
- ZIP 写入在打开目标前验证全部源条目；输出流创建、ZIP 初始化、源流错误和取消共用异常处理。返回失败前等待输出和源句柄关闭，防止后台异常。
- 新增初始化失败 / 回滚及 6 个 ZIP 故障回归用例；测试配置也纳入构建指纹。
- 原生回归启动器使用 Electron 包自身的可执行路径解析 / 初始化入口，避免干净的 CI 环境尚无 `node_modules/electron/dist/electron.exe` 时直接 ENOENT。该问题在测试和打包首次通过后才执行到，已由 [修复中间运行](https://github.com/Xavier14-aqua/WaterCut/actions/runs/44901598510) 的实际日志确认。

## 本机证据

同机、同版本 Node.js、10 个全新临时项目：初始化中位耗时从约 **195.7 ms 降至 8.6 ms**，约减少 95.6%。这是本机独立计时，不当作云端耗时预测。

134 项测试和类型检查通过。另用独立探针故意触发 100 ms 超时：观察到 `I/O settled → jobs drained → fixture removed`，源 / 目标句柄已关闭，未出现 ENOENT 或未处理异常。该预期失败探针只留在忽略目录，不进入正式测试集合或分发包。

最终本机便携包的 150 项原生断言和分发审计全部通过。剪映 11.8 的 v1.4.1 实机记录保留为其对应版本的历史证据，本次未扩大软件兼容范围。

## GitHub 完整验收通过

[成功运行](https://github.com/Xavier14-aqua/WaterCut/actions/runs/44901915741)，对应代码提交 `50a03c2fd08758127ca13d1661d9d4e0669cb3d5`。

- 干净的 Windows runner 完成依赖安装、类型检查、**134/134** 测试，测试步骤报告耗时 **36.17 秒**；原失败运行的测试耗时为 381.71 秒且未通过。
- 便携打包、6 组原生回归 **19 + 18 + 14 + 27 + 25 + 47 = 150** 项断言、分发审计和产物上传全部通过。
- 审计确认 ZIP 与已测试程序一致，WASM / 许可 / 源码树指纹核对通过，私人数据路径为 0。
- [Windows 产物](https://github.com/Xavier14-aqua/WaterCut/actions/runs/44901915741/artifacts/14705604243) 包含程序 ZIP、对应 SHA256SUMS 与 build-info；[测试耗时报告](https://github.com/Xavier14-aqua/WaterCut/actions/runs/44901915741/artifacts/14706042845) 单独保留。

云端程序 ZIP `WaterCut-win32-x64-1.4.2.zip` 为 **159,610,261 字节**。这是解开 Actions 外层产物后，内层程序 ZIP 的校验值：

```text
SHA-256 e4e3dd9c03c10477388b44e6eda45b57bbc7bfd730603fd05f72a79ece169c1b
```

本机同源便携包在 `out/ci-fix/make/zip/win32/x64/`，为 159,610,229 字节。构建环境、时间和构建记录不同，两份包的字节摘要分别保存：

```text
本机 ZIP SHA-256 3940cee0762504edbace7bc770ba465e61bd0272b21f1d803e20d45b2442c27b
本机 sourceTreeSha256 78d8ec8ade447d9b1fabdfcbfe2c956756fb4ac1d3e28a58698d6108fbe128bc
```

原 v1.4.1 Release 与标签保持原状；本次已推送 v1.4.2 修复源码和通过的 Actions 产物，未另建 GitHub Release。后续补记本页的提交仅更新文档，不改变上述已验证代码。
