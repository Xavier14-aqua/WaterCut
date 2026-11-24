export type IdeaKind = 'note' | 'mood' | 'scene';
export type IdeaPayload = {
  colors: string[];
  rhythm: string;
  timeOfDay: string;
  weather: string;
  environment: string;
  location: string;
  props: string;
};
export const emptyPayload: IdeaPayload = {
  colors: [],
  rhythm: '',
  timeOfDay: '',
  weather: '',
  environment: '',
  location: '',
  props: '',
};
export type IdeaContent = {
  kind: IdeaKind;
  text: string;
  tags: string;
  notes: string;
  payload: IdeaPayload;
  occurredAt: string | null;
};
export type IdeaInput = IdeaContent & {
  id?: string;
  expectedVersion?: number;
  media?: IdeaMedia[];
};
export type IdeaMedia = {
  assetId: string;
  role: 'image' | 'video' | 'audio';
  position: number;
  inMs: number;
  outMs: number | null;
};
export type ShotStatus = 'idea' | 'written' | 'to_shoot' | 'ready' | 'locked';
export type Shot = {
  props: string;
  productionState: 'planned' | 'filmed' | 'pickup';
  id: string;
  position: number;
  description: string;
  actionDialogue: string;
  durationMs: number;
  scene: string;
  timeOfDay: string;
  shotSize: string;
  movement: string;
  status: ShotStatus;
  needsReview: boolean;
  reviewNote: string;
};
export type Asset = {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio';
  relativePath: string;
  size: number;
  tags: string;
  missing: boolean;
  thumbnail: boolean;
  storageKind: 'local' | 'library';
  sourceLibraryId: string | null;
  sourceAssetId: string | null;
  sha256: string | null;
  durationMs: number | null;
  starred: boolean;
  importedAt: string | null;
  metadata?: MediaMetadata | null;
};
export type MediaMetadata = {
  probe: 'mediainfo';
  version: string;
  status: 'ready' | 'failed';
  probedAt: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  streams: Array<{
    type: 'video' | 'audio' | 'image';
    codec: string | null;
    frameRate: {
      numerator: number;
      denominator: number;
    } | null;
    timeBase: {
      numerator: number;
      denominator: number;
    } | null;
    variableFrameRate: boolean;
    sampleRate: number | null;
    channels: number | null;
  }>;
  error: string | null;
};
export type Revision = {
  id: string;
  name: string;
  createdAt: string;
  documentVersion: number;
  revision: number;
  assetCount: number;
  automatic: boolean;
};
export type PackageOptions = {
  includeHistory: boolean;
  includeMedia: boolean;
};
export type PackageResult = {
  file: string;
  complete: boolean;
  missing: Array<{
    assetId: string;
    name: string;
    reason: string;
  }>;
  fileCount: number;
};
export type PDFOptions = {
  filter?: ShotListFilter;
  landscape: boolean;
  checklist: boolean;
};
export type ShotAsset = {
  sourceSelectId?: string | null;
  sourceSelectVersion?: number | null;
  sourceSelectName?: string | null;
  shotId: string;
  assetId: string;
  inMs: number;
  outMs: number | null;
};
export type Idea = IdeaContent & {
  boxId: string | null;
  id: string;
  sourceAssetId: string | null;
  x: number;
  y: number;
  recordedAt: string | null;
  sourceLibraryId: string | null;
  sourceIdeaId: string | null;
  sourceVersion: number | null;
  media: IdeaMedia[];
};
export type BoardHandle = 'top' | 'right' | 'bottom' | 'left';
export type BoardEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: BoardHandle;
  targetHandle: BoardHandle;
  label: string;
  kind: 'related' | 'sequence' | 'contrast';
};
export type DraftShot = {
  description: string;
  actionDialogue: string;
  durationMs: number;
};
export type ScriptBlock = {
  id: string;
  position: number;
  kind: 'body' | 'heading' | 'note';
  text: string;
  shotId: string | null;
};
export type ShotSource = {
  id?: string;
  shotId: string;
  ideaId: string | null;
  excerpt: string;
};
export type Project = {
  audioClips: AudioClip[];
  timelineSettings: TimelineSettings;
  availableSelects?: AssetSelect[];
  ideaBoxes: IdeaBox[];
  id: string;
  revision: number;
  directory: string;
  name: string;
  archived: boolean;
  shots: Shot[];
  ideas: Idea[];
  boardEdges: BoardEdge[];
  assets: Asset[];
  shotAssets: ShotAsset[];
  shotAudio: Array<{
    shotId: string;
    assetId: string;
  }>;
  shotCandidates: Array<{
    shotId: string;
    assetId: string;
  }>;
  scriptBlocks: ScriptBlock[];
  shotSources: ShotSource[];
};
export type LibraryAsset = Omit<
  Asset,
  'storageKind' | 'sourceLibraryId' | 'sourceAssetId'
