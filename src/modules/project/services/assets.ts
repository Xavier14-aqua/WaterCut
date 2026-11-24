import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statfsSync,
  statSync,
} from 'node:fs';

import path from 'node:path';

import { createHash, randomUUID } from 'node:crypto';

import { Transform } from 'node:stream';

import { pipeline } from 'node:stream/promises';

import { z } from 'zod';

import { uuid } from '../../../shared/schemas';

import type { Asset, Project, LibraryAsset } from '../../../shared/models';

import { localAssetPath, openDatabase } from '../database';

import { readProject } from '../repositories/read-project';

import { mutateProject } from '../transaction';

import { attachAssetRow } from '../repositories/asset-rows';

export const mediaTypes: Record<string, Asset['kind']> = {
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

export function cleanupPartialAssets(directory: string): number {
  const db = openDatabase(directory);
  const folder = path.join(directory, 'assets');
  if (!existsSync(folder)) {
    db.close();
    return 0;
  }
  let removed = 0;
  try {
    for (const name of readdirSync(folder)) {
      if (
        /^(?:[0-9a-f-]{36}|[0-9a-f]{64})\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|m4a|bin)\.partial$/i.test(
          name,
        )
      ) {
        rmSync(path.join(folder, name), {
          force: true,
        });
        removed++;
      } else if (
        /^(?:[0-9a-f-]{36}|[0-9a-f]{64})\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|m4a|bin)\.delete-pending$/i.test(
          name,
        )
      ) {
        const original = name.slice(0, -'.delete-pending'.length);
        const record = db
          .prepare('SELECT 1 FROM assets WHERE relative_path IN (?,?)')
          .get(path.join('assets', original), `assets/${original}`);
        if (record && !existsSync(path.join(folder, original)))
          renameSync(path.join(folder, name), path.join(folder, original));
        else {
          rmSync(path.join(folder, name), {
            force: true,
          });
          removed++;
        }
      }
    }
  } finally {
    db.close();
  }
  return removed;
}

