import * as yauzl from 'yauzl';
import * as yazl from 'yazl';
import { createReadStream, createWriteStream, mkdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Transform, type Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { checkCancelled, type JobOptions } from '../jobs/file-jobs';
export const PACKAGE_LIMITS = {
  entries: 10000,
  fileBytes: 10 * 1024 ** 3,
  totalBytes: 50 * 1024 ** 3,
  manifestBytes: 2 * 1024 ** 2,
  databaseBytes: 256 * 1024 ** 2
};
export function safePackagePath(name: string): string {
  if (!name || name.length > 240 || /[\\:\x00-\x1f\x7f]/.test(name) || name.startsWith('/')) throw new Error('项目包包含不安全的路径');
  const parts = name.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('项目包包含不安全的 Windows 文件名');
  return name;
}
export function archiveKey(name: string) {
  return safePackagePath(name).normalize('NFC').toLowerCase();
}
export async function openPackageZip(file: string, signal?: AbortSignal) {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.open(file, {
    lazyEntries: true,
    autoClose: false,
    strictFileNames: true,
    validateEntrySizes: true
  }, (e, z) => e ? reject(e) : resolve(z!)));
  try {
    const entries = new Map<string, yauzl.Entry>(),
      keys = new Set<string>();
    let total = 0;
    await new Promise<void>((resolve, reject) => {
      const cancel = () => {
        zip.close();
        reject(new Error('导入已取消'));
      };
      signal?.addEventListener('abort', cancel, {
        once: true
      });
      const fail = (e: unknown) => {
        signal?.removeEventListener('abort', cancel);
        reject(e);
      };
      zip.on('error', fail);
      zip.on('entry', (entry: yauzl.Entry) => {
        try {
          checkCancelled(signal);
          const key = archiveKey(entry.fileName),
            type = entry.externalFileAttributes >>> 16 & 0xf000;
          if (keys.has(key)) throw new Error('项目包含重复或大小写冲突的条目');
          if (type !== 0 && type !== 0x8000) throw new Error('项目包不允许符号链接或特殊文件');
          if (entry.generalPurposeBitFlag & 1 || ![0, 8].includes(entry.compressionMethod)) throw new Error('项目包不支持加密或此压缩方式');
          if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize > PACKAGE_LIMITS.fileBytes) throw new Error('项目包单文件超过限制');
          total += entry.uncompressedSize;
          if (keys.size >= PACKAGE_LIMITS.entries || total > PACKAGE_LIMITS.totalBytes) throw new Error('项目包文件数或展开大小超过限制');
          keys.add(key);
          entries.set(entry.fileName, entry);
          zip.readEntry();
        } catch (e) {
          fail(e);
          zip.close();
        }
      });
      zip.once('end', () => {
        signal?.removeEventListener('abort', cancel);
        resolve();
      });
      checkCancelled(signal);
      zip.readEntry();
    });
    return {
      zip,
      entries,
      total
    };
  } catch (e) {
    zip.close();
    throw e;
  }
}
function entryStream(zip: yauzl.ZipFile, entry: yauzl.Entry) {
  return new Promise<NodeJS.ReadableStream>((resolve, reject) => zip.openReadStream(entry, (e, s) => e ? reject(e) : resolve(s!)));
}
export async function readManifest(zip: yauzl.ZipFile, entry: yauzl.Entry, signal?: AbortSignal) {
  if (entry.uncompressedSize > PACKAGE_LIMITS.manifestBytes) throw new Error('项目包清单过大');
  const stream = await entryStream(zip, entry),
    chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as any) {
    checkCancelled(signal);
    size += chunk.length;
    if (size > PACKAGE_LIMITS.manifestBytes) throw new Error('项目包清单过大');
    chunks.push(chunk);
  }
  return JSON.parse(new TextDecoder('utf-8', {
    fatal: true
  }).decode(Buffer.concat(chunks)));
}
export async function extractEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, root: string, expected: {
  size: number;
  sha256: string;
}, options: JobOptions = {}) {
  const relative = safePackagePath(entry.fileName),
    file = path.join(root, ...relative.split('/'));
  mkdirSync(path.dirname(file), {
    recursive: true
  });
  const hash = createHash('sha256');
  let size = 0;
  const stream = await entryStream(zip, entry);
  await pipeline(stream as any, new Transform({
    transform(chunk: Buffer, _encoding, cb) {
      size += chunk.length;
      if (size > expected.size) {
        cb(new Error('项目包展开大小与清单不符'));
        return;
      }
      hash.update(chunk);
      options.onProgress?.(size, expected.size);
      cb(null, chunk);
    }
  }), createWriteStream(file, {
    flags: 'wx'
  }), {
    signal: options.signal
  });
  if (size !== expected.size || hash.digest('hex') !== expected.sha256) throw new Error(`项目包文件校验失败：${relative}`);
}
export async function writePackageZip(files: Array<{
  path: string;
  file: string;
}>, manifest: Buffer, target: string, options: JobOptions = {}) {
  checkCancelled(options.signal);
  const zip = new yazl.ZipFile(),
    streams = new Set<Readable>();
  let stopping = false;
  let destination: Writable | undefined;
  let output: Promise<void> | undefined;
  const cancel = () => {
    stopping = true;
    for (const stream of streams) stream.destroy();
    (zip.outputStream as Readable).destroy(new Error('项目包导出已取消'));
  };
  options.signal?.addEventListener('abort', cancel, {
    once: true
  });
  zip.on('error', e => {
    stopping = true;
    (zip.outputStream as Readable).destroy(e);
  });
  try {
    // Check every entry before opening the target. Setup failures must not leave
    // an unobserved pipeline running after the caller cleans its staging folder.
    const entries = files.map(item => {
      const entry = safePackagePath(item.path);
      const stat = statSync(item.file);
      if (!stat.isFile()) throw new Error('项目包原件不是文件');
      return { ...item, path: entry, size: stat.size };
    });
    checkCancelled(options.signal);
    destination = createWriteStream(target, { flags: 'wx' });
    output = pipeline(zip.outputStream, destination, { signal: options.signal });
    zip.addBuffer(manifest, 'manifest.json');
    for (const item of entries) zip.addReadStreamLazy(item.path, {
      compress: !item.path.startsWith('assets/'),
      size: item.size
    }, callback => {
      if (stopping || options.signal?.aborted) {
        callback(new Error('项目包导出已取消'), null as any);
        return;
      }
      const stream = createReadStream(item.file);
      stream.on('error', error => {
        if (!stopping) (zip.outputStream as Readable).destroy(error);
      });
      streams.add(stream);
      stream.once('close', () => streams.delete(stream));
      callback(null, stream);
    });
    zip.end();
    await output;
  } catch (error) {
    stopping = true;
    if (output) {
      (zip.outputStream as Readable).destroy(error as Error);
      await output.catch(() => {});
    } else {
      (zip.outputStream as Readable).destroy();
      destination?.destroy();
    }
    throw error;
  } finally {
    stopping = true;
    options.signal?.removeEventListener('abort', cancel);
    await Promise.all([...streams].map(stream => new Promise<void>(resolve => {
      if (stream.closed) {
        resolve();
        return;
      }
      stream.once('close', resolve);
      stream.destroy();
    })));
  }
}
