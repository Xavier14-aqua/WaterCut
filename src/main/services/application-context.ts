import { createFileJobs } from './file-job-registry';
import type { DataMethod, DataArguments } from '../../contracts/worker';
import { logUIError } from '../platform/error-log';
import {
  storage,
  activeLibraryRoot,
  activeProjectsRoot,
} from '../platform/runtime-storage';
import { aiFile, readAISettings } from '../platform/ai-settings';
import { thumbnail, thumbnails } from '../platform/thumbnails';
import { DataClient } from './data-client';
import { app, type WebContents } from 'electron';
import path from 'node:path';
import { relocatedProjectPath } from '../platform/storage-paths';
import { WindowCloseGuard } from '../windows/window-close';
import { z } from 'zod';
import type {
  LibraryAsset,
  LibraryPage,
  LibraryQuery,
  Project,
} from '../../shared/models';

export function createApplicationContext(data: DataClient) {
  const { activeImports, importJob } = createFileJobs();

  const mediaPaths = new Map<
    string,
    {
      file: string;
      root: string;
    }
  >();

  const activeAI = new Map<
    string,
    { sender: number; controller: AbortController }
  >();

  const knownProjects = new Set<string>();

  const closeGuards = new Map<number, WindowCloseGuard>();

  function registerFile(id: string, file: string | null, root: string) {
    if (file)
      mediaPaths.set(id, {
        file,
        root,
      });
  }

  async function projectResult(
    directory: string,
    sender?: WebContents,
  ): Promise<Project> {
    const root = activeLibraryRoot();
    const envelope = await data.call('workspace', 'projectEnvelope', [
      directory,
      root,
    ]);
    knownProjects.add(path.resolve(directory).toLowerCase());
    for (const file of envelope.files) {
      const fileRoot =
        envelope.project.assets.find((a) => a.id === file.id)?.storageKind ===
        'library'
          ? root
          : directory;
      registerFile(`${envelope.project.id}:${file.id}`, file.file, fileRoot);
      registerFile(
        `thumb:${envelope.project.id}:${file.id}`,
        file.thumbnail,
        fileRoot,
      );
    }
    if (sender)
      void thumbnails(envelope.project, sender, envelope.files).catch(
        () => undefined,
      );
    return envelope.project;
  }

  async function allowedProject(input: unknown): Promise<string> {
    let directory = z.string().min(1).parse(input);
    directory = relocatedProjectPath(
      directory,
      activeProjectsRoot(),
      app.getPath('documents'),
    );
    const resolved = path.resolve(directory),
      key = resolved.toLowerCase();
    const underProjectRoot =
      path.dirname(resolved).toLowerCase() ===
      path.resolve(activeProjectsRoot()).toLowerCase();
    if (!knownProjects.has(key) && !underProjectRoot) {
      const catalog = await data.call('library', 'readLibrary', [
        activeLibraryRoot(),
        {
          limit: 1,
        },
      ]);
      if (
        !catalog.projects.some(
          (p) => path.resolve(p.directory).toLowerCase() === key,
        )
      )
        throw new Error('请先通过“打开项目文件夹”选择此项目');
    }
    return directory;
  }

  async function changeProject(
    method: DataMethod<'project'>,
    directory: unknown,
    args: unknown[],
    sender: WebContents,
  ) {
    const dir = await allowedProject(directory);
    // The fixed IPC mutation table chooses the method; each service validates its fields.
    await data.call('project', method, [dir, ...args] as DataArguments<
      'project',
      typeof method
    >);
    return projectResult(dir, sender);
  }

  function registerLibraryAsset(asset: LibraryAsset, root: string) {
    registerFile(
      `${asset.libraryId}:${asset.id}`,
      path.resolve(root, asset.relativePath),
      root,
    );
    registerFile(
      `thumb:${asset.libraryId}:${asset.id}`,
      path.join(root, 'thumbnails', `${asset.id}.png`),
      root,
    );
  }

  async function libraryResult(query: LibraryQuery = {}): Promise<LibraryPage> {
    const root = activeLibraryRoot(),
      page = await data.call('library', 'readLibrary', [root, query]);
    for (const asset of [...page.assets, ...page.referenceAssets])
      registerLibraryAsset(asset, root);
    return page;
  }

  return {
    data,
    mediaPaths,
    activeImports,
    activeAI,
    knownProjects,
    closeGuards,
    registerFile,
    projectResult,
    allowedProject,
    changeProject,
    registerLibraryAsset,
    libraryResult,
    importJob,
    logUIError,
    storage,
    activeLibraryRoot,
    activeProjectsRoot,
    aiFile,
    readAISettings,
    thumbnail,
    thumbnails,
  };
}
export type ApplicationContext = ReturnType<typeof createApplicationContext>;
