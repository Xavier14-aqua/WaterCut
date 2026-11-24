import { DatabaseSync } from 'node:sqlite';

import { randomUUID } from 'node:crypto';

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';

import path from 'node:path';

import { z } from 'zod';

import * as projects from '../../project/index';

import {
  projectDocument,
  type ProjectDocument,
} from '../../../shared/document';

import type {
  Asset,
  PackageOptions,
  PackageResult,
  Revision,
} from '../../../shared/models';

import { resolveProjectAsset } from '../../workspace/index';

import { getLibraryAsset } from '../../library/index';

import {
  backupProjectDatabase,
  insertRevision,
  readRevision,
  writeDocument,
} from '../revisions';

import {
  writePackageZip,
  PACKAGE_LIMITS,
} from '../../../infrastructure/files/package-zip';

import {
  assertSpace,
  checkCancelled,
  containedFile,
  copyWithHash,
  hashFile,
  removeJobDirectory,
  type JobOptions,
} from '../../../infrastructure/jobs/file-jobs';

import { Missing, manifestSchema } from './manifest';

export async function exportPackage(
  directory: string,
  libraryRoot: string,
  target: string,
  input: PackageOptions,
  options: JobOptions = {},
): Promise<PackageResult> {
  const settings = z
    .object({
      includeHistory: z.boolean(),
      includeMedia: z.boolean(),
    })
    .parse(input);
  if (path.extname(target).toLowerCase() !== '.zip')
    throw new Error('请选择 .zip 项目包文件');
  const parent = path.dirname(path.resolve(target));
  assertSpace(parent, 8 * 1024 * 1024);
  checkCancelled(options.signal);
  const stage = mkdtempSync(path.join(parent, '.watercut-export-'));
  try {
    const raw = path.join(stage, 'source.watercut');
    mkdirSync(raw);
    backupProjectDatabase(directory, path.join(raw, 'project.sqlite'));
    const source = projects.readProject(raw, true),
      current = projectDocument(source);
    for (const asset of current.assets)
      if (asset.storageKind === 'library' && asset.sourceAssetId) {
        try {
          const global = getLibraryAsset(libraryRoot, asset.sourceAssetId);
          if (global.libraryId === asset.sourceLibraryId) {
            asset.metadata ??= global.metadata;
            asset.durationMs ??= global.durationMs;
          }
        } catch {}
      }
    const history: Array<{
      revision: Revision;
      document: ProjectDocument;
    }> = [];
    const sourceDb = new DatabaseSync(path.join(raw, 'project.sqlite'), {
      readOnly: true,
      allowExtension: false,
    });
    try {
      if (settings.includeHistory) {
        const rows = sourceDb
          .prepare('SELECT id FROM revisions ORDER BY created_at,rowid')
          .all() as any[];
        if (rows.length > 500) throw new Error('项目历史过多');
        for (const row of rows) history.push(readRevision(sourceDb, row.id));
      }
    } finally {
      sourceDb.close();
    }
    const docs = [current, ...history.map((r) => r.document)],
      mediaBytes = docs.reduce(
        (n, d) => n + d.assets.reduce((s, a) => s + a.size, 0),
        0,
      );
    if (settings.includeMedia)
      assertSpace(
        parent,
        mediaBytes + statSync(path.join(raw, 'project.sqlite')).size * 2,
      );
    const project = projects.createProject(stage, current.name),
      assetsFolder = path.join(project.directory, 'assets');
    mkdirSync(assetsFolder);
    const mediaFiles = new Map<
        string,
        {
          path: string;
          file: string;
          size: number;
          sha256: string;
        }
      >(),
      processed = new Map<string, Asset>(),
      missing: Missing[] = [];
    let count = 0;
    const total = docs.reduce((n, d) => n + d.assets.length, 0);
    for (const doc of docs) {
      for (let index = 0; index < doc.assets.length; index++) {
        checkCancelled(options.signal);
        const original = doc.assets[index],
          cacheKey = JSON.stringify([
            original.id,
            original.sha256,
            original.relativePath,
            original.sourceLibraryId,
            original.sourceAssetId,
          ]);
        let converted = processed.get(cacheKey);
        if (!converted) {
          const ext = /^\.(mp4|mov|webm|png|jpe?g|gif|webp|mp3|wav|m4a)$/i.test(
            path.extname(original.name),
          )
            ? path.extname(original.name).toLowerCase()
            : '.bin';
          converted = {
            ...original,
            storageKind: 'local',
            sourceLibraryId: null,
            sourceAssetId: null,
            relativePath: `assets/missing-${original.id}${ext}`,
            thumbnail: false,
            missing: true,
          };
          let reason = settings.includeMedia
            ? '原件缺失或所属总库离线'
            : '导出时未包含原件';
          const file = settings.includeMedia
            ? resolveProjectAsset(directory, original, libraryRoot)
            : null;
          if (file && existsSync(file)) {
            const actual = containedFile(
                original.storageKind === 'local' ? directory : libraryRoot,
                file,
              ),
              temporary = path.join(assetsFolder, `${randomUUID()}.partial`);
            const copied = await copyWithHash(actual, temporary, {
              signal: options.signal,
            });
            if (original.sha256 && copied.sha256 !== original.sha256) {
              rmSync(temporary);
              reason = '原件指纹不匹配';
            } else {
              const known = mediaFiles.get(copied.sha256),
                relative = known?.path ?? `assets/${copied.sha256}${ext}`,
                destination = path.join(
                  project.directory,
                  ...relative.split('/'),
                );
              if (known) rmSync(temporary);
              else {
                renameSync(temporary, destination);
                mediaFiles.set(copied.sha256, {
                  path: relative,
                  file: destination,
                  ...copied,
                });
              }
              converted = {
                ...converted,
                relativePath: relative,
                sha256: copied.sha256,
                size: copied.size,
                missing: false,
              };
            }
          }
          if (converted.missing)
            missing.push({
              assetId: original.id,
              name: original.name,
              reason,
              path: converted.relativePath,
            });
          processed.set(cacheKey, converted);
        }
        // Deduplicate bytes, while preserving each historical asset's labels,
        // metadata and local edits from that document version.
        doc.assets[index] = {
          ...original,
          storageKind: 'local',
          sourceLibraryId: null,
          sourceAssetId: null,
          relativePath: converted.relativePath,
          sha256: converted.sha256,
          size: converted.size,
          missing: converted.missing,
          thumbnail: false,
        };
        options.onProgress?.(++count, Math.max(1, total));
      }
      for (const idea of doc.ideas) {
        // The package carries a local source copy; no live global select dependency.
        idea.sourceLibraryId = null;
        idea.sourceIdeaId = null;
        idea.sourceVersion = null;
      }
      for (const binding of doc.shotAssets) {
        binding.sourceSelectId = null;
        binding.sourceSelectVersion = null;
      }
    }
    const db = projects.openDatabase(project.directory);
    try {
      db.exec('BEGIN IMMEDIATE');
      writeDocument(db, current);
      db.prepare('UPDATE project SET id=?').run(source.id);
      for (const item of history)
        insertRevision(db, item.revision, item.document);
      db.exec('DELETE FROM commands; COMMIT;');
      if (
        (db.prepare('PRAGMA integrity_check').get() as any).integrity_check !==
        'ok'
      )
        throw new Error('导出副本完整性检查失败');
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw e;
    } finally {
      db.close();
    }
    const dbFile = path.join(project.directory, 'project.sqlite');
    if (statSync(dbFile).size > PACKAGE_LIMITS.databaseBytes)
      throw new Error('项目数据库超过 256 MB，请减少快照后再导出');
    const files = [
      {
        path: 'project.sqlite',
        file: dbFile,
        size: statSync(dbFile).size,
        sha256: await hashFile(dbFile, options.signal),
      },
      ...mediaFiles.values(),
    ];
    const manifest = manifestSchema.parse({
      format: 'WaterCutProject',
      packageVersion: 1,
      projectFormatVersion: projects.CURRENT_VERSION,
      projectId: source.id,
      createdAt: new Date().toISOString(),
      ...settings,
      complete: missing.length === 0,
      files: files.map(({ path, size, sha256 }) => ({
        path,
        size,
        sha256,
      })),
      missing,
    });
    checkCancelled(options.signal);
    const temporaryZip = path.join(stage, 'package.partial');
    await writePackageZip(
      files,
      Buffer.from(JSON.stringify(manifest, null, 2)),
      temporaryZip,
      options,
    );
    checkCancelled(options.signal);
    renameSync(temporaryZip, path.resolve(target));
    return {
      file: path.resolve(target),
      complete: manifest.complete,
      missing: manifest.missing,
      fileCount: files.length,
    };
  } finally {
    removeJobDirectory(stage, parent, '.watercut-export-');
  }
}
