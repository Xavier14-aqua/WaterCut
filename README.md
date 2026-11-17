# WaterCut

本地优先的视频创作工作台。当前 v0.1 预览版实现项目管理、灵感箱、素材库、灵感白板、可编辑 AI 分镜草案和顺序粗剪。功能范围见 [初版方案.md](./初版方案.md)，开发进展见 [实现日志.md](./实现日志.md)，人工测试步骤见 [验收清单-迭代2.md](./验收清单-迭代2.md)。

## 下载和使用

从 GitHub Release 下载 Windows x64 ZIP，**完整解压**后运行 `WaterCut.exe`。这是免安装包，没有自动更新；无需安装 Node.js 或系统 FFmpeg。当前构建未签名，Windows 可能提示应用来源警告。初次运行不需要 AI Key。AI 草案需用户自行设置 OpenAI API Key 与模型 ID，并能访问 OpenAI API。

从仓库目录中的 `out/` 运行时，项目和导入素材位于 `projects/<项目ID>.watercut/`；从仓库外运行 ZIP 时，项目默认位于用户“文档/WaterCut Projects”。项目内 `assets/` 保存导入素材的副本，原始文件不受影响。可在新建项目页查看实际保存位置。不要把自己的 `projects/` 文件夹上传到 GitHub。

当前预览版尚无版本快照、项目包导入导出和正式成片导出。跨电脑迁移时需手动复制整个 `.watercut` 项目文件夹。更多数据处理说明见 [隐私说明](./PRIVACY.md)。

## 开发

需要 Node.js 24、npm 和 Windows。当前功能使用 Electron 自带媒体能力，不调用系统 FFmpeg/ffprobe。项目依赖安装后运行：

```powershell
npm ci
npm run typecheck
npm test
npm start
```

`npm run package` 生成未压缩的运行目录；`npm run make` 生成 `out/make/zip/win32/x64/WaterCut-win32-x64-0.1.0.zip`。v0.1 仅提供便携 ZIP，暂不提供安装器。源码采用 [MIT 许可证](./LICENSE)；应用包内附带 WaterCut、运行依赖及 Electron/Chromium 的许可文本。发布步骤与剩余验收项见 [发布清单](./RELEASE_CHECKLIST.md)。

每个 `.watercut` 文件夹含 `project.sqlite`、`assets/` 和可重建的 `thumbnails/`。`projects/` 已加入 `.gitignore`，避免把个人素材提交到 GitHub。最近项目、界面内重命名、镜头与灵感编辑自动保存均已提供；保存失败时保留当前编辑并显示重试入口。正常关闭窗口时会等待未完成的保存操作。灵感卡片和素材卡片可在二次确认后删除；删除素材会移除项目内副本和关联，不影响导入前的原始文件。

素材导入会流式复制原件到项目的 `assets/`，界面显示进度并可取消；取消或复制失败时清理未完成文件。可按文件名和标签搜索，查看缩略图，重新定位缺失素材。一个镜头可存多个候选画面并选择一个主画面，也可关联参考音频；音频可以单独播放，但不参与连续粗剪。图片按镜头时长展示；视频可设置入点和出点，出点留空则播至片尾；无素材镜头显示文字占位。视频裁剪使用浏览器播放事件，适合粗剪节奏预览，不保证逐帧精度。

灵感白板使用 React Flow；卡片坐标、连线和两端连接点保存在项目数据库中，四边连接点可相互连接，删除灵感时同步删除相关连线。项目格式为 v7，旧项目迁移前会备份数据库。AI 草案使用 OpenAI Responses API：用户在本机设置模型 ID 和 API Key，密钥由 Electron `safeStorage` 加密后存放在应用用户数据目录，不写入项目、日志或导出内容。只有用户主动点击生成时，选中的灵感文字、标签和备注才会发送到 API。生成结果经格式校验后留在界面中编辑；确认加入时一次性写入分镜。没有密钥时，白板和手工创作照常使用。API 调用可能产生费用，具体以用户所选模型的服务条款为准。
