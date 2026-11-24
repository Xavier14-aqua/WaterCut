import { BrowserWindow, ipcMain } from 'electron';
import { z } from 'zod';
import { logUIError } from '../platform/error-log';
import type { ApplicationContext } from '../services/application-context';

export function registerApplicationIPC(context: ApplicationContext) {
  const { closeGuards, logUIError, data } = context;
  ipcMain.on('app:close-ready', (event, requestId: unknown, ok: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && Number.isSafeInteger(requestId) && typeof ok === 'boolean')
      closeGuards.get(window.id)?.acknowledge(requestId as number, ok);
  });

  ipcMain.on('app:request-close', (event) =>
    BrowserWindow.fromWebContents(event.sender)?.close(),
  );

  ipcMain.on('app:ui-error', (event, input) => {
    const parsed = z
      .object({
        scope: z.enum(['app', 'inspector']),
        message: z.string().max(4000),
        stack: z.string().max(20000),
      })
      .safeParse(input);
    if (!parsed.success) return;
    logUIError(parsed.data.scope, parsed.data.message, parsed.data.stack);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && parsed.data.scope === 'app')
      closeGuards.get(window.id)?.markUnavailable();
  });
}
