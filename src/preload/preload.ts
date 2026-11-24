import type { WaterCutAPI } from '../contracts/api';
import { contextBridge, ipcRenderer } from 'electron';
const localEchoes=(input:unknown)=>ipcRenderer.invoke('library:echoes',input);
const api: WaterCutAPI = {
  localEchoes,
  listAIProposals:(directory:string)=>ipcRenderer.invoke('ai:proposals',directory),
  deleteAIProposal:(directory:string,id:string)=>ipcRenderer.invoke('ai:proposal-delete',directory,id),
  applyAIProposal:(directory:string,id:string,input:unknown)=>ipcRenderer.invoke('ai:proposal-apply',directory,id,input),
  generateSuggestions:(directory:string,input:unknown,requestId:string)=>ipcRenderer.invoke('ai:suggest',directory,input,requestId),
  cancelAIRequest:(requestId:string)=>ipcRenderer.invoke('ai:cancel',requestId),
  saveAudioClip:(directory:string,input:unknown)=>ipcRenderer.invoke('audio:save',directory,input),
  deleteAudioClip:(directory:string,id:string)=>ipcRenderer.invoke('audio:delete',directory,id),
  saveTimelineSettings:(directory:string,input:unknown)=>ipcRenderer.invoke('timeline:settings',directory,input),
  listAssetSelects:(assetId:string)=>ipcRenderer.invoke('select:list',assetId),
  saveAssetSelect:(input:unknown)=>ipcRenderer.invoke('select:save',input),
  hideAssetSelect:(id:string)=>ipcRenderer.invoke('select:hide',id),
  bindSelect:(directory:string,shotId:string,selectId:string)=>ipcRenderer.invoke('select:bind',directory,shotId,selectId),
  saveIdeaBox: (directory: string, input: unknown) => ipcRenderer.invoke('idea-box:save', directory, input),
  deleteIdeaBox: (directory: string, id: string) => ipcRenderer.invoke('idea-box:delete', directory, id),
  moveIdeasToBox: (directory: string, ids: string[], boxId: string | null) => ipcRenderer.invoke('idea-box:move', directory, ids, boxId),
  saveLibraryIdeaBox: (input: unknown) => ipcRenderer.invoke('library:box-save', input),
  deleteLibraryIdeaBox: (id: string) => ipcRenderer.invoke('library:box-delete', id),
  moveLibraryIdeasToBox: (ids: string[], boxId: string | null) => ipcRenderer.invoke('library:box-move', ids, boxId),
  createScriptSection: (directory: string, input: unknown) => ipcRenderer.invoke('script:section', directory, input),
  addScriptParagraph: (directory: string, sectionId: string | null) => ipcRenderer.invoke('script:paragraph', directory, sectionId),
  reorderScriptBlocks: (directory: string, ids: string[]) => ipcRenderer.invoke('script:reorder', directory, ids),
  addShotSource: (directory: string, shotId: string, ideaId: string) => ipcRenderer.invoke('shot:source-add', directory, shotId, ideaId),
  removeShotSource: (directory: string, shotId: string, sourceId: string) => ipcRenderer.invoke('shot:source-remove', directory, shotId, sourceId),
  clearShotPrimary: (directory: string, shotId: string) => ipcRenderer.invoke('shot:clear-primary', directory, shotId),
  listRevisions: (directory: string) => ipcRenderer.invoke('revision:list', directory),
  createRevision: (directory: string, name: string) => ipcRenderer.invoke('revision:create', directory, name),
  deleteRevision: (directory: string, id: string) => ipcRenderer.invoke('revision:delete', directory, id),
  restoreRevision: (directory: string, id: string) => ipcRenderer.invoke('revision:restore', directory, id),
  exportProjectPackage: (directory: string, options: unknown) => ipcRenderer.invoke('project:export-package', directory, options),
  importProjectPackage: () => ipcRenderer.invoke('project:import-package'),
  probeProject: (directory: string) => ipcRenderer.invoke('media:probe-project', directory),
  probeLibraryAsset: (id: string) => ipcRenderer.invoke('media:probe-library', id),
  exportStoryboardPDF: (directory: string, options: unknown) => ipcRenderer.invoke('export:storyboard-pdf', directory, options),
  reportUIError: (error: {
    scope: 'app' | 'inspector';
    message: string;
    stack: string;
  }) => ipcRenderer.send('app:ui-error', error),
  requestClose: () => ipcRenderer.send('app:request-close'),
  getStorageSettings: () => ipcRenderer.invoke('settings:get'),
  getPalette: (token: string) => ipcRenderer.invoke('media:palette', token),
  chooseStorageRoot: (kind: string) => ipcRenderer.invoke('settings:choose-root', kind),
  readLibrary: (query: unknown = {}) => ipcRenderer.invoke('library:read', query),
  saveLibraryIdea: (input: unknown) => ipcRenderer.invoke('library:save-idea', input),
  getLibraryIdea: (id: string) => ipcRenderer.invoke('library:get-idea', id),
  getLibraryAsset: (id: string) => ipcRenderer.invoke('library:get-asset', id),
  relatedIdeas: (id: string) => ipcRenderer.invoke('library:related', id),
  libraryUsage: (id: string,range?:unknown) => ipcRenderer.invoke('library:usage', id,range),
  hideLibraryItem: (kind: string, id: string, hidden: boolean) => ipcRenderer.invoke('library:hide', kind, id, hidden),
  updateLibraryAsset: (id: string, input: unknown) => ipcRenderer.invoke('library:asset-update', id, input),
  connectLibraryIdeas: (source: string, target: string, kind: string, note: string) => ipcRenderer.invoke('library:connect', source, target, kind, note),
  disconnectLibraryIdeas: (id: string) => ipcRenderer.invoke('library:disconnect', id),
  reconcileLibrary: () => ipcRenderer.invoke('library:reconcile'),
  importLibraryAssets: () => ipcRenderer.invoke('library:import'),
  relinkLibraryAsset: (id: string) => ipcRenderer.invoke('library:relink', id),
  attachLibraryAssets: (directory: string, ids: string[]) => ipcRenderer.invoke('project:attach-assets', directory, ids),
  attachLibraryIdeas: (directory: string, ids: string[], copy = false) => ipcRenderer.invoke('project:attach-ideas', directory, ids, copy),
  refreshLibraryIdea: (directory: string, id: string) => ipcRenderer.invoke('project:refresh-idea', directory, id),
  promoteProject: (directory: string) => ipcRenderer.invoke('project:promote', directory),
  createExample: () => ipcRenderer.invoke('project:example'),
  archiveProject: (directory: string, archived: boolean) => ipcRenderer.invoke('project:archive', directory, archived),
  createIdea: (directory: string, input: unknown) => ipcRenderer.invoke('idea:create', directory, input),
  updateEdgeLabel: (directory: string, id: string, label: string) => ipcRenderer.invoke('board:label', directory, id, label),
  updateShotMetadata: (directory: string, id: string, input: unknown) => ipcRenderer.invoke('shot:metadata', directory, id, input),
  reorderShots: (directory: string, ids: string[]) => ipcRenderer.invoke('shot:reorder', directory, ids),
  createShotsFromIdeas: (directory: string, ids: string[], commandId: string, draft?: unknown) => ipcRenderer.invoke('shot:from-ideas', directory, ids, commandId, draft),
  saveScriptBlock: (directory: string, input: unknown) => ipcRenderer.invoke('script:save', directory, input),
  convertScriptBlocks: (directory: string, ids: string[], commandId: string) => ipcRenderer.invoke('script:convert', directory, ids, commandId),
  deleteScriptBlock: (directory: string, id: string) => ipcRenderer.invoke('script:delete', directory, id),
  splitScriptBlock: (directory: string, id: string, offset: number) => ipcRenderer.invoke('script:split', directory, id, offset),
  mergeScriptBlocks: (directory: string, first: string, second: string) => ipcRenderer.invoke('script:merge', directory, first, second),
  updateAssetDuration: (directory: string, id: string, durationMs: number) => ipcRenderer.invoke('asset:duration', directory, id, durationMs),
  exportJianying:(directory:string,input:unknown)=>ipcRenderer.invoke('export:jianying',directory,input),
  exportShotList: (directory: string,filter?:unknown) => ipcRenderer.invoke('export:shot-list', directory,filter),
  onCloseRequest: (callback: () => Promise<boolean>) => {
    const listener = async (_event: Electron.IpcRendererEvent, requestId: number) => {
      let saved = false;
      try {
        saved = await callback();
      } catch {/* A failed callback must still acknowledge the close request. */} finally {
        ipcRenderer.send('app:close-ready', requestId, saved);
      }
    };
    ipcRenderer.on('app:close-request', listener);
    return () => ipcRenderer.removeListener('app:close-request', listener);
  },
  createProject: (name: string) => ipcRenderer.invoke('project:create', name),
  getProjectsRoot: () => ipcRenderer.invoke('project:root'),
  openProject: () => ipcRenderer.invoke('project:open'),
  readProject: (directory: string) => ipcRenderer.invoke('project:read', directory),
  renameProject: (directory: string, name: string) => ipcRenderer.invoke('project:rename', directory, name),
  addShot: (directory: string, shot: {
    description: string;
    durationMs: number;
  }) => ipcRenderer.invoke('shot:add', directory, shot),
  updateShot: (directory: string, id: string, shot: {
    description: string;
    actionDialogue: string;
    durationMs: number;
  }) => ipcRenderer.invoke('shot:update', directory, id, shot),
  deleteShot: (directory: string, id: string) => ipcRenderer.invoke('shot:delete', directory, id),
  moveShot: (directory: string, id: string, offset: -1 | 1) => ipcRenderer.invoke('shot:move', directory, id, offset),
  addIdea: (directory: string, text: string) => ipcRenderer.invoke('idea:add', directory, text),
  updateIdea: (directory: string, id: string, idea: {
    text: string;
    tags: string;
    notes: string;
  }) => ipcRenderer.invoke('idea:update', directory, id, idea),
  deleteIdea: (directory: string, id: string) => ipcRenderer.invoke('idea:delete', directory, id),
  attachIdeaAsset: (directory: string, assetId: string) => ipcRenderer.invoke('idea:attach', directory, assetId),
  moveIdea: (directory: string, id: string, x: number, y: number) => ipcRenderer.invoke('board:move', directory, id, x, y),
  connectIdeas: (directory: string, source: string, target: string, sourceHandle: string, targetHandle: string) => ipcRenderer.invoke('board:connect', directory, source, target, sourceHandle, targetHandle),
  disconnectIdeas: (directory: string, id: string) => ipcRenderer.invoke('board:disconnect', directory, id),
  getAISettings: () => ipcRenderer.invoke('ai:settings'),
  saveAISettings: (model: string, key: string) => ipcRenderer.invoke('ai:save-settings', model, key),
  clearAIKey: () => ipcRenderer.invoke('ai:clear-key'),
  generateDraft: (directory: string, ideaIds: string[]) => ipcRenderer.invoke('ai:generate', directory, ideaIds),
  appendDraft: (directory: string, shots: {
    description: string;
    actionDialogue: string;
    durationMs: number;
  }[]) => ipcRenderer.invoke('ai:append-draft', directory, shots),
  updateAssetTags: (directory: string, assetId: string, tags: string) => ipcRenderer.invoke('asset:tags', directory, assetId, tags),
  deleteAsset: (directory: string, assetId: string) => ipcRenderer.invoke('asset:delete', directory, assetId),
  importAsset: (directory: string) => ipcRenderer.invoke('asset:import', directory),
  relinkAsset: (directory: string, assetId: string) => ipcRenderer.invoke('asset:relink', directory, assetId),
  cancelImport: () => ipcRenderer.invoke('asset:cancel'),
  onImportProgress: (callback: (progress: {
    copied: number;
    total: number;
  }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: {
      copied: number;
      total: number;
    }) => callback(progress);
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
  updateTrim: (directory: string, shotId: string, inMs: number, outMs: number | null) => ipcRenderer.invoke('shot:trim', directory, shotId, inMs, outMs)
};
contextBridge.exposeInMainWorld('watercut', api);

