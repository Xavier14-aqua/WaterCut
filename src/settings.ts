import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { StorageSettings } from './shared/models';
import { isWaterCutWorkspace } from './paths';
export function assertExternalDataRoot(root: string) {
  let current = path.resolve(root);
  while (true) {
    if (isWaterCutWorkspace(current)) throw new Error('项目和素材库需要保存在源码仓库外，请选择仓库旁或其他磁盘的目录');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
const schema = z.object({
  configVersion: z.literal(1),
  projectsRoot: z.string().min(1),
  libraryRoot: z.string().min(1)
});
export function readStorageSettings(userData: string, defaultProjectsRoot: string): StorageSettings {
  const defaults: StorageSettings = {
    configVersion: 1,
    projectsRoot: defaultProjectsRoot,
    libraryRoot: path.join(path.dirname(defaultProjectsRoot), 'WaterCut Library')
  };
  const file = path.join(userData, 'storage-settings.json');
  if (!existsSync(file)) return defaults;
  try {
    const value = schema.parse(JSON.parse(readFileSync(file, 'utf8')));
    if (!path.isAbsolute(value.projectsRoot) || !path.isAbsolute(value.libraryRoot)) throw new Error();
    return value;
  } catch {
    throw new Error('存储设置文件损坏，请恢复 storage-settings.json.bak 后重试；原项目未修改');
  }
}
export function writeStorageSettings(userData: string, input: StorageSettings): StorageSettings {
  const value = schema.parse(input);
  for (const root of [value.projectsRoot, value.libraryRoot]) {
    if (!path.isAbsolute(root)) throw new Error('请选择绝对路径');
    assertExternalDataRoot(root);
    mkdirSync(root, {
      recursive: true
    });
    const probe = path.join(root, `.watercut-write-${randomUUID()}`);
    try {
      writeFileSync(probe, '', {
        flag: 'wx'
      });
    } finally {
      rmSync(probe, {
        force: true
      });
    }
  }
  const a = realpathSync(value.projectsRoot),
    b = realpathSync(value.libraryRoot);
  if (a.toLowerCase() === b.toLowerCase()) throw new Error('项目目录和全局库目录需要分别选择');
  mkdirSync(userData, {
    recursive: true
  });
  const file = path.join(userData, 'storage-settings.json');
  if (existsSync(file)) writeFileSync(`${file}.bak`, readFileSync(file));
  const temporary = `${file}.${randomUUID()}.partial`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2));
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, {
      force: true
    });
  }
  return value;
}