export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function importAsset(
  directory: string,
  source: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (copied: number, total: number) => void;
  } = {},
): Promise<Project> {
  const kind = mediaTypes[path.extname(source).toLowerCase()];
  if (!kind) throw new Error('暂不支持此文件格式');
  const size = statSync(source).size;
  if (!size || size > 10 * 1024 ** 3) throw new Error('文件为空或超过 10 GB');
  openDatabase(directory).close();
  const free = statfsSync(directory);
  if (free.bavail * free.bsize < size + 64 * 1024 * 1024)
    throw new Error('项目所在磁盘剩余空间不足');
  const id = randomUUID();
  const assetsDir = path.join(directory, 'assets');
  mkdirSync(assetsDir, {
    recursive: true,
  });
  const relativePath = path.join(
    'assets',
    `${id}${path.extname(source).toLowerCase()}`,
  );
  const destination = path.join(directory, relativePath);
  const temporary = `${destination}.partial`;
  try {
    let copied = 0;
    let lastReport = 0;
    const digest = createHash('sha256');
    await pipeline(
      createReadStream(source),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          copied += chunk.length;
          digest.update(chunk);
          const now = Date.now();
          if (!lastReport || now - lastReport >= 100 || copied === size) {
            options.onProgress?.(copied, size);
            lastReport = now;
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
    if (statSync(temporary).size !== size) throw new Error('素材复制不完整');
    const checksum = digest.digest('hex');
    for (const existing of readProject(directory).assets) {
      if (options.signal?.aborted) throw new Error('导入已取消');
      if (
        existing.size === size &&
        !existing.missing &&
        (await hashFile(path.join(directory, existing.relativePath))) ===
          checksum
      )
        throw new Error(`素材已在项目中：${existing.name}`);
    }
    if (options.signal?.aborted) throw new Error('导入已取消');
    renameSync(temporary, destination);
    const db = openDatabase(directory);
    try {
      db.prepare(
        'INSERT INTO assets (id,name,kind,relative_path,size,sha256,imported_at) VALUES (?,?,?,?,?,?,?)',
      ).run(
        id,
        path.basename(source),
        kind,
        relativePath,
        size,
        checksum,
        new Date().toISOString(),
      );
    } finally {
      db.close();
    }
  } catch (error) {
    rmSync(temporary, {
      force: true,
    });
    rmSync(destination, {
      force: true,
    });
    throw error;
  }
  return readProject(directory);
}

export async function relinkAsset(
  directory: string,
  assetId: string,
  source: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (copied: number, total: number) => void;
  } = {},
): Promise<Project> {
  const project = readProject(directory);
  const asset = project.assets.find((item) => item.id === assetId);
  if (!asset || !asset.missing) throw new Error('只能重新定位缺失素材');
  if (asset.storageKind === 'library')
    throw new Error('共享素材请从全局库重新定位原件');
  if (
    path.extname(source).toLowerCase() !==
    path.extname(asset.relativePath).toLowerCase()
  )
    throw new Error('请选择相同扩展名的素材');
  const size = statSync(source).size;
  if (!size || size > 10 * 1024 ** 3) throw new Error('文件为空或超过 10 GB');
  const destination = path.join(directory, asset.relativePath);
  const temporary = `${destination}.partial`;
  let renamed = false;
  try {
    let copied = 0;
    let lastReport = 0;
    await pipeline(
      createReadStream(source),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          copied += chunk.length;
          const now = Date.now();
          if (!lastReport || now - lastReport >= 100 || copied === size) {
            options.onProgress?.(copied, size);
            lastReport = now;
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
    if (options.signal?.aborted) throw new Error('重新定位已取消');
    if (statSync(temporary).size !== size) throw new Error('素材复制不完整');
    if (existsSync(destination))
      throw new Error('素材文件已重新出现，请重新打开项目');
    const checksum = await hashFile(temporary);
    if (asset.sha256 && checksum !== asset.sha256)
      throw new Error('文件内容与原素材指纹不符，请将不同内容作为新素材导入');
    renameSync(temporary, destination);
    renamed = true;
    const db = openDatabase(directory);
    try {
      db.prepare(
        'UPDATE assets SET name = ?, size = ?, sha256=? WHERE id = ?',
      ).run(path.basename(source), size, checksum, assetId);
    } finally {
      db.close();
    }
    rmSync(path.join(directory, 'thumbnails', `${assetId}.png`), {
      force: true,
    });
  } catch (error) {
    rmSync(temporary, {
      force: true,
    });
    if (renamed)
      rmSync(destination, {
        force: true,
      });
    throw error;
  }
  return readProject(directory);
}

export function updateAssetTags(
  directory: string,
  assetId: string,
  tagsInput: unknown,
): Project {
  const tags = z.string().max(500).parse(tagsInput);
  const db = openDatabase(directory);
  try {
    const result = db
      .prepare('UPDATE assets SET tags = ? WHERE id = ?')
      .run(tags, assetId);
    if (result.changes !== 1) throw new Error('素材不存在');
  } finally {
    db.close();
  }
  return readProject(directory);
}

export function deleteAsset(directory: string, assetId: string): Project {
  const db = openDatabase(directory);
  const row = db
    .prepare('SELECT relative_path FROM assets WHERE id = ?')
    .get(assetId) as
    | {
        relative_path: string;
      }
    | undefined;
  if (!row) {
    db.close();
    throw new Error('素材不存在');
  }
  const file = row.relative_path
    ? localAssetPath(directory, row.relative_path)
    : '';
  const parked = `${file}.delete-pending`;
  let moved = false;
  try {
    const retained =
      !!db
        .prepare('SELECT 1 FROM revision_media_refs WHERE asset_id=? LIMIT 1')
        .get(assetId) ||
      !!db
        .prepare('SELECT 1 FROM assets WHERE id<>? AND relative_path=? LIMIT 1')
        .get(assetId, row.relative_path);
    if (!retained && existsSync(file)) {
      renameSync(file, parked);
      moved = true;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        'UPDATE ideas SET source_asset_id = NULL WHERE source_asset_id = ?',
      ).run(assetId);
      db.prepare('DELETE FROM idea_media WHERE asset_id=?').run(assetId);
      db.prepare('DELETE FROM shot_assets WHERE asset_id = ?').run(assetId);
      db.prepare('DELETE FROM shot_audio WHERE asset_id = ?').run(assetId);
      db.prepare('DELETE FROM shot_candidates WHERE asset_id = ?').run(assetId);
      db.prepare('DELETE FROM assets WHERE id = ?').run(assetId);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } catch (error) {
    if (moved) renameSync(parked, file);
    throw error;
  } finally {
    db.close();
  }
  if (moved) {
    try {
      rmSync(parked, {
        force: true,
      });
    } catch {
      /* clean on next project open */
    }
  }
  try {
    rmSync(path.join(directory, 'thumbnails', `${assetId}.png`), {
      force: true,
    });
  } catch {
    /* cache cleanup can be retried later */
  }
  return readProject(directory);
}

export function updateAssetDuration(
  directory: string,
  id: string,
  durationMs: number,
): Project {
  return mutateProject(directory, (db) => {
    db.prepare('UPDATE assets SET duration_ms=? WHERE id=?').run(
      z.number().int().positive().max(86400000).parse(durationMs),
      uuid.parse(id),
    );
  });
}

export function attachLibraryAssets(
  directory: string,
  assets: LibraryAsset[],
): Project {
  return mutateProject(directory, (db) => {
    for (const a of assets) attachAssetRow(db, a);
  });
}
