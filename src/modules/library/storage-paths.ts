import path from 'node:path';

export function safeLibraryPath(root: string, relative: string): string {
  if (path.isAbsolute(relative)) throw new Error('素材路径无效');
  const resolved = path.resolve(root, relative),
    prefix = path.resolve(root) + path.sep;
  if (!resolved.toLowerCase().startsWith(prefix.toLowerCase()))
    throw new Error('素材路径超出全局库');
  return resolved;
}
