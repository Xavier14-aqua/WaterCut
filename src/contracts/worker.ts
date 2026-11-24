// This is the data-worker whitelist. Adding a command updates its typed protocol here.
interface Implementations {
  project: typeof import('../modules/project');
  library: typeof import('../modules/library');
  workspace: typeof import('../modules/workspace');
  revisions: typeof import('../modules/delivery/revisions');
  packages: typeof import('../modules/delivery/project-package');
  media: typeof import('../modules/media/media');
  proposals: typeof import('../modules/ai/proposals');
  handoff: typeof import('../modules/delivery/jianying-handoff');
}

export const workerMethods = {
  project: [
    'addCandidate',
    'addIdea',
    'addScriptParagraph',
    'addShot',
    'addShotSource',
    'appendDraftShots',
    'archiveProject',
    'attachIdeaAsset',
    'clearShotPrimary',
    'connectIdeas',
    'convertScriptBlocks',
    'createIdea',
    'createProject',
    'createScriptSection',
    'createShotsFromIdeas',
    'deleteAsset',
    'deleteAudioClip',
    'deleteIdea',
    'deleteIdeaBox',
    'deleteScriptBlock',
    'deleteShot',
    'disconnectIdeas',
    'forkProjectIdentity',
    'importAsset',
    'linkAsset',
    'linkAudio',
    'mergeScriptBlocks',
    'moveIdea',
    'moveIdeasToBox',
    'moveShot',
    'readProject',
    'relinkAsset',
    'removeCandidate',
    'removeShotSource',
    'renameProject',
    'reorderScriptBlocks',
    'reorderShots',
    'saveAudioClip',
    'saveIdeaBox',
    'saveScriptBlock',
    'saveTimelineSettings',
    'splitScriptBlock',
    'updateAssetDuration',
    'updateAssetTags',
    'updateEdgeLabel',
    'updateIdea',
    'updateShot',
    'updateShotMetadata',
    'updateTrim',
  ],
  library: [
    'connectLibraryIdeas',
    'deleteLibraryIdeaBox',
    'disconnectLibraryIdeas',
    'getLibraryAsset',
    'getLibraryIdea',
    'hideAssetSelect',
    'ideaEchoes',
    'importLibraryAsset',
    'libraryId',
    'listAssetSelects',
    'listUsage',
    'moveLibraryIdeasToBox',
    'readLibrary',
    'recoverLibraryJobs',
    'relatedIdeas',
    'relinkLibraryAsset',
    'saveAssetSelect',
    'saveLibraryIdea',
    'saveLibraryIdeaBox',
    'setLibraryHidden',
    'updateLibraryAsset',
  ],
  workspace: [
    'attachAssets',
    'attachIdeas',
    'bindSelect',
    'createExample',
    'hydrateProject',
    'projectEnvelope',
    'promoteProject',
    'reconcileCatalog',
    'refreshIdea',
  ],
  revisions: [
    'createRevision',
    'deleteRevision',
    'listRevisions',
    'restoreRevision',
  ],
  packages: ['exportPackage', 'importPackage'],
  media: ['configureMedia', 'probeLibraryAsset', 'probeProject'],
  proposals: [
    'applyAIProposal',
    'deleteAIProposal',
    'listAIProposals',
    'prepareAIRequest',
    'storeAIProposal',
  ],
  handoff: ['exportJianying'],
} as const satisfies {
  [M in keyof Implementations]: readonly (keyof Implementations[M])[];
};
export type DataModule = keyof typeof workerMethods;
type Modules = {
  [M in DataModule]: Pick<
    Implementations[M],
    Extract<(typeof workerMethods)[M][number], keyof Implementations[M]>
  >;
};
export type DataMethod<M extends DataModule> = keyof Modules[M] & string;
type Operation<M extends DataModule, K extends DataMethod<M>> = Extract<
  Modules[M][K],
  (...args: never[]) => unknown
>;
export type DataArguments<
  M extends DataModule,
  K extends DataMethod<M>,
> = Parameters<Operation<M, K>>;
export type DataResult<M extends DataModule, K extends DataMethod<M>> = Awaited<
  ReturnType<Operation<M, K>>
>;
export interface DataCommand<M extends DataModule, K extends DataMethod<M>> {
  id: string;
  module: M;
  method: K;
  args: DataArguments<M, K>;
  job: boolean;
}
export type DataRequest = {
  [M in DataModule]: { [K in DataMethod<M>]: DataCommand<M, K> }[DataMethod<M>];
}[DataModule];
export interface DataCancellation {
  cancel: string;
}
export interface WorkerProgress {
  copied: number;
  total: number;
  jobId: string;
}
export interface DataResponse {
  id: string;
  result?: unknown;
  error?: string;
  progress?: WorkerProgress;
}
export interface DataCallOptions {
  signal?: AbortSignal;
  onProgress?: (data: WorkerProgress) => void;
}
