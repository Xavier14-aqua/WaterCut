# WaterCut 开发与验证

开发环境使用 Node.js 24，应用运行依赖以锁文件为准。先安装依赖，再执行静态检查和测试：

```powershell
npm ci
npm run check
npm test
npm run make
```

`check` 包含格式、零警告、架构、源码不变量和类型检查。格式工具只处理代码、配置和当前架构说明；不重写剪映参考模板和 base64 合成素材。

单元测试与集成测试使用相同并发配置：最多 2 个 worker，纯单元测试 5 秒，存储 / 迁移 / 文件任务 30 秒。搬动测试后必须核对收集到的用例和分组，不能以跳过断言或增加重试消除失败。接口反例在 `tests/contracts`，由类型检查验证。

## 原生功能场景

| 参数 | 检查内容 | 报告目录 |
|---|---|---|
| `--scenario=core` | 基础创作、保存、时间线 | `out/review-core` |
| `--scenario=inspiration` | 卡片、错误恢复、退出保存 | `out/review-inspiration` |
| `--scenario=delivery` | 快照、探测、项目包和 PDF | `out/review-delivery` |
| `--scenario=editor` | 总库范围、颜色、脚本分组、主画面 | `out/review-editor` |
| `--scenario=organization` | 两类库的收纳、筛选、持久化 | `out/review-organization` |
| `--scenario=professional` | 精华、BGM、清单、AI 确认、剪映交接 | `out/review-professional` |
| `--scenario=interface` | 六个参考页面、详情、总库和存储在 1440 / 1280 / 1000 下的布局、对比与焦点 | `out/review-interface` |

例如：`npm run smoke -- --scenario=editor --packaged`。旧参数 `--ideas`、`--stage3`、`--patch131`、`--boxes`、`--stage4a` 继续作为兼容别名；新脚本按功能命名。

界面验收使用官方生成示例和两个临时项目，捕获 27 张程序截图。截图前等待图片解码与有限的 CSS 过渡完成，并核对当前流程、横向溢出、可见操作、代表性文字对比和键盘焦点。失败现场保留供排查；启动器只接受本次运行新写出的报告，避免把旧结果当成新验收。

额外 BGM 检查使用 `--scenario=professional --bgm-only --packaged`，依次在独立进程中运行 `WATERCUT_BGM_SCENARIO` 为 `normal`、`suspend-during-load`、`paused-video-position` 的三种场景。完整专业流程及这三个额外场景均保留原有同步断言，失败时保存有界状态轨迹。

## 自定义构建输出

`WATERCUT_BUILD_OUT` 指定构建与审计的目录；原生脚本通过 `--out=同一目录` 找到程序。未设置时都使用 `out`。报告仍写入上表的目录。

运行 `npm run audit:dist` 核对 ZIP 与包内运行文件、版本、WASM、许可、源树指纹和私人数据排除。源树指纹包括源码、开发脚本、测试和构建 / 检查配置，由构建与审计共用同一个计算函数。

所有自动验证使用独立临时项目和合成素材。失败时先保存报告，确认异步任务完全退出后再清理，不能删除真实项目来重置测试。
