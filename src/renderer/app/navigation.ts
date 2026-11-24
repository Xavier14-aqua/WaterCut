export type View = 'board' | 'script' | 'storyboard' | 'preview' | 'checklist';

export const views: Record<View, string> = {
  board: '白板',
  script: '脚本',
  storyboard: '分镜',
  preview: '粗剪',
  checklist: '清单',
};
