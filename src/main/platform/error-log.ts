import { app } from 'electron';
import path from 'node:path';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';

export function logUIError(scope: string, message: string, stack = '') {
  try {
    const directory = app.getPath('userData');
    mkdirSync(directory, {
      recursive: true,
    });
    const file = path.join(directory, 'renderer-errors.log');
    if (existsSync(file) && statSync(file).size > 1024 * 1024)
      writeFileSync(file, '');
    appendFileSync(
      file,
      `${new Date().toISOString()} [${app.getVersion()}] [${scope}] ${message.slice(0, 4000)}\n${stack.slice(0, 16000)}\n`,
    );
  } catch {
    /* Logging must never prevent recovery or exit. */
  }
}
