import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
export function isWaterCutWorkspace(directory: string): boolean {
  try {
    if (!existsSync(path.join(directory, 'forge.config.mts'))) return false;
    const packageData = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8')) as {
      name?: string;
    };
    return packageData.name === 'watercut';
  } catch {
    return false;
  }
}
export function projectStorageRoot(appPath: string, executablePath: string, documentsPath: string): string {
  const portableRoot = path.resolve(path.dirname(executablePath), '..', '..');
  const workspace = [appPath, portableRoot].find(isWaterCutWorkspace);
  return workspace ? path.join(path.dirname(workspace), 'WaterCut Projects') : path.join(documentsPath, 'WaterCut Projects');
}
export function relocatedProjectPath(directory: string, storageRoot: string, documentsPath: string): string {
  const source = path.resolve(directory);
  const legacyRoots = [path.resolve(documentsPath, 'WaterCut Projects'), path.resolve(path.dirname(storageRoot), 'WaterCut', 'projects')];
  if (!legacyRoots.some(root => path.dirname(source).toLowerCase() === root.toLowerCase())) return directory;
  const basename = path.basename(source);
  if (!/^[0-9a-f-]{36}\.watercut$/i.test(basename)) return directory;
  const destination = path.join(storageRoot, basename);
  return existsSync(path.join(destination, 'project.sqlite')) ? destination : directory;
}
