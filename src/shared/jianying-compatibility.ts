// This records a specific native acceptance run, not a compatibility promise
// for every Jianying release or codec. See docs/剪映11.8实机验收.md.
export const jianyingCompatibility = {
  application: '剪映专业版',
  version: '11.8.0.14778',
  platform: 'Windows x64',
  validatedAt: '2026-11-19',
  scope: '单视频轨直切、PNG 占位、H.264/AAC 原声和 WAV BGM',
} as const;

export const jianyingHandoffInstructions = `WaterCut 剪映专业版草稿交接

已在剪映专业版 ${jianyingCompatibility.version}（${jianyingCompatibility.platform}）验证基础流程。
验证范围：${jianyingCompatibility.scope}。其他版本、编码和复杂效果需另行验证。

打开方法：
1. 在剪映设置中查看“草稿位置”。
2. 在 WaterCut 导出草稿时，直接选择这个本地草稿目录作为输出位置。
3. 刷新或重启剪映，从“本地草稿”打开生成的项目文件夹。

本目录包含已复制的原件、文字占位 PNG、单视频轨与 BGM 轨。
草稿中的素材路径指向本次生成位置；生成后移动文件夹不能保证路径仍然有效。
换电脑请先导入 WaterCut 项目包，再从目标机器重新导出，或在剪映中重新定位素材。
没有原件的镜头使用黑底文字占位图；完整文字保存在分镜清单.csv 和 timeline.json。
不包含特效、转场或正式成片编码。变帧率与分数序列帧率在导出前拒绝。
BGM 淡入淡出时长保留，曲线沿用剪映默认；WaterCut 实时预览使用线性淡变。
此格式不是剪映官方稳定导入协议。不要用旧版 WaterCut 改写剪映保存后的草稿。
`;
