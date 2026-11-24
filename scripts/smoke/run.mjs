import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { selectProfile } from './profiles.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const args = process.argv.slice(2);
const profile = selectProfile(args);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const outputFlag = args.find((arg) => arg.startsWith('--out='));
if (outputFlag) env.WATERCUT_SMOKE_OUT = outputFlag.slice('--out='.length);
// Use Electron's supported entry; a fresh npm ci may install the runtime lazily.
const electron = createRequire(import.meta.url)('electron');
const child = spawn(
  electron,
  [path.join(root, 'scripts/smoke', profile.file), ...args],
  { cwd: root, env, windowsHide: true, stdio: 'inherit' },
);
child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
  const reportFile = path.join(root, 'out', profile.report, 'report.json');
  if (!fs.existsSync(reportFile)) return;
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const temporary = path.resolve(report.temporary ?? '');
  // Only remove the explicitly identified synthetic test directory, after exit.
  if (
    path.dirname(temporary) === path.resolve(os.tmpdir()) &&
    path.basename(temporary).startsWith('watercut-ui-')
  ) {
    try {
      fs.rmSync(temporary, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 200,
      });
    } catch (error) {
      console.error('Temporary test directory retained:', error.message);
    }
  }
});
