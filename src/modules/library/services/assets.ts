import { createHash, randomUUID } from 'node:crypto';

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
} from 'node:fs';

import { Transform } from 'node:stream';

import { pipeline } from 'node:stream/promises';

import path from 'node:path';

import { z } from 'zod';

import type { LibraryAsset } from '../../../shared/models';

import { Row, libraryId, openLibrary, transact } from '../database';

import { indexTags } from '../parsing';

import { getLibraryAsset } from '../queries/assets';

import { safeLibraryPath } from '../storage-paths';

export const kinds: Record<string, 'image' | 'video' | 'audio'> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio',
};

export function updateLibraryAsset(
  root: string,
  id: string,
  input: {
    name?: string;
    tags?: string;
    starred?: boolean;
    durationMs?: number;
    palette?: string[];
  },
): LibraryAsset {
  const data = z
    .object({
      name: z.string().trim().min(1).max(300).optional(),
      tags: z.string().max(500).optional(),
      starred: z.boolean().optional(),
      durationMs: z.number().int().positive().max(86400000).optional(),
      palette: z
        .array(z.string().regex(/^#[0-9a-f]{6}$/i))
        .max(6)
        .optional(),
    })
    .parse(input);
  const db = openLibrary(root, false);
  try {
    transact(db, () => {
      const row = db.prepare('SELECT * FROM assets WHERE id=?').get(id) as
        | Row
        | undefined;
      if (!row) throw new Error('素材不存在');
      db.prepare(
        'UPDATE assets SET name=?,tags=?,starred=?,duration_ms=?,palette_json=? WHERE id=?',
      ).run(
        data.name ?? row.name,
        data.tags ?? row.tags,
        data.starred === undefined ? row.starred : data.starred ? 1 : 0,
        data.durationMs ?? row.duration_ms,
        data.palette ? JSON.stringify(data.palette) : row.palette_json,
        id,
      );
      if (data.tags !== undefined) indexTags(db, 'asset_tags', id, data.tags);
    });
  } finally {
    db.close();
  }
  return getLibraryAsset(root, id);
}

export async function importLibraryAsset(
  root: string,
  source: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (copied: number, total: number) => void;
  } = {},
): Promise<LibraryAsset> {
  const kind = kinds[path.extname(source).toLowerCase()];
  if (!kind) throw new Error('暂不支持此素材格式');
  const size = statSync(source).size;
  if (!size || size > 10 * 1024 ** 3) throw new Error('文件为空或超过 10 GB');
  const id = libraryId(root),
    job = randomUUID(),
    folder = path.join(root, 'jobs');
  mkdirSync(folder, {
    recursive: true,
  });
  const space = statfsSync(root);
  if (space.bavail * space.bsize < size + 64 * 1024 ** 2)
    throw new Error('全局库磁盘空间不足');
  const temporary = path.join(folder, `${job}.partial`),
    db = openLibrary(root);
  db.prepare(
    'INSERT INTO operations(operation_id,kind,stage) VALUES (?,?,?)',
  ).run(job, 'import', 'copying');
  db.close();
  try {
    const digest = createHash('sha256');
    let copied = 0,
      last = 0;
    await pipeline(
      createReadStream(source),
      new Transform({
        transform(chunk: Buffer, _enc, callback) {
          copied += chunk.length;
          digest.update(chunk);
          if (Date.now() - last >= 100 || copied === size) {
            options.onProgress?.(copied, size);
            last = Date.now();
          }
          callback(null, chunk);
        },
      }),
      createWriteStream(temporary, {
        flags: 'wx',
      }),
      {
        signal: options.signal,
      },
    );
    if (options.signal?.aborted) throw new Error('导入已取消');
    if (statSync(temporary).size !== size) throw new Error('复制不完整');
    const hash = digest.digest('hex'),
      connection = openLibrary(root);
    let assetId: string;
    try {
      assetId = transact(connection, () => {
        const existing = connection
          .prepare(
            'SELECT id FROM assets WHERE blob_sha256=? ORDER BY imported_at LIMIT 1',
          )
          .get(hash) as Row | undefined;
        const blob = connection
          .prepare('SELECT relative_path FROM blobs WHERE sha256=?')
          .get(hash) as Row | undefined;
        const relative =
            blob?.relative_path ??
            path.join(
              'objects',
              hash.slice(0, 2),
              `${hash}${path.extname(source).toLowerCase()}`,
            ),
          destination = safeLibraryPath(root, relative);
        mkdirSync(path.dirname(destination), {
          recursive: true,
        });
        if (!existsSync(destination)) renameSync(temporary, destination);
        else
          rmSync(temporary, {
            force: true,
          });
        connection
          .prepare('INSERT OR IGNORE INTO blobs VALUES (?,?,?)')
          .run(hash, relative, size);
        const newId = existing?.id ?? randomUUID();
        if (!existing)
          connection
            .prepare(
              'INSERT INTO assets(id,blob_sha256,name,kind,imported_at) VALUES (?,?,?,?,?)',
            )
            .run(
              newId,
              hash,
              path.basename(source),
              kind,
              new Date().toISOString(),
            );
        else
          connection
            .prepare('UPDATE assets SET hidden=0 WHERE id=?')
            .run(newId);
        connection
          .prepare(
            "UPDATE operations SET stage='done',mapping_json=? WHERE operation_id=?",
          )
          .run(
            JSON.stringify({
              assetId: newId,
              libraryId: id,
            }),
            job,
          );
        return newId;
      });
    } finally {
      connection.close();
    }
    return getLibraryAsset(root, assetId);
  } catch (error) {
    const connection = openLibrary(root);
    try {
      connection
        .prepare('UPDATE operations SET stage=?,error=? WHERE operation_id=?')
        .run(
          options.signal?.aborted ? 'cancelled' : 'failed',
          error instanceof Error ? error.message : String(error),
          job,
        );
    } finally {
      connection.close();
    }
    throw error;
  } finally {
    rmSync(temporary, {
      force: true,
    });
  }
}

export function recoverLibraryJobs(root: string): void {
  const db = openLibrary(root);
  try {
    const jobs = db
      .prepare(
        "SELECT operation_id FROM operations WHERE kind='import' AND stage='copying'",
      )
      .all() as Row[];
    for (const job of jobs) {
      if (/^[0-9a-f-]{36}$/i.test(job.operation_id))
        rmSync(path.join(root, 'jobs', `${job.operation_id}.partial`), {
          force: true,
        });
      db.prepare(
        "UPDATE operations SET stage='interrupted',error='上次导入中断，请重新选择源文件' WHERE operation_id=?",
      ).run(job.operation_id);
    }
  } finally {
    db.close();
  }
}

export async function relinkLibraryAsset(
  root: string,
  id: string,
  source: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (copied: number, total: number) => void;
  } = {},
): Promise<LibraryAsset> {
  const asset = getLibraryAsset(root, id);
  if (!asset.missing) throw new Error('此素材原件并未缺失');
  const digest = createHash('sha256');
  let copied = 0;
  const total = statSync(source).size;
  for await (const chunk of createReadStream(source)) {
    if (options.signal?.aborted) throw new Error('重新定位已取消');
    digest.update(chunk);
    copied += chunk.length;
    options.onProgress?.(copied, total);
  }
  if (digest.digest('hex') !== asset.sha256)
    throw new Error(
      '所选文件内容与原件不同，请作为新素材导入；其他项目的引用未修改',
    );
  const restored = await importLibraryAsset(root, source, options);
  if (restored.sha256 !== asset.sha256)
    throw new Error('源文件在复制期间发生变化，请重试');
  return getLibraryAsset(root, id);
}
