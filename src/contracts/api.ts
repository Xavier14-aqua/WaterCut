import type { BoardHandle, DraftShot, Project } from '../shared/models';
import type { StorageSettings, LibraryQuery, LibraryPage, LibraryIdea, LibraryAsset, IdeaInput, RelatedIdea, Relation, Usage, Shot, ScriptBlock, ImportProgress, Revision, PackageOptions, PackageResult, PDFOptions, IdeaBoxInput } from '../shared/models';

// Public, serializable interface exposed by preload. Runtime validation stays in IPC/services.
export interface WaterCutAPI {
      localEchoes(input:{text:string;tags:string;exclude:string[]}):Promise<{ideas:import('../shared/models').RelatedIdea[];assets:LibraryAsset[]}>;
      exportJianying(directory:string,input:{placeholders:boolean}):Promise<{directory:string;videoClips:number;audioClips:number;durationUs:number;placeholders:number}|null>;
      listAIProposals(directory:string):Promise<import('../shared/ai-proposals').AIProposal[]>;
      deleteAIProposal(directory:string,id:string):Promise<void>;
      applyAIProposal(directory:string,id:string,input:{mode:'route'|'visual'|'mark'|'insert'|'dismiss';index?:number;description?:string;shotSize?:string;movement?:string}):Promise<Project>;
      generateSuggestions(directory:string,input:import('../shared/ai-proposals').AIRequest,requestId:string):Promise<import('../shared/ai-proposals').AIProposal>;
      cancelAIRequest(requestId:string):Promise<void>;
      saveAudioClip(directory:string,input:Omit<import('../shared/models').AudioClip,'id'>&{id?:string}):Promise<Project>;
      deleteAudioClip(directory:string,id:string):Promise<Project>;
      saveTimelineSettings(directory:string,input:import('../shared/models').TimelineSettings):Promise<Project>;
      listAssetSelects(assetId:string):Promise<import('../shared/models').AssetSelect[]>;
      saveAssetSelect(input:{id?:string;assetId:string;name:string;inMs:number;outMs:number;note:string;expectedVersion?:number}):Promise<import('../shared/models').AssetSelect[]>;
      hideAssetSelect(id:string):Promise<void>;
      bindSelect(directory:string,shotId:string,selectId:string):Promise<Project>;
      saveIdeaBox(directory: string, input: IdeaBoxInput): Promise<Project>;
      deleteIdeaBox(directory: string, id: string): Promise<Project>;
      moveIdeasToBox(directory: string, ids: string[], boxId: string | null): Promise<Project>;
      saveLibraryIdeaBox(input: IdeaBoxInput): Promise<void>;
      deleteLibraryIdeaBox(id: string): Promise<void>;
      moveLibraryIdeasToBox(ids: string[], boxId: string | null): Promise<void>;
      createScriptSection(directory: string, input: {
        title?: string;
        beforeId?: string;
      }): Promise<Project>;
      addScriptParagraph(directory: string, sectionId: string | null): Promise<Project>;
      reorderScriptBlocks(directory: string, ids: string[]): Promise<Project>;
      addShotSource(directory: string, shotId: string, ideaId: string): Promise<Project>;
      removeShotSource(directory: string, shotId: string, sourceId: string): Promise<Project>;
      clearShotPrimary(directory: string, shotId: string): Promise<Project>;
      listRevisions(directory: string): Promise<Revision[]>;
      createRevision(directory: string, name: string): Promise<Revision[] | null>;
      deleteRevision(directory: string, id: string): Promise<Revision[]>;
      restoreRevision(directory: string, id: string): Promise<Project | null>;
      exportProjectPackage(directory: string, options: PackageOptions): Promise<PackageResult | null>;
      importProjectPackage(): Promise<Project | null>;
      probeProject(directory: string): Promise<Project | null>;
      probeLibraryAsset(id: string): Promise<LibraryPage | null>;
      exportStoryboardPDF(directory: string, options: PDFOptions): Promise<string | null>;
      reportUIError(error: {
        scope: 'app' | 'inspector';
        message: string;
        stack: string;
      }): void;
      requestClose(): void;
      getStorageSettings(): Promise<StorageSettings>;
      getPalette(token: string): Promise<string[]>;
      chooseStorageRoot(kind: 'projectsRoot' | 'libraryRoot'): Promise<StorageSettings | null>;
      readLibrary(query?: LibraryQuery): Promise<LibraryPage>;
      saveLibraryIdea(input: IdeaInput): Promise<LibraryIdea>;
      getLibraryIdea(id: string): Promise<LibraryIdea>;
      getLibraryAsset(id: string): Promise<LibraryAsset>;
      relatedIdeas(id: string): Promise<RelatedIdea[]>;
      libraryUsage(id: string,range?:{inMs:number;outMs:number}): Promise<Usage[]>;
      hideLibraryItem(kind: 'idea' | 'asset', id: string, hidden: boolean): Promise<void>;
      updateLibraryAsset(id: string, input: {
        tags?: string;
        starred?: boolean;
        durationMs?: number;
        palette?: string[];
      }): Promise<LibraryAsset>;
      connectLibraryIdeas(source: string, target: string, kind: Relation['kind'], note: string): Promise<void>;
      disconnectLibraryIdeas(id: string): Promise<void>;
      reconcileLibrary(): Promise<LibraryPage>;
      importLibraryAssets(): Promise<LibraryPage | null>;
      relinkLibraryAsset(id: string): Promise<LibraryAsset | null>;
      attachLibraryAssets(directory: string, ids: string[]): Promise<Project>;
      attachLibraryIdeas(directory: string, ids: string[], copy?: boolean): Promise<Project>;
      refreshLibraryIdea(directory: string, id: string): Promise<Project>;
      promoteProject(directory: string): Promise<Project | null>;
      createExample(): Promise<Project>;
      archiveProject(directory: string, archived: boolean): Promise<Project>;
      createIdea(directory: string, input: IdeaInput): Promise<Project>;
      updateEdgeLabel(directory: string, id: string, label: string): Promise<Project>;
      updateShotMetadata(directory: string, id: string, input: Shot): Promise<Project>;
      reorderShots(directory: string, ids: string[]): Promise<Project>;
      createShotsFromIdeas(directory: string, ids: string[], commandId: string, draft?: DraftShot[]): Promise<Project>;
      saveScriptBlock(directory: string, input: {
        id?: string;
        kind: ScriptBlock['kind'];
        text: string;
      }): Promise<Project>;
      convertScriptBlocks(directory: string, ids: string[], commandId: string): Promise<Project>;
      deleteScriptBlock(directory: string, id: string): Promise<Project>;
      splitScriptBlock(directory: string, id: string, offset: number): Promise<Project>;
      mergeScriptBlocks(directory: string, first: string, second: string): Promise<Project>;
      updateAssetDuration(directory: string, id: string, durationMs: number): Promise<Project>;
      exportShotList(directory: string,filter?:import('../shared/models').ShotListFilter): Promise<string | null>;
      onCloseRequest(callback: () => Promise<boolean>): () => void;
      createProject(name: string): Promise<Project>;
      getProjectsRoot(): Promise<string>;
      openProject(): Promise<Project | null>;
      readProject(directory: string): Promise<Project>;
      renameProject(directory: string, name: string): Promise<Project>;
      addShot(directory: string, shot: {
        description: string;
        durationMs: number;
      }): Promise<Project>;
      updateShot(directory: string, id: string, shot: {
        description: string;
        actionDialogue: string;
        durationMs: number;
      }): Promise<Project>;
      deleteShot(directory: string, id: string): Promise<Project>;
      moveShot(directory: string, id: string, offset: -1 | 1): Promise<Project>;
      addIdea(directory: string, text: string): Promise<Project>;
      updateIdea(directory: string, id: string, idea: {
        text: string;
        tags: string;
        notes: string;
      }): Promise<Project>;
      deleteIdea(directory: string, id: string): Promise<Project>;
      attachIdeaAsset(directory: string, assetId: string): Promise<Project>;
      moveIdea(directory: string, id: string, x: number, y: number): Promise<Project>;
      connectIdeas(directory: string, source: string, target: string, sourceHandle: BoardHandle, targetHandle: BoardHandle): Promise<Project>;
      disconnectIdeas(directory: string, id: string): Promise<Project>;
      getAISettings(): Promise<{
        model: string;
        hasKey: boolean;
      }>;
      saveAISettings(model: string, key: string): Promise<{
        model: string;
        hasKey: boolean;
      }>;
      clearAIKey(): Promise<{
        model: string;
        hasKey: boolean;
      }>;
      generateDraft(directory: string, ideaIds: string[]): Promise<DraftShot[]>;
      appendDraft(directory: string, shots: DraftShot[]): Promise<Project>;
      updateAssetTags(directory: string, assetId: string, tags: string): Promise<Project>;
      deleteAsset(directory: string, assetId: string): Promise<Project>;
      importAsset(directory: string): Promise<Project | null>;
      relinkAsset(directory: string, assetId: string): Promise<Project | null>;
      cancelImport(): Promise<boolean>;
      onImportProgress(callback: (progress: ImportProgress) => void): () => void;
      onThumbnailReady(callback: (assetId: string) => void): () => void;
      linkAsset(directory: string, shotId: string, assetId: string): Promise<Project>;
      addCandidate(directory: string, shotId: string, assetId: string): Promise<Project>;
      removeCandidate(directory: string, shotId: string, assetId: string): Promise<Project>;
      linkAudio(directory: string, shotId: string, assetId: string): Promise<Project>;
      updateTrim(directory: string, shotId: string, inMs: number, outMs: number | null): Promise<Project>;
    }
