import type { BoardHandle, DraftShot, Project } from './project';

declare global {
  interface Window {
    watercut: {
      onCloseRequest(callback: () => Promise<boolean>): () => void;
      createProject(name: string): Promise<Project>;
      getProjectsRoot(): Promise<string>;
      openProject(): Promise<Project | null>;
      readProject(directory: string): Promise<Project>;
      renameProject(directory: string, name: string): Promise<Project>;
      addShot(directory: string, shot: { description: string; durationMs: number }): Promise<Project>;
      updateShot(directory: string, id: string, shot: { description: string; actionDialogue: string; durationMs: number }): Promise<Project>;
      deleteShot(directory: string, id: string): Promise<Project>;
      moveShot(directory: string, id: string, offset: -1 | 1): Promise<Project>;
      addIdea(directory: string, text: string): Promise<Project>;
      updateIdea(directory: string, id: string, idea: { text: string; tags: string; notes: string }): Promise<Project>;
      deleteIdea(directory: string, id: string): Promise<Project>;
      attachIdeaAsset(directory: string, assetId: string): Promise<Project>;
      moveIdea(directory: string, id: string, x: number, y: number): Promise<Project>;
      connectIdeas(directory: string, source: string, target: string, sourceHandle: BoardHandle, targetHandle: BoardHandle): Promise<Project>;
      disconnectIdeas(directory: string, id: string): Promise<Project>;
      getAISettings(): Promise<{ model: string; hasKey: boolean }>;
      saveAISettings(model: string, key: string): Promise<{ model: string; hasKey: boolean }>;
      clearAIKey(): Promise<{ model: string; hasKey: boolean }>;
      generateDraft(directory: string, ideaIds: string[]): Promise<DraftShot[]>;
      appendDraft(directory: string, shots: DraftShot[]): Promise<Project>;
      updateAssetTags(directory: string, assetId: string, tags: string): Promise<Project>;
      deleteAsset(directory: string, assetId: string): Promise<Project>;
      importAsset(directory: string): Promise<Project | null>;
      relinkAsset(directory: string, assetId: string): Promise<Project | null>;
      cancelImport(): Promise<boolean>;
      onImportProgress(callback: (progress: { copied: number; total: number }) => void): () => void;
      onThumbnailReady(callback: (assetId: string) => void): () => void;
      linkAsset(directory: string, shotId: string, assetId: string): Promise<Project>;
      addCandidate(directory: string, shotId: string, assetId: string): Promise<Project>;
      removeCandidate(directory: string, shotId: string, assetId: string): Promise<Project>;
      linkAudio(directory: string, shotId: string, assetId: string): Promise<Project>;
      updateTrim(directory: string, shotId: string, inMs: number, outMs: number | null): Promise<Project>;
    };
  }
}
