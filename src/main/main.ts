import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { DataClient } from './services/data-client';
import {
  createApplicationContext,
  type ApplicationContext,
} from './services/application-context';
import {
  registerMediaScheme,
  registerMediaProtocol,
} from './platform/media-protocol';
import { writeStorageSettings } from './platform/storage-settings';
import { registerIPC } from './ipc';
import { createWindow } from './windows/main-window';

registerMediaScheme();
let shutdownContext: ApplicationContext | undefined;
if (!app.requestSingleInstanceLock()) app.quit();
else
  app
    .whenReady()
    .then(async () => {
      const data = new DataClient();
      const context = createApplicationContext(data);
      shutdownContext = context;
      const { storage, activeLibraryRoot } = context;
      const packagedWasm = path.resolve(
        __dirname,
        '../../../MediaInfoModule.wasm',
      );
      await data.call('media', 'configureMedia', [
        existsSync(packagedWasm)
          ? packagedWasm
          : path.resolve(
              __dirname,
              '../../node_modules/mediainfo.js/dist/MediaInfoModule.wasm',
            ),
      ]);
      if (
        !existsSync(path.join(app.getPath('userData'), 'storage-settings.json'))
      )
        writeStorageSettings(app.getPath('userData'), storage());
      registerMediaProtocol(context);
      registerIPC(context);

      try {
        await data.call('library', 'recoverLibraryJobs', [activeLibraryRoot()]);
        await data.call('workspace', 'reconcileCatalog', [activeLibraryRoot()]);
      } catch {
        /* The UI can show the failure and offer storage settings. */
      }
      createWindow(context);
      app.on('activate', () => {
        if (!BrowserWindow.getAllWindows().length) createWindow(context);
      });
      app.on('second-instance', () => {
        const window = BrowserWindow.getAllWindows()[0];
        window?.restore();
        window?.focus();
      });
    })
    .catch((error) => {
      dialog.showErrorBox('WaterCut 启动失败', String(error));
      app.quit();
    });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => {
  for (const controller of shutdownContext?.activeImports.values() ?? [])
    controller.abort();
  void shutdownContext?.data.close();
});
