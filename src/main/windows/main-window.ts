import { app, BrowserWindow, dialog } from 'electron';
import path from 'node:path';
import { WindowCloseGuard } from './window-close';

import type { ApplicationContext } from '../services/application-context';

export function createWindow(context: ApplicationContext) {
  const { activeImports, closeGuards, logUIError } = context;

  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1000,
    minHeight: 680,
    show: !app.commandLine.hasSwitch('watercut-smoke'),
    backgroundColor: '#101c22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      offscreen: app.commandLine.hasSwitch('watercut-smoke'),
      backgroundThrottling: !app.commandLine.hasSwitch('watercut-smoke'),
    },
  });
  const guard = new WindowCloseGuard({
    requestSave: (requestId) =>
      window.webContents.send('app:close-request', requestId),
    confirmExit: async () => {
      const result = await dialog.showMessageBox(window, {
        type: 'warning',
        title: '退出 WaterCut',
        message: '页面暂时没有响应',
        detail:
          '无法确认最近的编辑是否已保存。可以继续等待，或退出程序后重新打开。',
        buttons: ['继续等待', '退出程序'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    },
    close: () => {
      activeImports.get(window.webContents.id)?.abort();
      window.close();
    },
    forceClose: () => {
      activeImports.get(window.webContents.id)?.abort();
      window.destroy();
    },
  });
  closeGuards.set(window.id, guard);
  window.on('close', (event) => {
    if (!guard.allowClose()) event.preventDefault();
  });
  window.on('closed', () => {
    guard.dispose();
    closeGuards.delete(window.id);
  });
  window.on('unresponsive', () => guard.markUnavailable());
  window.on('responsive', () => guard.markResponsive());
  window.webContents.on('did-finish-load', () => guard.markResponsive());
  window.webContents.on('render-process-gone', (_event, details) => {
    guard.markUnavailable();
    logUIError(
      'renderer',
      `渲染进程退出：${details.reason} (${details.exitCode})`,
    );
  });
  window.webContents.on(
    'did-fail-load',
    (_event, code, description, _url, mainFrame) => {
      if (mainFrame) {
        guard.markUnavailable();
        logUIError('load', `${code}: ${description}`);
      }
    },
  );
  window.webContents.setWindowOpenHandler(() => ({
    action: 'deny',
  }));
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL)
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  else
    void window.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
}
