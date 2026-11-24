# v1.3.2 发布清单

## 已准备

- [x] `package.json` 及依赖锁文件中的应用版本为 `1.3.2`；源码包含 WaterCut 的 MIT 许可证，打包配置包含许可资源。
- [x] Windows x64 便携 ZIP 可由 `npm run make` 生成；不再构建此前失败的 Squirrel 安装器。
- [x] 运行依赖许可文本由 `npm run notices` 生成，并随 ZIP 分发；Electron 和 Chromium 的许可文件由 Electron 附带。
- [x] 本地类型检查、100 项自动测试通过；最终包内 19 项流程、18 项卡片 / 退出、14 项阶段 3、27 项 v1.3.1、25 项收纳盒回归全部通过，共 103 项。仓库内旧 `projects/`、`out/`、`node_modules/` 等不提交。
- [x] v1.3.2 ZIP 已核对程序、许可文本、WASM、构建摘要和私人数据排除；当前 SHA-256 见构建产生的 `SHA256SUMS.txt`，旧包校验值不能替代。
- [x] README 含下载、解压、数据位置和功能边界；有隐私说明、贡献说明和问题模板。

## 发出 GitHub 预览版前还要完成

- [x] 构建 `WaterCut-win32-x64-1.3.2.zip`，核对许可文件、个人数据排除和界面版本号，为新包生成 `SHA256SUMS.txt`；包内入口、preload、worker 与 renderer 均已自动验收。
- [ ] 确认 MIT 许可证的版权主体“WaterCut Contributors”符合实际权利归属；如需别的许可证，在提交前替换根目录的 `LICENSE` 与 `package.json` 的 `license`。
- [ ] 在全新 Windows 用户环境，完整解压 ZIP，双击 `WaterCut.exe`；验证无 Node.js、FFmpeg、API Key 时能新建项目、导入素材、保存、关闭和重新打开。
- [ ] 验证旧版 `.watercut` 项目迁移、缺失素材、导入中断、AI 请求失败后原分镜不变；有条件时用自己的 Key 验证一次真实 AI 草案生成与确认。
- [ ] 将代码提交到 Git，配置 GitHub 远程仓库；确认 `git status` 和 `git ls-files` 中没有 `projects/`、密钥、真实素材或私人路径。检查 GitHub Actions 的 Windows 构建为绿色，并下载其 ZIP 复测。
- [ ] 创建指向验收通过的提交的 `v1.3.2` 标签，在 GitHub Release 中标记为 **Pre-release**；上传 `WaterCut-win32-x64-1.3.2.zip` 和其 SHA-256 校验值，明确说明这是免安装预览版。
- [ ] 当前 Windows 构建未签名；发布说明需提示可能出现系统来源警告。若面向更广泛用户，按 Electron 官方指引配置代码签名。

## 后续范围

阶段 3 的快照、项目包和 PDF 已实现，外机实机验收仍待完成。后续继续推进 BGM、精华子片段、专业剪辑时间线和分支版本；见 [阶段 3 验收](../acceptance/阶段3实现与验收.md)。

Release 页面可从 [发布说明](./RELEASE_NOTES-v1.3.2.md) 复制描述。上传从最终验收版本计算的校验值；若改用 GitHub Actions 构建的 ZIP，须对那份 ZIP 重新计算 SHA-256。

## 本地发布命令

```powershell
npm ci
npm run typecheck
npm test
npm run make
npm run smoke -- --packaged
npm run smoke -- --ideas --packaged
npm run smoke -- --stage3 --packaged
npm run smoke -- --patch131 --packaged
npm run smoke -- --boxes --packaged
npm run audit:dist
Get-FileHash out/make/zip/win32/x64/WaterCut-win32-x64-1.3.2.zip -Algorithm SHA256
```

