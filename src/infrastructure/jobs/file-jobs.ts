import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, realpathSync, statSync, statfsSync, rmSync } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
export type JobOptions = {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
};
export function checkCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('任务已取消');
}
export function assertSpace(directory: string, bytes: number) {
  const s = statfsSync(directory);
  if (s.bavail * s.bsize < bytes + 8 * 1024 * 1024) throw new Error('磁盘空间不足');
}
export function containedFile(root: string, file: string) {
  const base = realpathSync(root) + path.sep,
    actual = realpathSync(file);
  if (!actual.toLowerCase().startsWith(base.toLowerCase()) || !statSync(actual).isFile()) throw new Error('素材路径超出合法目录或不是文件');
  return actual;
}
export async function hashFile(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    checkCancelled(signal);
    hash.update(chunk);
  }
  return hash.digest('hex');
}
export async function copyWithHash(source: string, target: string, options: JobOptions = {}) {
  const size = statSync(source).size,
    hash = createHash('sha256');
  let copied = 0;
  await pipeline(createReadStream(source), new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      copied += chunk.length;
      hash.update(chunk);
      options.onProgress?.(copied, size);
      callback(null, chunk);
    }
  }), createWriteStream(target, {
    flags: 'wx'
  }), {
    signal: options.signal
  });
  checkCancelled(options.signal);
  if (copied !== size) throw new Error('文件复制不完整');
  return {
    size,
    sha256: hash.digest('hex')
  };
}
export function removeJobDirectory(directory: string, parent: string, prefix: string) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(parent) || !path.basename(resolved).startsWith(prefix)) throw new Error('临时目录清理路径无效');
  rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100
  });
}
