import { afterEach, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectStorageRoot, relocatedProjectPath } from './paths';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

test('portable build and development use projects inside the workspace', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-paths-')); roots.push(root);
  writeFileSync(path.join(root, 'package.json'), '{"name":"watercut"}');
  writeFileSync(path.join(root, 'forge.config.mts'), '');
  const exe = path.join(root, 'out', 'WaterCut-win32-x64', 'WaterCut.exe');
  expect(projectStorageRoot(root, exe, path.join(root, 'Documents'))).toBe(path.join(root, 'projects'));
  expect(projectStorageRoot(path.join(root, 'resources', 'app.asar'), exe, path.join(root, 'Documents'))).toBe(path.join(root, 'projects'));
  expect(projectStorageRoot(path.join(root, 'other'), path.join(root, 'unrelated', 'app.exe'), path.join(root, 'Documents'))).toBe(path.join(root, 'Documents', 'WaterCut Projects'));
});

test('a moved legacy project resolves to its new location', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-paths-')); roots.push(root);
  const id = 'a3d0711e-2bb9-4474-8bb0-45d76e9979e0.watercut';
  const oldPath = path.join(root, 'Documents', 'WaterCut Projects', id);
  const newPath = path.join(root, 'projects', id);
  expect(relocatedProjectPath(oldPath, path.join(root, 'projects'), path.join(root, 'Documents'))).toBe(oldPath);
  mkdirSync(newPath, { recursive: true }); writeFileSync(path.join(newPath, 'project.sqlite'), 'test');
  expect(relocatedProjectPath(oldPath, path.join(root, 'projects'), path.join(root, 'Documents'))).toBe(newPath);
});
