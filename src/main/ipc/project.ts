import type { DataMethod } from '../../contracts/worker';
import { dialog, ipcMain } from 'electron';
import path from 'node:path';
import { z } from 'zod';

import type { ApplicationContext } from '../services/application-context';

export function registerProjectIPC(context: ApplicationContext) {
  const mutations: Record<string, DataMethod<'project'>> = {
    'project:rename': 'renameProject',
    'project:archive': 'archiveProject',
    'shot:add': 'addShot',
    'shot:update': 'updateShot',
    'shot:delete': 'deleteShot',
    'shot:move': 'moveShot',
    'shot:reorder': 'reorderShots',
    'shot:metadata': 'updateShotMetadata',
    'shot:trim': 'updateTrim',
    'shot:from-ideas': 'createShotsFromIdeas',
    'idea:add': 'addIdea',
    'idea:create': 'createIdea',
    'audio:save': 'saveAudioClip',
    'audio:delete': 'deleteAudioClip',
    'timeline:settings': 'saveTimelineSettings',
    'idea-box:save': 'saveIdeaBox',
    'idea-box:delete': 'deleteIdeaBox',
    'idea-box:move': 'moveIdeasToBox',
    'idea:update': 'updateIdea',
    'idea:delete': 'deleteIdea',
    'idea:attach': 'attachIdeaAsset',
    'board:move': 'moveIdea',
    'board:connect': 'connectIdeas',
    'board:disconnect': 'disconnectIdeas',
    'board:label': 'updateEdgeLabel',
    'script:save': 'saveScriptBlock',
    'script:section': 'createScriptSection',
    'script:paragraph': 'addScriptParagraph',
    'script:reorder': 'reorderScriptBlocks',
    'shot:source-add': 'addShotSource',
    'shot:source-remove': 'removeShotSource',
    'shot:clear-primary': 'clearShotPrimary',
    'script:convert': 'convertScriptBlocks',
    'script:delete': 'deleteScriptBlock',
    'script:split': 'splitScriptBlock',
    'script:merge': 'mergeScriptBlocks',
    'ai:append-draft': 'appendDraftShots',
    'asset:tags': 'updateAssetTags',
    'asset:delete': 'deleteAsset',
    'asset:link': 'linkAsset',
    'asset:candidate-add': 'addCandidate',
    'asset:candidate-remove': 'removeCandidate',
    'asset:link-audio': 'linkAudio',
    'asset:duration': 'updateAssetDuration',
  };

  const {
    activeProjectsRoot,
    data,
    projectResult,
    knownProjects,
    allowedProject,
    changeProject,
    activeLibraryRoot,
    importJob,
  } = context;
  ipcMain.handle('project:root', () => activeProjectsRoot());

  ipcMain.handle('project:create', async (event, name) => {
    const project = await data.call('project', 'createProject', [
      activeProjectsRoot(),
      name,
    ]);
    return projectResult(project.directory, event.sender);
  });

  ipcMain.handle('project:open', async (event) => {
    const result = await dialog.showOpenDialog({
      title: '打开 .watercut 项目',
      properties: ['openDirectory'],
      defaultPath: activeProjectsRoot(),
    });
    if (result.canceled) return null;
    const dir = result.filePaths[0];
    knownProjects.add(path.resolve(dir).toLowerCase());
    try {
      return await projectResult(dir, event.sender);
    } catch (error) {
      if (error instanceof Error && error.message.includes('相同项目 ID')) {
        const choice = await dialog.showMessageBox({
          type: 'question',
          message: '此文件夹是已登记项目的另一份副本',
          detail: '为此副本创建独立身份后，两个项目的内容将分别保存。',
          buttons: ['作为副本打开', '取消'],
          cancelId: 1,
        });
        if (choice.response === 0) {
          await data.call('project', 'forkProjectIdentity', [dir]);
          return projectResult(dir, event.sender);
        }
        return null;
      }
      throw error;
    }
  });

  ipcMain.handle('project:read', async (event, directory) =>
    projectResult(await allowedProject(directory), event.sender),
  );

  for (const [channel, method] of Object.entries(mutations))
    ipcMain.handle(channel, (event, directory, ...args) =>
      changeProject(method, directory, args, event.sender),
    );

  ipcMain.handle('project:attach-assets', async (event, directory, ids) => {
    const dir = await allowedProject(directory);
    await data.call('workspace', 'attachAssets', [
      dir,
      activeLibraryRoot(),
      z.array(z.string().uuid()).min(1).max(100).parse(ids),
    ]);
    return projectResult(dir, event.sender);
  });

  ipcMain.handle(
    'project:attach-ideas',
    async (event, directory, ids, copy = false) => {
      const dir = await allowedProject(directory);
      await data.call('workspace', 'attachIdeas', [
        dir,
        activeLibraryRoot(),
        z.array(z.string().uuid()).min(1).max(100).parse(ids),
        z.boolean().parse(copy),
      ]);
      return projectResult(dir, event.sender);
    },
  );

  ipcMain.handle('project:refresh-idea', async (event, directory, id) => {
    const dir = await allowedProject(directory);
    await data.call('workspace', 'refreshIdea', [dir, activeLibraryRoot(), id]);
    return projectResult(dir, event.sender);
  });

  ipcMain.handle('project:promote', async (event, directory) => {
    const dir = await allowedProject(directory);
    return importJob(event.sender, async (options) => {
      await data.call(
        'workspace',
        'promoteProject',
        [dir, activeLibraryRoot()],
        options,
      );
      return projectResult(dir, event.sender);
    });
  });

  ipcMain.handle('project:example', async (event) => {
    const project = await data.call('workspace', 'createExample', [
      activeProjectsRoot(),
      activeLibraryRoot(),
    ]);
    return projectResult(project.directory, event.sender);
  });
}
