import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('watercut', {
  onCloseRequest: (callback: () => Promise<boolean>) => {
    const listener = async () => ipcRenderer.send('app:close-ready', await callback());
    ipcRenderer.on('app:close-request', listener);
    return () => ipcRenderer.removeListener('app:close-request', listener);
  },
  createProject: (name: string) => ipcRenderer.invoke('project:create', name),
  getProjectsRoot: () => ipcRenderer.invoke('project:root'),
  openProject: () => ipcRenderer.invoke('project:open'),
  readProject: (directory: string) => ipcRenderer.invoke('project:read', directory),
  renameProject: (directory: string, name: string) => ipcRenderer.invoke('project:rename', directory, name),
  addShot: (directory: string, shot: { description: string; durationMs: number }) => ipcRenderer.invoke('shot:add', directory, shot),
  updateShot: (directory: string, id: string, shot: { description: string; actionDialogue: string; durationMs: number }) => ipcRenderer.invoke('shot:update', directory, id, shot),
  deleteShot: (directory: string, id: string) => ipcRenderer.invoke('shot:delete', directory, id),
  moveShot: (directory: string, id: string, offset: -1 | 1) => ipcRenderer.invoke('shot:move', directory, id, offset),
  addIdea: (directory: string, text: string) => ipcRenderer.invoke('idea:add', directory, text),
  updateIdea: (directory: string, id: string, idea: { text: string; tags: string; notes: string }) => ipcRenderer.invoke('idea:update', directory, id, idea),
  deleteIdea: (directory: string, id: string) => ipcRenderer.invoke('idea:delete', directory, id),
  attachIdeaAsset: (directory: string, assetId: string) => ipcRenderer.invoke('idea:attach', directory, assetId),
  moveIdea: (directory: string, id: string, x: number, y: number) => ipcRenderer.invoke('board:move', directory, id, x, y),
  connectIdeas: (directory: string, source: string, target: string, sourceHandle: string, targetHandle: string) => ipcRenderer.invoke('board:connect', directory, source, target, sourceHandle, targetHandle),
  disconnectIdeas: (directory: string, id: string) => ipcRenderer.invoke('board:disconnect', directory, id),
  getAISettings: () => ipcRenderer.invoke('ai:settings'),
  saveAISettings: (model: string, key: string) => ipcRenderer.invoke('ai:save-settings', model, key),
  clearAIKey: () => ipcRenderer.invoke('ai:clear-key'),
  generateDraft: (directory: string, ideaIds: string[]) => ipcRenderer.invoke('ai:generate', directory, ideaIds),
  appendDraft: (directory: string, shots: { description: string; actionDialogue: string; durationMs: number }[]) => ipcRenderer.invoke('ai:append-draft', directory, shots),
  updateAssetTags: (directory: string, assetId: string, tags: string) => ipcRenderer.invoke('asset:tags', directory, assetId, tags),
  deleteAsset: (directory: string, assetId: string) => ipcRenderer.invoke('asset:delete', directory, assetId),
  importAsset: (directory: string) => ipcRenderer.invoke('asset:import', directory),
  relinkAsset: (directory: string, assetId: string) => ipcRenderer.invoke('asset:relink', directory, assetId),
  cancelImport: () => ipcRenderer.invoke('asset:cancel'),
  onImportProgress: (callback: (progress: { copied: number; total: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: { copied: number; total: number }) => callback(progress);
    ipcRenderer.on('asset:progress', listener);
    return () => ipcRenderer.removeListener('asset:progress', listener);
  },
  onThumbnailReady: (callback: (assetId: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, assetId: string) => callback(assetId);
    ipcRenderer.on('asset:thumbnail-ready', listener);
    return () => ipcRenderer.removeListener('asset:thumbnail-ready', listener);
  },
  linkAsset: (directory: string, shotId: string, assetId: string) => ipcRenderer.invoke('asset:link', directory, shotId, assetId),
  addCandidate: (directory: string, shotId: string, assetId: string) => ipcRenderer.invoke('asset:candidate-add', directory, shotId, assetId),
  removeCandidate: (directory: string, shotId: string, assetId: string) => ipcRenderer.invoke('asset:candidate-remove', directory, shotId, assetId),
  linkAudio: (directory: string, shotId: string, assetId: string) => ipcRenderer.invoke('asset:link-audio', directory, shotId, assetId),
  updateTrim: (directory: string, shotId: string, inMs: number, outMs: number | null) => ipcRenderer.invoke('shot:trim', directory, shotId, inMs, outMs),
});
