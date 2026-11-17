# v0.1 发布清单

## 已准备

- [x] `package.json` 版本为 `0.1.0`；源码和分发包包含 WaterCut 的 MIT 许可证。
- [x] Windows x64 便携 ZIP 可由 `npm run make` 生成；不再构建此前失败的 Squirrel 安装器。
- [x] 运行依赖许可文本由 `npm run notices` 生成，并随 ZIP 分发；Electron 和 Chromium 的许可文件由 Electron 附带。
- [x] 本地类型检查、22 项自动测试与 ZIP 构建通过；`projects/`、`out/`、`node_modules/` 等不提交。
- [x] 本地 ZIP 已核对程序、许可文本和私人项目排除情况，并生成 `out/make/zip/win32/x64/SHA256SUMS.txt`。
- [x] README 含下载、解压、数据位置和功能边界；有隐私说明、贡献说明和问题模板。

## 发出 GitHub 预览版前还要完成

- [ ] 确认 MIT 许可证的版权主体“WaterCut Contributors”符合实际权利归属；如需别的许可证，在提交前替换 `LICENSE` 与 `package.json` 的 `license`。
- [ ] 在全新 Windows 用户环境，完整解压 ZIP，双击 `WaterCut.exe`；验证无 Node.js、FFmpeg、API Key 时能新建项目、导入素材、保存、关闭和重新打开。
- [ ] 验证旧版 `.watercut` 项目迁移、缺失素材、导入中断、AI 请求失败后原分镜不变；有条件时用自己的 Key 验证一次真实 AI 草案生成与确认。
- [ ] 将代码提交到 Git，配置 GitHub 远程仓库；确认 `git status` 和 `git ls-files` 中没有 `projects/`、密钥、真实素材或私人路径。检查 GitHub Actions 的 Windows 构建为绿色，并下载其 ZIP 复测。
- [ ] 创建指向验收通过的提交的 `v0.1.0` 标签，在 GitHub Release 中标记为 **Pre-release**；上传 `WaterCut-win32-x64-0.1.0.zip` 和其 SHA-256 校验值，明确说明这是免安装预览版。
- [ ] 当前 Windows 构建未签名；发布说明需提示可能出现系统来源警告。若面向更广泛用户，按 Electron 官方指引配置代码签名。

## 原定首版功能尚未完成

初版方案还列有分镜版本快照、安全恢复、项目包导入导出和跨电脑恢复。当前仅可手动复制整个 `.watercut` 文件夹。若希望 `v0.1.0` 代表原方案的完整首版，应先实现并验收这些功能；若按现有功能发布，应在 Release 页面明确标注预览版范围。

Release 页面可从 [发布说明草稿](./RELEASE_NOTES-v0.1.0.md) 复制描述。上传从最终验收版本计算的校验值；若改用 GitHub Actions 构建的 ZIP，须对那份 ZIP 重新计算 SHA-256。

## 本地发布命令

```powershell
npm ci
npm run typecheck
npm test
npm run make
Get-FileHash out/make/zip/win32/x64/WaterCut-win32-x64-0.1.0.zip -Algorithm SHA256
```
