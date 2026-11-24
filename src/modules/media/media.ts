import { Worker } from 'node:worker_threads';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { getLibraryAsset, openLibrary } from '../library/index';
import { readProject, mutateProject } from '../project/index';
import { resolveProjectAsset } from '../workspace/index';
import { checkCancelled, containedFile, type JobOptions } from '../../infrastructure/jobs/file-jobs';
import { metadataSchema } from '../../shared/document';
import { failedMedia } from '../../shared/media';
import type { MediaMetadata } from '../../shared/models';
let wasm = path.resolve('node_modules/mediainfo.js/dist/MediaInfoModule.wasm');
export function configureMedia(file: string) {
  wasm = file;
}
export async function probeFile(file: string, options: JobOptions = {}): Promise<MediaMetadata> {
  checkCancelled(options.signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'probe-worker.cjs'), {
      workerData: {
        file,
        wasm
      },
      resourceLimits: {
        maxOldGenerationSizeMb: 128
      }
    });
    let complete = false;
    const finish = (error: unknown, result?: unknown) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
      void worker.terminate();
      if (options.signal?.aborted) reject(new Error('媒体探测已取消'));else if (error) resolve(failedMedia(error));else {
        const parsed = metadataSchema.safeParse(result);
        resolve(parsed.success ? parsed.data : failedMedia('媒体探测结果无效'));
      }
    };
    const cancel = () => finish(new Error('媒体探测已取消'));
    const timer = setTimeout(() => finish(new Error('媒体探测超过 15 秒，原件仍保留')), 15000);
    options.signal?.addEventListener('abort', cancel, {
      once: true
    });
    worker.once('message', message => finish(message.error, message.result));
    worker.once('error', finish);
    worker.once('exit', code => {
      if (!complete) finish(new Error(`媒体探测进程退出（${code}）`));
    });
  });
}
export async function probeLibraryAsset(root: string, id: string, options: JobOptions = {}) {
  const asset = getLibraryAsset(root, id),
    file = path.join(root, asset.relativePath);
  const metadata = existsSync(file) ? await probeFile(containedFile(root, file), options) : failedMedia('原件缺失');
  checkCancelled(options.signal);
  const db = openLibrary(root, false);
  try {
    db.exec('BEGIN IMMEDIATE');
    db.prepare('INSERT INTO asset_metadata VALUES (?,?) ON CONFLICT(asset_id) DO UPDATE SET payload_json=excluded.payload_json').run(id, JSON.stringify(metadata));
    if (metadata.durationMs) db.prepare('UPDATE assets SET duration_ms=? WHERE id=?').run(metadata.durationMs, id);
    db.exec('COMMIT');
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  } finally {
    db.close();
  }
  return metadata;
}
export async function probeProject(directory: string, root: string, options: JobOptions = {}) {
  const project = readProject(directory);
  let completed = 0;
  for (const asset of project.assets) {
    checkCancelled(options.signal);
    const file = resolveProjectAsset(directory, asset, root);
    const metadata = file && existsSync(file) ? await probeFile(containedFile(asset.storageKind === 'local' ? directory : root, file), options) : failedMedia('原件缺失或全局库离线');
    checkCancelled(options.signal);
    mutateProject(directory, db => {
      db.prepare('INSERT INTO asset_metadata VALUES (?,?) ON CONFLICT(asset_id) DO UPDATE SET payload_json=excluded.payload_json').run(asset.id, JSON.stringify(metadata));
      db.prepare('UPDATE assets SET duration_ms=COALESCE(?,duration_ms) WHERE id=?').run(metadata.durationMs, asset.id);
    });
    options.onProgress?.(++completed, project.assets.length);
  }
  return readProject(directory);
}
