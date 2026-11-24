import { dialog, ipcMain } from 'electron';
import path from 'node:path';
import { realpathSync } from 'node:fs';
import { z } from 'zod';

import type { ApplicationContext } from '../services/application-context';

export function registerMediaIPC(context: ApplicationContext) {
  const {
    allowedProject,
    importJob,
    data,
    activeLibraryRoot,
    projectResult,
    libraryResult,
    mediaPaths,
    thumbnail,
    activeImports,
  } = context;
  ipcMain.handle('media:probe-project', async (event, directory) => {
    const dir = await allowedProject(directory);
    return importJob(event.sender, async (options) => {
      await data.call(
        'media',
        'probeProject',
        [dir, activeLibraryRoot()],
        options,
      );
      return projectResult(dir, event.sender);
    });
  });

  ipcMain.handle('media:probe-library', async (event, id) =>
    importJob(event.sender, async (options) => {
      await data.call(
        'media',
        'probeLibraryAsset',
        [activeLibraryRoot(), z.string().uuid().parse(id)],
        options,
      );
      return libraryResult();
    }),
  );

  ipcMain.handle('media:palette', async (_event, token) => {
    const key = z.string().max(200).parse(token),
      entry = mediaPaths.get(key);
    if (!entry) throw new Error('请先打开该素材');
    const id = z.string().uuid().parse(key.split(':').at(-1));
    const real = realpathSync(entry.file),
      root = realpathSync(entry.root) + path.sep;
    if (!real.toLowerCase().startsWith(root.toLowerCase()))
      throw new Error('素材路径不合法');
    return thumbnail(real, path.join(entry.root, 'thumbnails', `${id}.png`));
  });

  ipcMain.handle('asset:import', async (event, directory) => {
    const dir = await allowedProject(directory),
      choice = await dialog.showOpenDialog({
        title: '导入项目独有素材副本',
        properties: ['openFile'],
      });
    if (choice.canceled) return null;
    return importJob(event.sender, async (options) => {
      await data.call(
        'project',
        'importAsset',
        [dir, choice.filePaths[0]],
        options,
      );
      await data.call(
        'media',
        'probeProject',
        [dir, activeLibraryRoot()],
        options,
      );
      return projectResult(dir, event.sender);
    });
  });

  ipcMain.handle('asset:relink', async (event, directory, id) => {
    const dir = await allowedProject(directory),
      choice = await dialog.showOpenDialog({
        title: '重新定位项目缺失素材',
        properties: ['openFile'],
      });
    if (choice.canceled) return null;
    return importJob(event.sender, async (options) => {
      await data.call(
        'project',
        'relinkAsset',
        [dir, id, choice.filePaths[0]],
        options,
      );
      return projectResult(dir, event.sender);
    });
  });

  ipcMain.handle('asset:cancel', (event) => {
    const controller = activeImports.get(event.sender.id);
    controller?.abort();
    return !!controller;
  });
}
