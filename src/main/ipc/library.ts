import { dialog, ipcMain } from 'electron';
import path from 'node:path';
import { z } from 'zod';

import type { ApplicationContext } from '../services/application-context';

export function registerLibraryIPC(context: ApplicationContext) {
  const {
    libraryResult,
    data,
    activeLibraryRoot,
    registerLibraryAsset,
    allowedProject,
    projectResult,
    importJob,
    thumbnail,
  } = context;
  ipcMain.handle('library:read', (_event, query) => libraryResult(query));

  ipcMain.handle('library:save-idea', async (_event, input) =>
    data.call('library', 'saveLibraryIdea', [activeLibraryRoot(), input]),
  );

  ipcMain.handle('library:box-save', (_event, input) =>
    data.call('library', 'saveLibraryIdeaBox', [activeLibraryRoot(), input]),
  );

  ipcMain.handle('library:box-delete', (_event, id) =>
    data.call('library', 'deleteLibraryIdeaBox', [activeLibraryRoot(), id]),
  );

  ipcMain.handle('library:box-move', (_event, ids, boxId) =>
    data.call('library', 'moveLibraryIdeasToBox', [
      activeLibraryRoot(),
      ids,
      boxId,
    ]),
  );

  ipcMain.handle('library:get-idea', async (_event, id) => {
    const root = activeLibraryRoot(),
      idea = await data.call('library', 'getLibraryIdea', [root, id]);
    for (const media of idea.media) {
      const asset = await data.call('library', 'getLibraryAsset', [
        root,
        media.assetId,
      ]);
      registerLibraryAsset(asset, root);
    }
    return idea;
  });

  ipcMain.handle('library:get-asset', async (_event, id) => {
    const asset = await data.call('library', 'getLibraryAsset', [
      activeLibraryRoot(),
      id,
    ]);
    registerLibraryAsset(asset, activeLibraryRoot());
    return asset;
  });

  ipcMain.handle('library:related', (_event, id) =>
    data.call('library', 'relatedIdeas', [activeLibraryRoot(), id]),
  );

  ipcMain.handle('library:usage', (_event, id, range) =>
    data.call('library', 'listUsage', [activeLibraryRoot(), id, range]),
  );

  ipcMain.handle('select:list', (_event, id) =>
    data.call('library', 'listAssetSelects', [activeLibraryRoot(), id]),
  );

  ipcMain.handle('select:save', (_event, input) =>
    data.call('library', 'saveAssetSelect', [activeLibraryRoot(), input]),
  );

  ipcMain.handle('select:hide', (_event, id) =>
    data.call('library', 'hideAssetSelect', [activeLibraryRoot(), id]),
  );

  ipcMain.handle('select:bind', async (event, directory, shotId, selectId) => {
    const dir = await allowedProject(directory);
    await data.call('workspace', 'bindSelect', [
      dir,
      activeLibraryRoot(),
      shotId,
      selectId,
    ]);
    return projectResult(dir, event.sender);
  });

  ipcMain.handle('library:hide', (_event, kind, id, hidden) =>
    data.call('library', 'setLibraryHidden', [
      activeLibraryRoot(),
      z.enum(['idea', 'asset']).parse(kind),
      id,
      z.boolean().parse(hidden),
    ]),
  );

  ipcMain.handle('library:asset-update', (_event, id, input) =>
    data.call('library', 'updateLibraryAsset', [
      activeLibraryRoot(),
      id,
      input,
    ]),
  );

  ipcMain.handle('library:connect', (_event, source, target, kind, note) =>
    data.call('library', 'connectLibraryIdeas', [
      activeLibraryRoot(),
      source,
      target,
      kind,
      note,
    ]),
  );

  ipcMain.handle('library:disconnect', (_event, id) =>
    data.call('library', 'disconnectLibraryIdeas', [activeLibraryRoot(), id]),
  );

  ipcMain.handle('library:reconcile', async () => {
    await data.call('workspace', 'reconcileCatalog', [activeLibraryRoot()]);
    return libraryResult();
  });

  ipcMain.handle('library:import', async (event) => {
    const choice = await dialog.showOpenDialog({
      title: '导入图片、视频或音频到全局库',
      properties: ['openFile', 'multiSelections'],
    });
    if (choice.canceled) return null;
    return importJob(event.sender, async (options) => {
      const root = activeLibraryRoot();
      for (let index = 0; index < choice.filePaths.length; index++) {
        if (options.signal.aborted) throw new Error('导入已取消');
        const asset = await data.call(
          'library',
          'importLibraryAsset',
          [root, choice.filePaths[index]],
          {
            ...options,
            onProgress: (p) =>
              options.onProgress({
                ...p,
                phase: `${index + 1}/${choice.filePaths.length}`,
              }),
          },
        );
        registerLibraryAsset(asset, root);
        await data.call(
          'media',
          'probeLibraryAsset',
          [root, asset.id],
          options,
        );
        if (asset.kind !== 'audio') {
          const palette = await thumbnail(
            path.resolve(root, asset.relativePath),
            path.join(root, 'thumbnails', `${asset.id}.png`),
          );
          if (palette.length)
            await data.call('library', 'updateLibraryAsset', [
              root,
              asset.id,
              {
                palette,
              },
            ]);
        }
      }
      return libraryResult();
    });
  });

  ipcMain.handle('library:relink', async (event, id) => {
    const choice = await dialog.showOpenDialog({
      title: '重新定位全局库原件（内容需与原件一致）',
      properties: ['openFile'],
    });
    if (choice.canceled) return null;
    return importJob(event.sender, async (options) => {
      const asset = await data.call(
        'library',
        'relinkLibraryAsset',
        [activeLibraryRoot(), id, choice.filePaths[0]],
        options,
      );
      registerLibraryAsset(asset, activeLibraryRoot());
      return asset;
    });
  });

  ipcMain.handle('library:echoes', async (_event, input) =>
    data.call('library', 'ideaEchoes', [activeLibraryRoot(), input]),
  );
}