> & {
  libraryId: string;
  hidden: boolean;
  usageCount: number;
  palette: string[];
};
export type LibraryIdea = IdeaContent & {
  boxId: string | null;
  id: string;
  libraryId: string;
  version: number;
  recordedAt: string;
  hidden: boolean;
  media: IdeaMedia[];
};
export type Relation = {
  id: string;
  source: string;
  target: string;
  kind: 'related' | 'sequence' | 'contrast';
  note: string;
};
export type CatalogProject = {
  id: string;
  name: string;
  directory: string;
  archived: boolean;
  available: boolean;
  lastSeen: string;
  indexedRevision: number;
};
export type LibraryQuery = {
  boxId?: string | null;
  color?: import('./colors').ColorFamily;
  search?: string;
  tag?: string;
  kind?: string;
  after?: string;
  before?: string;
  hidden?: boolean;
  starred?: boolean;
  unused?: boolean;
  missing?: boolean;
  offset?: number;
  limit?: number;
};
export type LibraryPage = {
  assetSelects: AssetSelect[];
  ideaBoxes: IdeaBox[];
  ideaBoxCounts: Record<string, number>;
  id: string;
  root: string;
  ideas: LibraryIdea[];
  assets: LibraryAsset[];
  referenceAssets: LibraryAsset[];
  relations: Relation[];
  projects: CatalogProject[];
  totalIdeas: number;
  totalAssets: number;
};
export type RelatedIdea = {
  idea: LibraryIdea;
  reasons: string[];
  score: number;
};
export type StorageSettings = {
  configVersion: 1;
  projectsRoot: string;
  libraryRoot: string;
};
export type ImportProgress = {
  copied: number;
  total: number;
  phase?: string;
  jobId?: string;
};
export type Usage = {
  shotNumber?: number | null;
  clipId?: string | null;
  inMs?: number;
  outMs?: number | null;
  sourceSelectId?: string | null;
  stale?: boolean;
  indexedRevision?: number;
  projectId: string;
  projectName: string;
  directory: string;
  shotId: string;
  role: string;
  lastSeen: string;
  available: boolean;
};
export type ResourceDrag = {
  scopeId?: string;
  scope: 'library' | 'project';
  kind: 'idea' | 'asset' | 'select';
  id: string;
};
export type IdeaBox = {
  id: string;
  name: string;
  position: number;
};
export type IdeaBoxInput = {
  id?: string;
  name: string;
};
export type AssetSelect = {
  id: string;
  libraryId: string;
  assetId: string;
  name: string;
  inMs: number;
  outMs: number;
  note: string;
  version: number;
  hidden: boolean;
  projectAssetId?: string;
  usageCount?: number;
  usageHint?: string;
};
export type AudioClip = {
  id: string;
  assetId: string;
  timelineStartMs: number;
  inMs: number;
  outMs: number;
  gain: number;
  fadeInMs: number;
  fadeOutMs: number;
};
export type TimelineSettings = {
  width: number;
  height: number;
  fpsNum: number;
  fpsDen: number;
  videoGain: number;
  bgmGain: number;
};
export type ShotListFilter = {
  scene?: string;
  timeOfDay?: string;
  props?: string;
  productionState?: Shot['productionState'];
  onlyGaps?: boolean;
};
