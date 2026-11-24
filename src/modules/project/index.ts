// Public module API. Implementations keep one owner for each operation.
export type * from '../../shared/models';
export { CURRENT_VERSION } from './migrations/schema';
export { localAssetPath, openDatabase } from './database';
export { readProject } from './repositories/read-project';
export { mutateProject } from './transaction';
export {
  createProject,
  renameProject,
  forkProjectIdentity,
  archiveProject,
} from './services/lifecycle';
export {
  addIdea,
  updateIdea,
  deleteIdea,
  moveIdea,
  connectIdeas,
  disconnectIdeas,
  attachIdeaAsset,
  createIdea,
  attachLibraryIdeas,
  refreshLibraryIdea,
  updateEdgeLabel,
} from './services/ideas';
export {
  cleanupPartialAssets,
  importAsset,
  relinkAsset,
  updateAssetTags,
  deleteAsset,
  updateAssetDuration,
  attachLibraryAssets,
} from './services/assets';
export {
  appendDraftShots,
  linkAsset,
  addCandidate,
  removeCandidate,
  linkAudio,
  deleteShot,
  moveShot,
  updateTrim,
  addShot,
  updateShot,
  updateShotMetadata,
  reorderShots,
  addShotSource,
  removeShotSource,
  clearShotPrimary,
  bindLibrarySelect,
} from './services/shots';
export {
  reorderScriptBlocks,
  createScriptSection,
  addScriptParagraph,
  createShotsFromIdeas,
  saveScriptBlock,
  convertScriptBlocks,
  deleteScriptBlock,
  splitScriptBlock,
  mergeScriptBlocks,
} from './services/script';
export {
  saveIdeaBox,
  deleteIdeaBox,
  moveIdeasToBox,
} from './services/organization';
export {
  saveAudioClip,
  deleteAudioClip,
  saveTimelineSettings,
} from './services/audio';
export { markCatalogSynced } from './services/catalog';
