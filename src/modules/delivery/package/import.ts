import { DatabaseSync } from 'node:sqlite';

import { existsSync, mkdirSync, mkdtempSync, renameSync } from 'node:fs';

import path from 'node:path';

import { z } from 'zod';

import * as projects from '../../project/index';

import { type ProjectDocument } from '../../../shared/document';

import type { Revision } from '../../../shared/models';

import { insertRevision, readRevision, writeDocument } from '../revisions';

import {
  archiveKey,
  extractEntry,
  openPackageZip,
  readManifest,
  safePackagePath,
  PACKAGE_LIMITS,
} from '../../../infrastructure/files/package-zip';

import {
  assertSpace,
  checkCancelled,
  hashFile,
  removeJobDirectory,
  type JobOptions,
} from '../../../infrastructure/jobs/file-jobs';

import { fileSchema, manifestSchema } from './manifest';

import { validateDatabaseBounds } from './validation';

import { independentDocument } from './document';

export async function importPackage(
  file: string,
  projectsRoot: string,
  options: JobOptions = {},
) {
  checkCancelled(options.signal);
  const opened = await openPackageZip(file, options.signal);
  let stage: string | undefined;
  try {
    const manifestEntry = opened.entries.get('manifest.json');
    if (!manifestEntry) throw new Error('缺少 WaterCut 项目包清单');
    const manifest = manifestSchema.parse(
      await readManifest(opened.zip, manifestEntry, options.signal),
    );
    if (manifest.complete !== (manifest.missing.length === 0))
      throw new Error('项目包完整性标记不一致');
    const files = new Map<string, z.infer<typeof fileSchema>>(),
      keys = new Set<string>();
    for (const item of manifest.files) {
      const key = archiveKey(item.path);
      if (keys.has(key)) throw new Error('项目包清单路径重复');
      keys.add(key);
      if (
        item.path !== 'project.sqlite' &&
        !/^assets\/[a-f0-9]{64}\.[a-z0-9]+$/.test(item.path)
      )
        throw new Error('项目包包含不支持的文件');
      if (
        item.path === 'project.sqlite' &&
        item.size > PACKAGE_LIMITS.databaseBytes
      )
        throw new Error('项目包数据库超过 256 MB');
      files.set(item.path, item);
      const entry = opened.entries.get(item.path);
      if (!entry || entry.uncompressedSize !== item.size)
        throw new Error('项目包内容与清单不一致');
    }
    if (!files.has('project.sqlite') || files.size + 1 !== opened.entries.size)
      throw new Error('项目包存在清单外条目或缺少数据库');
    for (const m of manifest.missing)
      if (!safePackagePath(m.path).startsWith('assets/'))
        throw new Error('缺失素材路径无效');
    mkdirSync(projectsRoot, {
      recursive: true,
    });
    assertSpace(
      projectsRoot,
      opened.total + files.get('project.sqlite')!.size * 3,
    );
    stage = mkdtempSync(
      path.join(path.resolve(projectsRoot), '.watercut-import-'),
    );
    const raw = path.join(stage, 'incoming.watercut');
    mkdirSync(raw);
    let done = 0;
    for (const item of manifest.files) {
      checkCancelled(options.signal);
      await extractEntry(
        opened.zip,
        opened.entries.get(item.path)!,
        raw,
        item,
        {
          signal: options.signal,
        },
      );
      options.onProgress?.(++done, manifest.files.length);
    }
    const db = new DatabaseSync(path.join(raw, 'project.sqlite'), {
      readOnly: true,
      allowExtension: false,
    });
    let history: Array<{
      revision: Revision;
      document: ProjectDocument;
    }> = [];
    try {
      db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
      const version = (db.prepare('PRAGMA user_version').get() as any)
        .user_version;
      if (
        ![9, 10, projects.CURRENT_VERSION].includes(version) ||
        version !== manifest.projectFormatVersion
      )
        throw new Error('项目包数据库格式不受支持或与清单不一致');
      validateDatabaseBounds(db, version);
      if (
        (db.prepare('PRAGMA integrity_check').get() as any).integrity_check !==
          'ok' ||
        db.prepare('PRAGMA foreign_key_check').all().length
      )
        throw new Error('项目包数据库完整性检查失败');
      const ids = db.prepare('SELECT id FROM revisions').all() as any[];
      if (ids.length > 500 || (!manifest.includeHistory && ids.length))
        throw new Error('项目包历史与声明不一致');
      history = ids.map((row) => readRevision(db, row.id));
    } finally {
      db.close();
    }
    const incoming = projects.readProject(raw, true);
    if (incoming.id !== manifest.projectId)
      throw new Error('项目包身份与清单不一致');
    const current = independentDocument(
      incoming,
      new Set(files.keys()),
      manifest.missing,
    );
    for (const h of history)
      h.document = independentDocument(
        h.document,
        new Set(files.keys()),
        manifest.missing,
      );
    for (const doc of [current, ...history.map((h) => h.document)])
      for (const asset of doc.assets) {
        const item = files.get(asset.relativePath);
        if (item && (asset.size !== item.size || asset.sha256 !== item.sha256))
          throw new Error('素材描述与文件指纹不一致');
      }
    checkCancelled(options.signal);
    const result = projects.createProject(stage, current.name),
      trusted = projects.openDatabase(result.directory);
    try {
      trusted.exec('BEGIN IMMEDIATE');
      writeDocument(trusted, current);
      for (const h of history) insertRevision(trusted, h.revision, h.document);
      trusted
        .prepare('INSERT INTO project_origin VALUES (?,?,?)')
        .run(
          manifest.projectId,
          await hashFile(file, options.signal),
          new Date().toISOString(),
        );
      trusted.exec('COMMIT');
    } catch (e) {
      if (trusted.isTransaction) trusted.exec('ROLLBACK');
      throw e;
    } finally {
      trusted.close();
    }
    if (existsSync(path.join(raw, 'assets')))
      renameSync(
        path.join(raw, 'assets'),
        path.join(result.directory, 'assets'),
      );
    const final = path.join(
      path.resolve(projectsRoot),
      `${result.id}.watercut`,
    );
    checkCancelled(options.signal);
    renameSync(result.directory, final);
    return projects.readProject(final);
  } finally {
    opened.zip.close();
    if (stage)
      removeJobDirectory(
        stage,
        path.resolve(projectsRoot),
        '.watercut-import-',
      );
  }
}
