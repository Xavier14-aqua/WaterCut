import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import * as projects from './project';
import { projectDocument, validateDocument, type ProjectDocument } from './shared/document';
import type { Asset, PackageOptions, PackageResult, Revision } from './shared/models';
import { resolveProjectAsset } from './workspace';
import { getLibraryAsset } from './library';
import { backupProjectDatabase, insertRevision, readRevision, writeDocument } from './revisions';
import { archiveKey, extractEntry, openPackageZip, readManifest, safePackagePath, writePackageZip, PACKAGE_LIMITS } from './package-zip';
import { assertSpace, checkCancelled, containedFile, copyWithHash, hashFile, removeJobDirectory, type JobOptions } from './file-jobs';
const fileSchema = z.object({
  path: z.string().max(240),
  size: z.number().int().nonnegative().max(PACKAGE_LIMITS.fileBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
});
const manifestSchema = z.object({
  format: z.literal('WaterCutProject'),
  packageVersion: z.literal(1),
  projectFormatVersion: z.union([z.literal(9), z.literal(10),z.literal(11)]),
  projectId: z.string().uuid(),
  createdAt: z.string().datetime(),
  includeHistory: z.boolean(),
  includeMedia: z.boolean(),
  complete: z.boolean(),
  files: z.array(fileSchema).max(PACKAGE_LIMITS.entries - 1),
  missing: z.array(z.object({
    assetId: z.string().uuid(),
    name: z.string().max(1024),
    reason: z.string().max(256),
    path: z.string().max(240)
  })).max(50000)
});
type Missing = z.infer<typeof manifestSchema>['missing'][number];
export async function exportPackage(directory: string, libraryRoot: string, target: string, input: PackageOptions, options: JobOptions = {}): Promise<PackageResult> {
  const settings = z.object({
    includeHistory: z.boolean(),
    includeMedia: z.boolean()
  }).parse(input);
  if (path.extname(target).toLowerCase() !== '.zip') throw new Error('请选择 .zip 项目包文件');
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
    for (const asset of current.assets) if (asset.storageKind === 'library' && asset.sourceAssetId) {
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
      allowExtension: false
    });
    try {
      if (settings.includeHistory) {
        const rows = sourceDb.prepare('SELECT id FROM revisions ORDER BY created_at,rowid').all() as any[];
        if (rows.length > 500) throw new Error('项目历史过多');
        for (const row of rows) history.push(readRevision(sourceDb, row.id));
      }
    } finally {
      sourceDb.close();
    }
    const docs = [current, ...history.map(r => r.document)],
      mediaBytes = docs.reduce((n, d) => n + d.assets.reduce((s, a) => s + a.size, 0), 0);
    if (settings.includeMedia) assertSpace(parent, mediaBytes + statSync(path.join(raw, 'project.sqlite')).size * 2);
    const project = projects.createProject(stage, current.name),
      assetsFolder = path.join(project.directory, 'assets');
    mkdirSync(assetsFolder);
    const mediaFiles = new Map<string, {
        path: string;
        file: string;
        size: number;
        sha256: string;
      }>(),
      processed = new Map<string, Asset>(),
      missing: Missing[] = [];
    let count = 0;
    const total = docs.reduce((n, d) => n + d.assets.length, 0);
    for (const doc of docs) {
      for (let index = 0; index < doc.assets.length; index++) {
        checkCancelled(options.signal);
        const original = doc.assets[index],
          cacheKey = JSON.stringify([original.id, original.sha256, original.relativePath, original.sourceLibraryId, original.sourceAssetId]);
        let converted = processed.get(cacheKey);
        if (!converted) {
          const ext = /^\.(mp4|mov|webm|png|jpe?g|gif|webp|mp3|wav|m4a)$/i.test(path.extname(original.name)) ? path.extname(original.name).toLowerCase() : '.bin';
          converted = {
            ...original,
            storageKind: 'local',
            sourceLibraryId: null,
            sourceAssetId: null,
            relativePath: `assets/missing-${original.id}${ext}`,
            thumbnail: false,
            missing: true
          };
          let reason = settings.includeMedia ? '原件缺失或所属总库离线' : '导出时未包含原件';
          const file = settings.includeMedia ? resolveProjectAsset(directory, original, libraryRoot) : null;
          if (file && existsSync(file)) {
            const actual = containedFile(original.storageKind === 'local' ? directory : libraryRoot, file),
              temporary = path.join(assetsFolder, `${randomUUID()}.partial`);
            const copied = await copyWithHash(actual, temporary, {
              signal: options.signal
            });
            if (original.sha256 && copied.sha256 !== original.sha256) {
              rmSync(temporary);
              reason = '原件指纹不匹配';
            } else {
              const known = mediaFiles.get(copied.sha256),
                relative = known?.path ?? `assets/${copied.sha256}${ext}`,
                destination = path.join(project.directory, ...relative.split('/'));
              if (known) rmSync(temporary);else {
                renameSync(temporary, destination);
                mediaFiles.set(copied.sha256, {
                  path: relative,
                  file: destination,
                  ...copied
                });
              }
              converted = {
                ...converted,
                relativePath: relative,
                sha256: copied.sha256,
                size: copied.size,
                missing: false
              };
            }
          }
          if (converted.missing) missing.push({
            assetId: original.id,
            name: original.name,
            reason,
            path: converted.relativePath
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
          thumbnail: false
        };
        options.onProgress?.(++count, Math.max(1, total));
      }
      for (const idea of doc.ideas) {
        // The package carries a local source copy; no live global select dependency.
        idea.sourceLibraryId = null;
        idea.sourceIdeaId = null;
        idea.sourceVersion = null;
      }
      for(const binding of doc.shotAssets){binding.sourceSelectId=null;binding.sourceSelectVersion=null;}
    }
    const db = projects.openDatabase(project.directory);
    try {
      db.exec('BEGIN IMMEDIATE');
      writeDocument(db, current);
      db.prepare('UPDATE project SET id=?').run(source.id);
      for (const item of history) insertRevision(db, item.revision, item.document);
      db.exec('DELETE FROM commands; COMMIT;');
      if ((db.prepare('PRAGMA integrity_check').get() as any).integrity_check !== 'ok') throw new Error('导出副本完整性检查失败');
    } catch (e) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw e;
    } finally {
      db.close();
    }
    const dbFile = path.join(project.directory, 'project.sqlite');
    if (statSync(dbFile).size > PACKAGE_LIMITS.databaseBytes) throw new Error('项目数据库超过 256 MB，请减少快照后再导出');
    const files = [{
      path: 'project.sqlite',
      file: dbFile,
      size: statSync(dbFile).size,
      sha256: await hashFile(dbFile, options.signal)
    }, ...mediaFiles.values()];
    const manifest = manifestSchema.parse({
      format: 'WaterCutProject',
      packageVersion: 1,
      projectFormatVersion: projects.CURRENT_VERSION,
      projectId: source.id,
      createdAt: new Date().toISOString(),
      ...settings,
      complete: missing.length === 0,
      files: files.map(({
        path,
        size,
        sha256
      }) => ({
        path,
        size,
        sha256
      })),
      missing
    });
    checkCancelled(options.signal);
    const temporaryZip = path.join(stage, 'package.partial');
    await writePackageZip(files, Buffer.from(JSON.stringify(manifest, null, 2)), temporaryZip, options);
    checkCancelled(options.signal);
    renameSync(temporaryZip, path.resolve(target));
    return {
      file: path.resolve(target),
      complete: manifest.complete,
      missing: manifest.missing,
      fileCount: files.length
    };
  } finally {
    removeJobDirectory(stage, parent, '.watercut-export-');
  }
}
function independentDocument(input: unknown, listed: Set<string>, missing: Missing[]) {
  const doc = validateDocument(input);
  for (const a of doc.assets) {
    const relative = safePackagePath(a.relativePath);
    if (a.storageKind !== 'local' || a.sourceAssetId || a.sourceLibraryId || !relative.startsWith('assets/')) throw new Error('项目包仍包含外部素材引用');
    if (!listed.has(relative) && !missing.some(m => m.assetId === a.id && m.path === relative)) throw new Error('项目包缺少未声明的素材依赖');
  }
  for (const i of doc.ideas) {
    i.sourceLibraryId = null;
    i.sourceIdeaId = null;
    i.sourceVersion = null;
  }
  for(const b of doc.shotAssets){b.sourceSelectId=null;b.sourceSelectVersion=null;}
  return doc;
}
function validateDatabaseBounds(db: DatabaseSync, version: number) {
  const limits: Record<string, number> = {
    project: 1,
    shots: 10000,
    ideas: 10000,
    assets: 10000,
    board_edges: 50000,
    shot_assets: 10000,
    shot_audio: 10000,
    shot_candidates: 100000,
    script_blocks: 30000,
    shot_sources: 100000,
    revisions: 500,
    revision_media_refs: 500000,
    asset_metadata: 10000,
    project_origin: 10,
    commands: 100000,
    outbox: 100000
  };
  if (version >= 10) {
    limits.idea_boxes = 1000;
    limits.idea_box_items = 10000;
  }
  if(version>=11){limits.audio_clips=128;limits.timeline_settings=1;limits.ai_proposals=100;}
  for (const [table, limit] of Object.entries(limits)) {
    const schema = db.prepare("SELECT type,sql FROM sqlite_master WHERE name=?").get(table) as any;
    if (schema?.type !== 'table' || /CREATE\s+VIRTUAL\s+TABLE/i.test(schema.sql ?? '')) throw new Error('项目包数据表结构不受支持');
    if ((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as any).n > limit) throw new Error('项目包对象数量超过限制');
  }
  const history = db.prepare('SELECT coalesce(sum(length(CAST(payload_json AS BLOB))),0) AS total,coalesce(max(length(CAST(payload_json AS BLOB))),0) AS largest FROM revisions').get() as any;
  if (history.total > 96 * 1024 ** 2 || history.largest > 20 * 1024 ** 2) throw new Error('项目包快照内容超过限制');
  for (const [table, limit] of [['ideas', 32768], ['asset_metadata', 65536]] as const) if ((db.prepare(`SELECT coalesce(max(length(payload_json)),0) AS n FROM ${table}`).get() as any).n > limit) throw new Error('项目包元数据超过限制');
  for (const table of ['ideas', 'shots', 'script_blocks', 'shot_sources']) {
    const columns = table === 'ideas' ? ['text', 'notes', 'tags'] : table === 'shots' ? ['description', 'action_dialogue', 'review_note', 'scene', 'time_of_day', 'shot_size', 'movement'] : table === 'script_blocks' ? ['draft_text'] : ['excerpt'];
    for (const column of columns) if ((db.prepare(`SELECT coalesce(max(length(${column})),0) AS n FROM ${table}`).get() as any).n > 4000) throw new Error('项目包文本超过限制');
  }
}
export async function importPackage(file: string, projectsRoot: string, options: JobOptions = {}) {
  checkCancelled(options.signal);
  const opened = await openPackageZip(file, options.signal);
  let stage: string | undefined;
  try {
    const manifestEntry = opened.entries.get('manifest.json');
    if (!manifestEntry) throw new Error('缺少 WaterCut 项目包清单');
    const manifest = manifestSchema.parse(await readManifest(opened.zip, manifestEntry, options.signal));
    if (manifest.complete !== (manifest.missing.length === 0)) throw new Error('项目包完整性标记不一致');
    const files = new Map<string, z.infer<typeof fileSchema>>(),
      keys = new Set<string>();
    for (const item of manifest.files) {
      const key = archiveKey(item.path);
      if (keys.has(key)) throw new Error('项目包清单路径重复');
      keys.add(key);
      if (item.path !== 'project.sqlite' && !/^assets\/[a-f0-9]{64}\.[a-z0-9]+$/.test(item.path)) throw new Error('项目包包含不支持的文件');
      if (item.path === 'project.sqlite' && item.size > PACKAGE_LIMITS.databaseBytes) throw new Error('项目包数据库超过 256 MB');
      files.set(item.path, item);
      const entry = opened.entries.get(item.path);
      if (!entry || entry.uncompressedSize !== item.size) throw new Error('项目包内容与清单不一致');
    }
    if (!files.has('project.sqlite') || files.size + 1 !== opened.entries.size) throw new Error('项目包存在清单外条目或缺少数据库');
    for (const m of manifest.missing) if (!safePackagePath(m.path).startsWith('assets/')) throw new Error('缺失素材路径无效');
    mkdirSync(projectsRoot, {
      recursive: true
    });
    assertSpace(projectsRoot, opened.total + files.get('project.sqlite')!.size * 3);
    stage = mkdtempSync(path.join(path.resolve(projectsRoot), '.watercut-import-'));
    const raw = path.join(stage, 'incoming.watercut');
    mkdirSync(raw);
    let done = 0;
    for (const item of manifest.files) {
      checkCancelled(options.signal);
      await extractEntry(opened.zip, opened.entries.get(item.path)!, raw, item, {
        signal: options.signal
      });
      options.onProgress?.(++done, manifest.files.length);
    }
    const db = new DatabaseSync(path.join(raw, 'project.sqlite'), {
      readOnly: true,
      allowExtension: false
    });
    let history: Array<{
      revision: Revision;
      document: ProjectDocument;
    }> = [];
    try {
      db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
      const version = (db.prepare('PRAGMA user_version').get() as any).user_version;
      if (![9,10, projects.CURRENT_VERSION].includes(version) || version !== manifest.projectFormatVersion) throw new Error('项目包数据库格式不受支持或与清单不一致');
      validateDatabaseBounds(db, version);
      if ((db.prepare('PRAGMA integrity_check').get() as any).integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('项目包数据库完整性检查失败');
      const ids = db.prepare('SELECT id FROM revisions').all() as any[];
      if (ids.length > 500 || !manifest.includeHistory && ids.length) throw new Error('项目包历史与声明不一致');
      history = ids.map(row => readRevision(db, row.id));
    } finally {
      db.close();
    }
    const incoming = projects.readProject(raw, true);
    if (incoming.id !== manifest.projectId) throw new Error('项目包身份与清单不一致');
    const current = independentDocument(incoming, new Set(files.keys()), manifest.missing);
    for (const h of history) h.document = independentDocument(h.document, new Set(files.keys()), manifest.missing);
    for (const doc of [current, ...history.map(h => h.document)]) for (const asset of doc.assets) {
      const item = files.get(asset.relativePath);
      if (item && (asset.size !== item.size || asset.sha256 !== item.sha256)) throw new Error('素材描述与文件指纹不一致');
    }
    checkCancelled(options.signal);
    const result = projects.createProject(stage, current.name),
      trusted = projects.openDatabase(result.directory);
    try {
      trusted.exec('BEGIN IMMEDIATE');
      writeDocument(trusted, current);
      for (const h of history) insertRevision(trusted, h.revision, h.document);
      trusted.prepare('INSERT INTO project_origin VALUES (?,?,?)').run(manifest.projectId, await hashFile(file, options.signal), new Date().toISOString());
      trusted.exec('COMMIT');
    } catch (e) {
      if (trusted.isTransaction) trusted.exec('ROLLBACK');
      throw e;
    } finally {
      trusted.close();
    }
    if (existsSync(path.join(raw, 'assets'))) renameSync(path.join(raw, 'assets'), path.join(result.directory, 'assets'));
    const final = path.join(path.resolve(projectsRoot), `${result.id}.watercut`);
    checkCancelled(options.signal);
    renameSync(result.directory, final);
    return projects.readProject(final);
  } finally {
    opened.zip.close();
    if (stage) removeJobDirectory(stage, path.resolve(projectsRoot), '.watercut-import-');
  }
}
