import { app, dialog, ipcMain } from 'electron';
import {
  writeStorageSettings,
  assertExternalDataRoot,
} from '../platform/storage-settings';
import { z } from 'zod';
import { storage } from '../platform/runtime-storage';
import type { ApplicationContext } from '../services/application-context';

export function registerSettingsIPC(context: ApplicationContext) {
  const { storage, data, mediaPaths } = context;
  ipcMain.handle('settings:get', () => storage());

  ipcMain.handle('settings:choose-root', async (_event, kind: unknown) => {
    const field = z.enum(['projectsRoot', 'libraryRoot']).parse(kind),
      previous = storage();
    const result = await dialog.showOpenDialog({
      title:
        field === 'projectsRoot'
          ? '选择以后新项目的保存位置'
          : '打开或新建 WaterCut 全局库（不会移动旧库）',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: previous[field],
    });
    if (result.canceled) return null;
    assertExternalDataRoot(result.filePaths[0]);
    if (field === 'libraryRoot') {
      await data.call('library', 'libraryId', [result.filePaths[0]]);
      await data.call('library', 'recoverLibraryJobs', [result.filePaths[0]]);
    }
    const saved = writeStorageSettings(app.getPath('userData'), {
      ...previous,
      [field]: result.filePaths[0],
    });
    if (field === 'libraryRoot') mediaPaths.clear();
    return saved;
  });
}
