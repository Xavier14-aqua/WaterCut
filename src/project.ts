import { DatabaseSync } from 'node:sqlite';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statfsSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { removeJobDirectory } from './file-jobs';
import { ideaSchema, shotMetadataSchema, uuid } from './shared/schemas';
import * as boxes from './idea-boxes';
import { audioClipSchema,defaultTimelineSettings,timelineSettingsSchema,validateMediaRange } from './shared/creative';
import type { AssetSelect, AudioClip } from './shared/models';
import type { Shot, Asset, Idea, Project, ShotAsset, BoardHandle, LibraryAsset, LibraryIdea } from './shared/models';
export type * from './shared/models';
const nameSchema = z.string().trim().min(1).max(100);
const shotSchema = z.object({
  description: z.string().trim().min(1).max(4000),
  actionDialogue: z.string().max(4000).default(''),
  durationMs: z.number().int().min(100).max(600000)
});
export const CURRENT_VERSION = 11;
const mediaTypes: Record<string, Asset['kind']> = {
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
  '.m4a': 'audio'
};
const additions = `CREATE TABLE ideas (id TEXT PRIMARY KEY, text TEXT NOT NULL);
  CREATE TABLE assets (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, relative_path TEXT NOT NULL, size INTEGER NOT NULL);
  CREATE TABLE shot_assets (shot_id TEXT PRIMARY KEY REFERENCES shots(id), asset_id TEXT NOT NULL REFERENCES assets(id));`;
const additionsV4 = `ALTER TABLE shots ADD COLUMN action_dialogue TEXT NOT NULL DEFAULT '';
  ALTER TABLE ideas ADD COLUMN tags TEXT NOT NULL DEFAULT '';
  ALTER TABLE ideas ADD COLUMN notes TEXT NOT NULL DEFAULT '';
  ALTER TABLE ideas ADD COLUMN source_asset_id TEXT;
  ALTER TABLE assets ADD COLUMN tags TEXT NOT NULL DEFAULT '';
  CREATE TABLE shot_audio (shot_id TEXT PRIMARY KEY REFERENCES shots(id), asset_id TEXT NOT NULL REFERENCES assets(id));`;
const additionsV5 = `CREATE TABLE shot_candidates (shot_id TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY (shot_id, asset_id));
  INSERT INTO shot_candidates (shot_id, asset_id) SELECT shot_id, asset_id FROM shot_assets;`;
const additionsV6 = `ALTER TABLE ideas ADD COLUMN x REAL NOT NULL DEFAULT 0;
  ALTER TABLE ideas ADD COLUMN y REAL NOT NULL DEFAULT 0;
  UPDATE ideas SET x = ((rowid - 1) % 4) * 230, y = CAST((rowid - 1) / 4 AS INTEGER) * 150;
  CREATE TABLE board_edges (id TEXT PRIMARY KEY, source TEXT NOT NULL REFERENCES ideas(id), target TEXT NOT NULL REFERENCES ideas(id), UNIQUE(source, target));`;
const additionsV7 = `ALTER TABLE board_edges ADD COLUMN source_handle TEXT NOT NULL DEFAULT 'bottom';
  ALTER TABLE board_edges ADD COLUMN target_handle TEXT NOT NULL DEFAULT 'top';`;
const additionsV8 = `ALTER TABLE project ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE project ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE assets ADD COLUMN storage_kind TEXT NOT NULL DEFAULT 'local';
  ALTER TABLE assets ADD COLUMN source_library_id TEXT;
  ALTER TABLE assets ADD COLUMN source_asset_id TEXT;
  ALTER TABLE assets ADD COLUMN sha256 TEXT;
  ALTER TABLE assets ADD COLUMN duration_ms INTEGER;
  ALTER TABLE assets ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE assets ADD COLUMN imported_at TEXT;
  ALTER TABLE ideas ADD COLUMN kind TEXT NOT NULL DEFAULT 'note';
  ALTER TABLE ideas ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{"colors":[],"rhythm":"","timeOfDay":"","weather":"","environment":"","location":"","props":""}';
  ALTER TABLE ideas ADD COLUMN recorded_at TEXT;
  ALTER TABLE ideas ADD COLUMN occurred_at TEXT;
  ALTER TABLE ideas ADD COLUMN source_library_id TEXT;
  ALTER TABLE ideas ADD COLUMN source_idea_id TEXT;
  ALTER TABLE ideas ADD COLUMN source_version INTEGER;
  ALTER TABLE board_edges ADD COLUMN label TEXT NOT NULL DEFAULT '';
  ALTER TABLE board_edges ADD COLUMN relation_kind TEXT NOT NULL DEFAULT 'sequence';
  ALTER TABLE shots ADD COLUMN scene TEXT NOT NULL DEFAULT '';
  ALTER TABLE shots ADD COLUMN time_of_day TEXT NOT NULL DEFAULT '';
  ALTER TABLE shots ADD COLUMN shot_size TEXT NOT NULL DEFAULT '';
  ALTER TABLE shots ADD COLUMN movement TEXT NOT NULL DEFAULT '';
  ALTER TABLE shots ADD COLUMN status TEXT NOT NULL DEFAULT 'idea';
  ALTER TABLE shots ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE shots ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
  CREATE TABLE idea_media(idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,asset_id TEXT NOT NULL REFERENCES assets(id),role TEXT NOT NULL,position INTEGER NOT NULL,in_ms INTEGER NOT NULL,out_ms INTEGER,PRIMARY KEY(idea_id,asset_id,role));
  INSERT INTO idea_media SELECT i.id,a.id,a.kind,0,0,NULL FROM ideas i JOIN assets a ON a.id=i.source_asset_id;
  CREATE TABLE shot_sources(id TEXT PRIMARY KEY,shot_id TEXT NOT NULL REFERENCES shots(id) ON DELETE CASCADE,idea_id TEXT REFERENCES ideas(id) ON DELETE SET NULL,excerpt TEXT NOT NULL);
  CREATE TABLE script_blocks(id TEXT PRIMARY KEY,position INTEGER NOT NULL,kind TEXT NOT NULL DEFAULT 'body',draft_text TEXT,shot_id TEXT UNIQUE REFERENCES shots(id) ON DELETE CASCADE);
  INSERT INTO script_blocks(id,position,shot_id) SELECT id,position,id FROM shots;
  CREATE TRIGGER shot_script AFTER INSERT ON shots BEGIN INSERT INTO script_blocks(id,position,shot_id) VALUES (NEW.id,(SELECT COALESCE(MAX(position),-1)+1 FROM script_blocks),NEW.id); END;
  CREATE TABLE outbox(event_id TEXT PRIMARY KEY,project_revision INTEGER NOT NULL);
  CREATE TABLE commands(command_id TEXT PRIMARY KEY,result_json TEXT NOT NULL);
  PRAGMA user_version=8;`;
function installChangeTriggers(db: DatabaseSync) {
  for (const table of ['shots', 'ideas', 'assets', 'board_edges', 'shot_assets', 'shot_candidates', 'shot_audio', 'idea_media', 'shot_sources', 'script_blocks', 'idea_boxes', 'idea_box_items', 'audio_clips', 'timeline_settings']) for (const event of ['INSERT', 'UPDATE', 'DELETE']) db.exec(`CREATE TRIGGER IF NOT EXISTS change_${table}_${event} AFTER ${event} ON ${table} BEGIN UPDATE project SET revision=revision+1; DELETE FROM outbox WHERE event_id='usage'; INSERT INTO outbox SELECT 'usage',revision FROM project; END;`);
  db.exec("CREATE TRIGGER IF NOT EXISTS change_project AFTER UPDATE OF name,archived ON project BEGIN UPDATE project SET revision=revision+1; DELETE FROM outbox WHERE event_id='usage'; INSERT INTO outbox SELECT 'usage',revision FROM project; END;");
}
const additionsV9 = `
  CREATE TABLE revisions(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL,document_version INTEGER NOT NULL,content_revision INTEGER NOT NULL,payload_json TEXT NOT NULL,automatic INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE revision_media_refs(revision_id TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,asset_id TEXT NOT NULL,blob_sha256 TEXT,locator_snapshot TEXT NOT NULL,PRIMARY KEY(revision_id,asset_id));
  CREATE INDEX revision_media_asset ON revision_media_refs(asset_id);
  CREATE TABLE asset_metadata(asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,payload_json TEXT NOT NULL);
  CREATE TABLE project_origin(source_project_id TEXT NOT NULL,package_sha256 TEXT NOT NULL,imported_at TEXT NOT NULL);
  PRAGMA user_version=9;`;
function databaseFile(directory: string) {
  return path.join(directory, 'project.sqlite');
}
const additionsV11=`
  CREATE TABLE IF NOT EXISTS audio_clips(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,timeline_start_ms INTEGER NOT NULL,in_ms INTEGER NOT NULL,out_ms INTEGER NOT NULL,gain REAL NOT NULL,fade_in_ms INTEGER NOT NULL,fade_out_ms INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS timeline_settings(id INTEGER PRIMARY KEY CHECK(id=1),width INTEGER NOT NULL,height INTEGER NOT NULL,fps_num INTEGER NOT NULL,fps_den INTEGER NOT NULL,video_gain REAL NOT NULL,bgm_gain REAL NOT NULL);
  INSERT OR IGNORE INTO timeline_settings VALUES(1,1920,1080,30,1,1,1);
  CREATE TABLE IF NOT EXISTS ai_proposals(id TEXT PRIMARY KEY,kind TEXT NOT NULL,base_revision INTEGER NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL,payload_json TEXT NOT NULL);
  PRAGMA user_version=11;`;
function installV11(db:DatabaseSync){
  for(const [table,definitions] of [['shots',["props TEXT NOT NULL DEFAULT ''","production_state TEXT NOT NULL DEFAULT 'planned'"]],['shot_assets',['source_select_id TEXT','source_select_version INTEGER','source_select_name TEXT']]] as const){const columns=new Set((db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map(c=>c.name));for(const definition of definitions)if(!columns.has(definition.split(' ')[0]))db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);}
  db.exec(additionsV11);
}
export function localAssetPath(directory: string, relative: string): string {
  const file = path.resolve(directory, relative),
    root = path.resolve(directory) + path.sep;
  if (!relative || path.isAbsolute(relative) || !file.toLowerCase().startsWith(root.toLowerCase())) throw new Error('项目素材路径无效');
  return file;
}
export function openDatabase(directory: string): DatabaseSync {
  if (typeof directory !== 'string' || !directory.endsWith('.watercut')) throw new Error('请选择 .watercut 项目文件夹');
  const file = databaseFile(directory);
  if (!existsSync(file)) throw new Error('项目数据库不存在');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  try {
    const version = db.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    if (version.user_version > CURRENT_VERSION) throw new Error('项目由更新版本的 WaterCut 创建，请升级应用');
    if (version.user_version < CURRENT_VERSION) {
      const backupFile = existsSync(`${file}.before-v${CURRENT_VERSION}.bak`) ? `${file}.before-v${CURRENT_VERSION}.${randomUUID()}.bak` : `${file}.before-v${CURRENT_VERSION}.bak`;
      db.prepare('VACUUM INTO ?').run(backupFile);
      db.close();
      const migration = new DatabaseSync(file);
      try {
        migration.exec('BEGIN IMMEDIATE');
        if (version.user_version === 0) {
          migration.exec(`CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE shots (id TEXT PRIMARY KEY, position INTEGER NOT NULL, description TEXT NOT NULL, duration_ms INTEGER NOT NULL);
            PRAGMA user_version = 1;`);
        }
        if (version.user_version < 2) migration.exec(`${additions} PRAGMA user_version = 2;`);
        if (version.user_version < 3) migration.exec(`ALTER TABLE shot_assets ADD COLUMN in_ms INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE shot_assets ADD COLUMN out_ms INTEGER; PRAGMA user_version = 3;`);
        if (version.user_version < 4) migration.exec(`${additionsV4} PRAGMA user_version = 4;`);
        if (version.user_version < 5) migration.exec(`${additionsV5} PRAGMA user_version = 5;`);
        if (version.user_version < 6) migration.exec(`${additionsV6} PRAGMA user_version = 6;`);
        if (version.user_version < 7) migration.exec(`${additionsV7} PRAGMA user_version = 7;`);
        if (version.user_version < 8) {
          migration.exec(additionsV8);
        }
        if (version.user_version < 9) migration.exec(additionsV9);
        if (version.user_version < 10) migration.exec(`${boxes.ideaBoxTables} PRAGMA user_version=10;`);
        if (version.user_version < 11) installV11(migration);
        installChangeTriggers(migration);
        if (migration.prepare('PRAGMA foreign_key_check').all().length) throw new Error('项目关联不完整，迁移已回滚');
        migration.exec('COMMIT');
        migration.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
        return migration;
      } catch (error) {
        migration.exec('ROLLBACK');
        migration.close();
        throw error;
      }
    }
    return db;
  } catch (error) {
    try {
      db.close();
    } catch {}
    throw error;
  }
}
export function createProject(root: string, nameInput: unknown): Project {
  const name = nameSchema.parse(nameInput);
  mkdirSync(root, {
    recursive: true
  });
  const directoryName = `${randomUUID()}.watercut`;
  const directory = path.join(root, directoryName);
  mkdirSync(directory);
  try {
    const db = new DatabaseSync(databaseFile(directory));
    try {
      // Schema, revision triggers and the initial record share one durable commit.
      db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE;');
      db.exec(`CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE shots (id TEXT PRIMARY KEY, position INTEGER NOT NULL, description TEXT NOT NULL, duration_ms INTEGER NOT NULL);
      ${additions} ALTER TABLE shot_assets ADD COLUMN in_ms INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE shot_assets ADD COLUMN out_ms INTEGER; ${additionsV4} ${additionsV5} ${additionsV6} ${additionsV7} ${additionsV8} ${additionsV9} ${boxes.ideaBoxTables}`);
      installV11(db);
      installChangeTriggers(db);
      db.prepare('INSERT INTO project (id, name) VALUES (?, ?)').run(randomUUID(), name);
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    } finally {
      db.close();
    }
    return readProject(directory);
  } catch (error) {
    // mkdir above guarantees this is the new directory owned by this call.
    removeJobDirectory(directory, root, directoryName);
    throw error;
  }
}
export function readProject(directory: string, readOnly = false): Project {
  const db = readOnly ? new DatabaseSync(databaseFile(directory), {
    readOnly: true,
    allowExtension: false
  }) : openDatabase(directory);
  try {
    const formatVersion = (db.prepare('PRAGMA user_version').get() as any).user_version;
    if (readOnly) {
      db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
      const version = (db.prepare('PRAGMA user_version').get() as any).user_version;
      if (![9,10, CURRENT_VERSION].includes(version)) throw new Error('项目包数据库格式不受支持');
    }
    const row = db.prepare('SELECT id,name,revision,archived FROM project LIMIT 1').get() as {
      id: string;
      name: string;
      revision: number;
      archived: number;
    } | undefined;
    if (!row) throw new Error('项目数据不完整');
    const shots = (db.prepare('SELECT * FROM shots ORDER BY position,id').all() as any[]).map(s => ({
      id: s.id,
      position: s.position,
      description: s.description,
      actionDialogue: s.action_dialogue,
      durationMs: s.duration_ms,
      scene: s.scene,
      timeOfDay: s.time_of_day,
      shotSize: s.shot_size,
      movement: s.movement,
      status: s.status,
      needsReview: !!s.needs_review,
      reviewNote: s.review_note
      ,props:s.props??'',productionState:s.production_state??'planned'
    })) as Shot[];
    const ideas = (db.prepare(`SELECT i.*,${formatVersion >= 10 ? '(SELECT box_id FROM idea_box_items WHERE idea_id=i.id)' : 'NULL'} AS box_id FROM ideas i ORDER BY i.rowid`).all() as any[]).map(i => ({
      boxId: i.box_id,
      id: i.id,
      text: i.text,
      tags: i.tags,
      notes: i.notes,
      kind: i.kind,
      payload: JSON.parse(i.payload_json),
      occurredAt: i.occurred_at,
      recordedAt: i.recorded_at,
      sourceAssetId: i.source_asset_id,
      x: i.x,
      y: i.y,
      sourceLibraryId: i.source_library_id,
      sourceIdeaId: i.source_idea_id,
      sourceVersion: i.source_version,
      media: db.prepare('SELECT asset_id AS assetId,role,position,in_ms AS inMs,out_ms AS outMs FROM idea_media WHERE idea_id=? ORDER BY position').all(i.id)
    })) as Idea[];
    const boardEdges = (db.prepare('SELECT id,source,target,source_handle,target_handle,label,relation_kind FROM board_edges ORDER BY rowid').all() as any[]).map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.source_handle,
      targetHandle: e.target_handle,
      label: e.label,
      kind: e.relation_kind
    }));
    const assets = (db.prepare('SELECT * FROM assets ORDER BY rowid').all() as any[]).map(a => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      size: a.size,
      tags: a.tags,
      relativePath: a.relative_path,
      storageKind: a.storage_kind,
      sourceLibraryId: a.source_library_id,
      sourceAssetId: a.source_asset_id,
      sha256: a.sha256,
      durationMs: a.duration_ms,
      starred: !!a.starred,
      importedAt: a.imported_at,
      metadata: (() => {
        const m = db.prepare('SELECT payload_json FROM asset_metadata WHERE asset_id=?').get(a.id) as any;
        return m ? JSON.parse(m.payload_json) : null;
      })(),
      missing: a.storage_kind === 'library' || !existsSync(localAssetPath(directory, a.relative_path)),
      thumbnail: existsSync(path.join(directory, 'thumbnails', `${a.id}.png`))
    })) as Asset[];
    const shotAssets = (db.prepare('SELECT * FROM shot_assets').all() as Array<{
      source_select_id?:string|null;source_select_version?:number|null;source_select_name?:string|null;
      shot_id: string;
      asset_id: string;
      in_ms: number;
      out_ms: number | null;
    }>).map(row => ({
      shotId: row.shot_id,
      assetId: row.asset_id,
      inMs: row.in_ms,
      outMs: row.out_ms
      ,...(row.source_select_id||row.source_select_name?{sourceSelectId:row.source_select_id??null,sourceSelectVersion:row.source_select_version??null,sourceSelectName:row.source_select_name??null}:{})
    }));
    const shotAudio = (db.prepare('SELECT shot_id, asset_id FROM shot_audio').all() as Array<{
      shot_id: string;
      asset_id: string;
    }>).map(row => ({
      shotId: row.shot_id,
      assetId: row.asset_id
    }));
    const shotCandidates = (db.prepare('SELECT shot_id, asset_id FROM shot_candidates').all() as Array<{
      shot_id: string;
      asset_id: string;
    }>).map(row => ({
      shotId: row.shot_id,
      assetId: row.asset_id
    }));
    const scriptBlocks = (db.prepare('SELECT b.*,s.action_dialogue FROM script_blocks b LEFT JOIN shots s ON s.id=b.shot_id ORDER BY b.position,b.id').all() as any[]).map(b => ({
      id: b.id,
      position: b.position,
      kind: b.kind,
      text: b.shot_id ? b.action_dialogue : b.draft_text ?? '',
      shotId: b.shot_id
    }));
    const shotSources = db.prepare('SELECT id,shot_id AS shotId,idea_id AS ideaId,excerpt FROM shot_sources ORDER BY rowid').all() as any;
    return {
      audioClips:formatVersion>=11?db.prepare('SELECT id,asset_id AS assetId,timeline_start_ms AS timelineStartMs,in_ms AS inMs,out_ms AS outMs,gain,fade_in_ms AS fadeInMs,fade_out_ms AS fadeOutMs FROM audio_clips ORDER BY timeline_start_ms,id').all() as unknown as AudioClip[]:[],
      timelineSettings:formatVersion>=11?db.prepare('SELECT width,height,fps_num AS fpsNum,fps_den AS fpsDen,video_gain AS videoGain,bgm_gain AS bgmGain FROM timeline_settings WHERE id=1').get() as any:{...defaultTimelineSettings},
      ideaBoxes: formatVersion >= 10 ? boxes.readIdeaBoxes(db) : [],
      id: row.id,
      revision: row.revision,
      archived: !!row.archived,
      directory,
      name: row.name,
      shots,
      ideas,
      boardEdges,
      assets,
      shotAssets,
      shotAudio,
      shotCandidates,
      scriptBlocks,
      shotSources
    };
  } finally {
    db.close();
  }
}
export function saveIdeaBox(directory: string, input: unknown): Project {
  return mutateProject(directory, db => boxes.saveIdeaBox(db, input));
}
export function deleteIdeaBox(directory: string, id: unknown): Project {
  return mutateProject(directory, db => boxes.deleteIdeaBox(db, id));
}
export function moveIdeasToBox(directory: string, ids: unknown, boxId: unknown): Project {
  return mutateProject(directory, db => boxes.moveIdeasToBox(db, ids, boxId));
}
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
      if (/^(?:[0-9a-f-]{36}|[0-9a-f]{64})\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|m4a|bin)\.partial$/i.test(name)) {
        rmSync(path.join(folder, name), {
          force: true
        });
        removed++;
      } else if (/^(?:[0-9a-f-]{36}|[0-9a-f]{64})\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|m4a|bin)\.delete-pending$/i.test(name)) {
        const original = name.slice(0, -'.delete-pending'.length);
        const record = db.prepare('SELECT 1 FROM assets WHERE relative_path IN (?,?)').get(path.join('assets', original), `assets/${original}`);
        if (record && !existsSync(path.join(folder, original))) renameSync(path.join(folder, name), path.join(folder, original));else {
          rmSync(path.join(folder, name), {
            force: true
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
async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function addIdea(directory: string, textInput: unknown): Project {
  const text = z.string().trim().min(1).max(4000).parse(textInput);
  const db = openDatabase(directory);
  try {
    const count = (db.prepare('SELECT COUNT(*) AS count FROM ideas').get() as {
      count: number;
    }).count;
    db.prepare('INSERT INTO ideas (id,text,x,y,recorded_at) VALUES (?,?,?,?,?)').run(randomUUID(), text, count % 4 * 230, Math.floor(count / 4) * 150, new Date().toISOString());
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function renameProject(directory: string, nameInput: unknown): Project {
  const name = nameSchema.parse(nameInput);
  const db = openDatabase(directory);
  try {
    db.prepare('UPDATE project SET name = ?').run(name);
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function updateIdea(directory: string, id: string, input: unknown): Project {
  const old = readProject(directory).ideas.find(i => i.id === id);
  if (!old) throw new Error('灵感不存在');
  const idea = ideaSchema.parse({
    ...old,
    ...z.record(z.string(), z.unknown()).parse(input)
  });
  const db = openDatabase(directory);
  try {
    db.exec('BEGIN IMMEDIATE');
    const result = db.prepare('UPDATE ideas SET text=?,tags=?,notes=?,kind=?,payload_json=?,occurred_at=? WHERE id=?').run(idea.text, idea.tags, idea.notes, idea.kind, JSON.stringify(idea.payload), idea.occurredAt, id);
    if (result.changes !== 1) throw new Error('灵感不存在');
    db.prepare('DELETE FROM idea_media WHERE idea_id=?').run(id);
    for (const m of idea.media) {
      const a = db.prepare('SELECT kind FROM assets WHERE id=?').get(m.assetId) as any;
      if (!a || a.kind !== m.role) throw new Error('参考素材不匹配');
      db.prepare('INSERT INTO idea_media VALUES (?,?,?,?,?,?)').run(id, m.assetId, m.role, m.position, m.inMs, m.outMs);
    }
    db.exec('COMMIT');
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function deleteIdea(directory: string, id: string): Project {
  const db = openDatabase(directory);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM board_edges WHERE source = ? OR target = ?').run(id, id);
      const result = db.prepare('DELETE FROM ideas WHERE id = ?').run(id);
      if (result.changes !== 1) throw new Error('灵感不存在');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function moveIdea(directory: string, id: string, xInput: unknown, yInput: unknown): Project {
  const coordinate = z.number().finite().min(-100000).max(100000);
  const x = coordinate.parse(xInput),
    y = coordinate.parse(yInput);
  const db = openDatabase(directory);
  try {
    if (db.prepare('UPDATE ideas SET x = ?, y = ? WHERE id = ?').run(x, y, id).changes !== 1) throw new Error('灵感不存在');
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function connectIdeas(directory: string, sourceInput: unknown, targetInput: unknown, sourceHandleInput: unknown = 'bottom', targetHandleInput: unknown = 'top'): Project {
  const source = z.string().uuid().parse(sourceInput),
    target = z.string().uuid().parse(targetInput);
  const handle = z.enum(['top', 'right', 'bottom', 'left']);
  const sourceHandle = handle.parse(sourceHandleInput),
    targetHandle = handle.parse(targetHandleInput);
  if (source === target) throw new Error('不能将卡片连接到自身');
  const db = openDatabase(directory);
  try {
    for (const id of [source, target]) if (!db.prepare('SELECT 1 FROM ideas WHERE id = ?').get(id)) throw new Error('灵感不存在');
    db.prepare('INSERT OR IGNORE INTO board_edges (id, source, target, source_handle, target_handle) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), source, target, sourceHandle, targetHandle);
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function disconnectIdeas(directory: string, idInput: unknown): Project {
  const id = z.string().uuid().parse(idInput);
  const db = openDatabase(directory);
  try {
    if (db.prepare('DELETE FROM board_edges WHERE id = ?').run(id).changes !== 1) throw new Error('连线不存在');
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function appendDraftShots(directory: string, input: unknown): Project {
  const shots = z.array(shotSchema).min(1).max(10).parse(input);
  const db = openDatabase(directory);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const next = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM shots').get() as {
        position: number;
      };
      shots.forEach((shot, index) => db.prepare('INSERT INTO shots (id, position, description, action_dialogue, duration_ms) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), next.position + index, shot.description, shot.actionDialogue, shot.durationMs));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function attachIdeaAsset(directory: string, assetId: string): Project {
  const db = openDatabase(directory);
  try {
    const row = db.prepare('SELECT name,kind FROM assets WHERE id = ?').get(assetId) as {
      name: string;
      kind: string;
    } | undefined;
    if (!row) throw new Error('素材不存在');
    const count = (db.prepare('SELECT COUNT(*) AS count FROM ideas').get() as {
      count: number;
    }).count;
    const id = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    db.prepare('INSERT INTO ideas (id,text,source_asset_id,x,y,recorded_at) VALUES (?,?,?,?,?,?)').run(id, row.name, assetId, count % 4 * 230, Math.floor(count / 4) * 150, new Date().toISOString());
    db.prepare('INSERT INTO idea_media VALUES (?,?,?,0,0,NULL)').run(id, assetId, row.kind);
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  return readProject(directory);
}
export async function importAsset(directory: string, source: string, options: {
  signal?: AbortSignal;
  onProgress?: (copied: number, total: number) => void;
} = {}): Promise<Project> {
  const kind = mediaTypes[path.extname(source).toLowerCase()];
  if (!kind) throw new Error('暂不支持此文件格式');
  const size = statSync(source).size;
  if (!size || size > 10 * 1024 ** 3) throw new Error('文件为空或超过 10 GB');
  openDatabase(directory).close();
  const free = statfsSync(directory);
  if (free.bavail * free.bsize < size + 64 * 1024 * 1024) throw new Error('项目所在磁盘剩余空间不足');
  const id = randomUUID();
  const assetsDir = path.join(directory, 'assets');
  mkdirSync(assetsDir, {
    recursive: true
  });
  const relativePath = path.join('assets', `${id}${path.extname(source).toLowerCase()}`);
  const destination = path.join(directory, relativePath);
  const temporary = `${destination}.partial`;
  try {
    let copied = 0;
    let lastReport = 0;
    const digest = createHash('sha256');
    await pipeline(createReadStream(source), new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        copied += chunk.length;
        digest.update(chunk);
        const now = Date.now();
        if (!lastReport || now - lastReport >= 100 || copied === size) {
          options.onProgress?.(copied, size);
          lastReport = now;
        }
        callback(null, chunk);
      }
    }), createWriteStream(temporary, {
      flags: 'wx'
    }), {
      signal: options.signal
    });
    if (options.signal?.aborted) throw new Error('导入已取消');
    if (statSync(temporary).size !== size) throw new Error('素材复制不完整');
    const checksum = digest.digest('hex');
    for (const existing of readProject(directory).assets) {
      if (options.signal?.aborted) throw new Error('导入已取消');
      if (existing.size === size && !existing.missing && (await hashFile(path.join(directory, existing.relativePath))) === checksum) throw new Error(`素材已在项目中：${existing.name}`);
    }
    if (options.signal?.aborted) throw new Error('导入已取消');
    renameSync(temporary, destination);
    const db = openDatabase(directory);
    try {
      db.prepare('INSERT INTO assets (id,name,kind,relative_path,size,sha256,imported_at) VALUES (?,?,?,?,?,?,?)').run(id, path.basename(source), kind, relativePath, size, checksum, new Date().toISOString());
    } finally {
      db.close();
    }
  } catch (error) {
    rmSync(temporary, {
      force: true
    });
    rmSync(destination, {
      force: true
    });
    throw error;
  }
  return readProject(directory);
}
export async function relinkAsset(directory: string, assetId: string, source: string, options: {
  signal?: AbortSignal;
  onProgress?: (copied: number, total: number) => void;
} = {}): Promise<Project> {
  const project = readProject(directory);
  const asset = project.assets.find(item => item.id === assetId);
  if (!asset || !asset.missing) throw new Error('只能重新定位缺失素材');
  if (asset.storageKind === 'library') throw new Error('共享素材请从全局库重新定位原件');
  if (path.extname(source).toLowerCase() !== path.extname(asset.relativePath).toLowerCase()) throw new Error('请选择相同扩展名的素材');
  const size = statSync(source).size;
  if (!size || size > 10 * 1024 ** 3) throw new Error('文件为空或超过 10 GB');
  const destination = path.join(directory, asset.relativePath);
  const temporary = `${destination}.partial`;
  let renamed = false;
  try {
    let copied = 0;
    let lastReport = 0;
    await pipeline(createReadStream(source), new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        copied += chunk.length;
        const now = Date.now();
        if (!lastReport || now - lastReport >= 100 || copied === size) {
          options.onProgress?.(copied, size);
          lastReport = now;
        }
        callback(null, chunk);
      }
    }), createWriteStream(temporary, {
      flags: 'wx'
    }), {
      signal: options.signal
    });
    if (options.signal?.aborted) throw new Error('重新定位已取消');
    if (statSync(temporary).size !== size) throw new Error('素材复制不完整');
    if (existsSync(destination)) throw new Error('素材文件已重新出现，请重新打开项目');
    const checksum = await hashFile(temporary);
    if (asset.sha256 && checksum !== asset.sha256) throw new Error('文件内容与原素材指纹不符，请将不同内容作为新素材导入');
    renameSync(temporary, destination);
    renamed = true;
    const db = openDatabase(directory);
    try {
      db.prepare('UPDATE assets SET name = ?, size = ?, sha256=? WHERE id = ?').run(path.basename(source), size, checksum, assetId);
    } finally {
      db.close();
    }
    rmSync(path.join(directory, 'thumbnails', `${assetId}.png`), {
      force: true
    });
  } catch (error) {
    rmSync(temporary, {
      force: true
    });
    if (renamed) rmSync(destination, {
      force: true
    });
    throw error;
  }
  return readProject(directory);
}
export function linkAsset(directory: string, shotId: string, assetId: string): Project {
  const db = openDatabase(directory);
  try {
    if (!db.prepare('SELECT 1 FROM shots WHERE id = ?').get(shotId) || !db.prepare("SELECT 1 FROM assets WHERE id = ? AND kind != 'audio'").get(assetId)) throw new Error('镜头或画面素材不存在');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT OR IGNORE INTO shot_candidates (shot_id, asset_id) VALUES (?, ?)').run(shotId, assetId);
      db.prepare('INSERT INTO shot_assets (shot_id, asset_id) VALUES (?, ?) ON CONFLICT(shot_id) DO UPDATE SET asset_id = excluded.asset_id, in_ms = 0, out_ms = NULL,source_select_id=NULL,source_select_version=NULL,source_select_name=NULL').run(shotId, assetId);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function addCandidate(directory: string, shotId: string, assetId: string): Project {
  const db = openDatabase(directory);
  try {
    if (!db.prepare('SELECT 1 FROM shots WHERE id = ?').get(shotId) || !db.prepare("SELECT 1 FROM assets WHERE id = ? AND kind != 'audio'").get(assetId)) throw new Error('镜头或画面素材不存在');
    db.prepare('INSERT OR IGNORE INTO shot_candidates (shot_id, asset_id) VALUES (?, ?)').run(shotId, assetId);
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function removeCandidate(directory: string, shotId: string, assetId: string): Project {
  const db = openDatabase(directory);
  try {
    if (db.prepare('SELECT 1 FROM shot_assets WHERE shot_id = ? AND asset_id = ?').get(shotId, assetId)) throw new Error('请先选择其他主画面');
    db.prepare('DELETE FROM shot_candidates WHERE shot_id = ? AND asset_id = ?').run(shotId, assetId);
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function linkAudio(directory: string, shotId: string, assetId: string): Project {
  const db = openDatabase(directory);
  try {
    const row = db.prepare('SELECT kind FROM assets WHERE id = ?').get(assetId) as {
      kind: string;
    } | undefined;
    if (!db.prepare('SELECT 1 FROM shots WHERE id = ?').get(shotId) || row?.kind !== 'audio') throw new Error('镜头或音频素材不存在');
    db.prepare('INSERT INTO shot_audio (shot_id, asset_id) VALUES (?, ?) ON CONFLICT(shot_id) DO UPDATE SET asset_id = excluded.asset_id').run(shotId, assetId);
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function updateAssetTags(directory: string, assetId: string, tagsInput: unknown): Project {
  const tags = z.string().max(500).parse(tagsInput);
  const db = openDatabase(directory);
  try {
    const result = db.prepare('UPDATE assets SET tags = ? WHERE id = ?').run(tags, assetId);
    if (result.changes !== 1) throw new Error('素材不存在');
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function deleteAsset(directory: string, assetId: string): Project {
  const db = openDatabase(directory);
  const row = db.prepare('SELECT relative_path FROM assets WHERE id = ?').get(assetId) as {
    relative_path: string;
  } | undefined;
  if (!row) {
    db.close();
    throw new Error('素材不存在');
  }
  const file = row.relative_path ? localAssetPath(directory, row.relative_path) : '';
  const parked = `${file}.delete-pending`;
  let moved = false;
  try {
    const retained = !!db.prepare('SELECT 1 FROM revision_media_refs WHERE asset_id=? LIMIT 1').get(assetId) || !!db.prepare('SELECT 1 FROM assets WHERE id<>? AND relative_path=? LIMIT 1').get(assetId, row.relative_path);
    if (!retained && existsSync(file)) {
      renameSync(file, parked);
      moved = true;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE ideas SET source_asset_id = NULL WHERE source_asset_id = ?').run(assetId);
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
        force: true
      });
    } catch {/* clean on next project open */}
  }
  try {
    rmSync(path.join(directory, 'thumbnails', `${assetId}.png`), {
      force: true
    });
  } catch {/* cache cleanup can be retried later */}
  return readProject(directory);
}
export function deleteShot(directory: string, id: string): Project {
  const db = openDatabase(directory);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM shot_assets WHERE shot_id = ?').run(id);
      db.prepare('DELETE FROM shot_audio WHERE shot_id = ?').run(id);
      db.prepare('DELETE FROM shot_candidates WHERE shot_id = ?').run(id);
      const result = db.prepare('DELETE FROM shots WHERE id = ?').run(id);
      if (result.changes !== 1) throw new Error('镜头不存在');
      const rows = db.prepare('SELECT id FROM shots ORDER BY position, id').all() as Array<{
        id: string;
      }>;
      reorderRows(db, rows.map(row => row.id));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function moveShot(directory: string, id: string, offset: -1 | 1): Project {
  const db = openDatabase(directory);
  try {
    const rows = db.prepare('SELECT id FROM shots ORDER BY position, id').all() as Array<{
      id: string;
    }>;
    const index = rows.findIndex(row => row.id === id);
    if (index < 0 || index + offset < 0 || index + offset >= rows.length) throw new Error('无法移动该镜头');
    [rows[index], rows[index + offset]] = [rows[index + offset], rows[index]];
    db.exec('BEGIN IMMEDIATE');
    try {
      reorderRows(db, rows.map(row => row.id));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function updateTrim(directory: string, shotId: string, inMsInput: unknown, outMsInput: unknown): Project {
  const inMs = z.number().int().min(0).max(24 * 60 * 60 * 1000).parse(inMsInput);
  const outMs = z.number().int().min(1).max(24 * 60 * 60 * 1000).nullable().parse(outMsInput);
  if (outMs !== null && outMs <= inMs) throw new Error('出点必须晚于入点');
  const db = openDatabase(directory);
  try {
    const link = db.prepare(`SELECT a.duration_ms FROM shot_assets sa JOIN assets a ON a.id = sa.asset_id
      WHERE sa.shot_id = ? AND a.kind = 'video'`).get(shotId) as {
      duration_ms: number | null;
    } | undefined;
    if (!link) throw new Error('镜头尚未关联视频素材');
    if (link.duration_ms !== null && (inMs >= link.duration_ms || outMs !== null && outMs > link.duration_ms)) throw new Error('裁剪区间超过视频时长');
    db.prepare('UPDATE shot_assets SET in_ms = ?, out_ms = ? WHERE shot_id = ?').run(inMs, outMs, shotId);
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function addShot(directory: string, input: unknown): Project {
  const shot = shotSchema.parse(input);
  const db = openDatabase(directory);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const next = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM shots').get() as {
        position: number;
      };
      db.prepare('INSERT INTO shots (id, position, description, action_dialogue, duration_ms) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), next.position, shot.description, shot.actionDialogue, shot.durationMs);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function updateShot(directory: string, id: string, input: unknown): Project {
  const shot = shotSchema.extend({
    description: z.string().trim().max(4000)
  }).parse(input);
  const db = openDatabase(directory);
  try {
    const result = db.prepare('UPDATE shots SET description = ?, action_dialogue = ?, duration_ms = ? WHERE id = ?').run(shot.description, shot.actionDialogue, shot.durationMs, id);
    if (result.changes !== 1) throw new Error('镜头不存在');
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function mutateProject(directory: string, action: (db: DatabaseSync) => void): Project {
  const db = openDatabase(directory);
  try {
    db.exec('BEGIN IMMEDIATE');
    action(db);
    db.exec('COMMIT');
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  } finally {
    db.close();
  }
  return readProject(directory);
}
export function markCatalogSynced(directory: string, revision: number): void {
  const db = openDatabase(directory);
  try {
    db.prepare('DELETE FROM outbox WHERE project_revision<=?').run(revision);
  } finally {
    db.close();
  }
}
export function forkProjectIdentity(directory: string): Project {
  return mutateProject(directory, db => {
    db.prepare('UPDATE project SET id=?,revision=revision+1').run(randomUUID());
  });
}
export function archiveProject(directory: string, archived: boolean): Project {
  return mutateProject(directory, db => {
    db.prepare('UPDATE project SET archived=?').run(z.boolean().parse(archived) ? 1 : 0);
  });
}
export function updateAssetDuration(directory: string, id: string, durationMs: number): Project {
  return mutateProject(directory, db => {
    db.prepare('UPDATE assets SET duration_ms=? WHERE id=?').run(z.number().int().positive().max(86400000).parse(durationMs), uuid.parse(id));
  });
}
export function createIdea(directory: string, input: unknown): Project {
  const data = ideaSchema.parse(input);
  return mutateProject(directory, db => {
    const id = randomUUID(),
      n = (db.prepare('SELECT COUNT(*) AS n FROM ideas').get() as any).n;
    db.prepare('INSERT INTO ideas(id,text,tags,notes,kind,payload_json,occurred_at,recorded_at,x,y) VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, data.text, data.tags, data.notes, data.kind, JSON.stringify(data.payload), data.occurredAt, new Date().toISOString(), n % 4 * 260, Math.floor(n / 4) * 200);
    for (const m of data.media) {
      const a = db.prepare('SELECT kind FROM assets WHERE id=?').get(m.assetId) as any;
      if (a?.kind !== m.role) throw new Error('参考素材不匹配');
      db.prepare('INSERT INTO idea_media VALUES (?,?,?,?,?,?)').run(id, m.assetId, m.role, m.position, m.inMs, m.outMs);
    }
  });
}
function attachAssetRow(db: DatabaseSync, asset: LibraryAsset): string {
  const existing = db.prepare('SELECT id FROM assets WHERE source_library_id=? AND source_asset_id=?').get(asset.libraryId, asset.id) as any;
  if (existing) return existing.id;
  const id = randomUUID();
  db.prepare("INSERT INTO assets(id,name,kind,relative_path,size,tags,storage_kind,source_library_id,source_asset_id,sha256,duration_ms,imported_at) VALUES (?,?,?,'',?,?,'library',?,?,?,?,?)").run(id, asset.name, asset.kind, asset.size, asset.tags, asset.libraryId, asset.id, asset.sha256, asset.durationMs, asset.importedAt);
  if (asset.metadata) db.prepare('INSERT INTO asset_metadata VALUES (?,?)').run(id, JSON.stringify(asset.metadata));
  return id;
}
export function attachLibraryAssets(directory: string, assets: LibraryAsset[]): Project {
  return mutateProject(directory, db => {
    for (const a of assets) attachAssetRow(db, a);
  });
}
export function attachLibraryIdeas(directory: string, ideas: LibraryIdea[], assets: LibraryAsset[], edges: Array<{
  source: string;
  target: string;
  note: string;
  kind: 'related' | 'sequence' | 'contrast';
}>, copy = false): Project {
  return mutateProject(directory, db => {
    const assetMap = new Map(assets.map(a => [a.id, attachAssetRow(db, a)])),
      ideaMap = new Map<string, string>();
    for (const idea of ideas) {
      const existing = db.prepare('SELECT id FROM ideas WHERE source_library_id=? AND source_idea_id=?').get(idea.libraryId, idea.id) as any;
      if (existing && !copy) {
        ideaMap.set(idea.id, existing.id);
        continue;
      }
      const id = randomUUID(),
        n = (db.prepare('SELECT COUNT(*) AS n FROM ideas').get() as any).n;
      db.prepare('INSERT INTO ideas(id,text,tags,notes,kind,payload_json,occurred_at,recorded_at,source_library_id,source_idea_id,source_version,x,y) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id, idea.text, idea.tags, idea.notes, idea.kind, JSON.stringify(idea.payload), idea.occurredAt, idea.recordedAt, idea.libraryId, idea.id, idea.version, n % 4 * 260, idea.kind === 'mood' ? -230 : Math.floor(n / 4) * 200);
      for (const m of idea.media) {
        const assetId = assetMap.get(m.assetId);
        if (!assetId) throw new Error('卡片参考素材未找到');
        db.prepare('INSERT INTO idea_media VALUES (?,?,?,?,?,?)').run(id, assetId, m.role, m.position, m.inMs, m.outMs);
      }
      ideaMap.set(idea.id, id);
    }
    for (const e of edges) {
      const source = ideaMap.get(e.source),
        target = ideaMap.get(e.target);
      if (source && target) db.prepare("INSERT OR IGNORE INTO board_edges(id,source,target,source_handle,target_handle,label,relation_kind) VALUES (?,?,?,'bottom','top',?,?)").run(randomUUID(), source, target, e.note, e.kind);
    }
  });
}
export function refreshLibraryIdea(directory: string, ideaId: string, source: LibraryIdea, assets: LibraryAsset[]): Project {
  const old = readProject(directory).ideas.find(i => i.id === ideaId);
  if (!old || old.sourceIdeaId !== source.id || old.sourceLibraryId !== source.libraryId) throw new Error('卡片来源不一致');
  return mutateProject(directory, db => {
    const mapping = new Map(assets.map(a => [a.id, attachAssetRow(db, a)]));
    db.prepare('UPDATE ideas SET kind=?,text=?,tags=?,notes=?,payload_json=?,occurred_at=?,source_version=? WHERE id=?').run(source.kind, source.text, source.tags, source.notes, JSON.stringify(source.payload), source.occurredAt, source.version, ideaId);
    db.prepare('DELETE FROM idea_media WHERE idea_id=?').run(ideaId);
    for (const m of source.media) db.prepare('INSERT INTO idea_media VALUES (?,?,?,?,?,?)').run(ideaId, mapping.get(m.assetId)!, m.role, m.position, m.inMs, m.outMs);
  });
}
export function updateEdgeLabel(directory: string, id: string, label: string): Project {
  return mutateProject(directory, db => {
    if (!db.prepare('UPDATE board_edges SET label=? WHERE id=?').run(z.string().max(1000).parse(label), uuid.parse(id)).changes) throw new Error('连线不存在');
  });
}
export function updateShotMetadata(directory: string, id: string, input: unknown): Project {
  const data = shotMetadataSchema.parse(input);
  return mutateProject(directory, db => {
    if (!db.prepare('UPDATE shots SET scene=?,time_of_day=?,shot_size=?,movement=?,status=?,needs_review=?,review_note=?,props=?,production_state=? WHERE id=?').run(data.scene, data.timeOfDay, data.shotSize, data.movement, data.status, data.needsReview ? 1 : 0, data.reviewNote,data.props,data.productionState, uuid.parse(id)).changes) throw new Error('镜头不存在');
  });
}
function reorderRows(db: DatabaseSync, ids: string[]) {
  const slots = (db.prepare('SELECT position FROM script_blocks WHERE shot_id IS NOT NULL ORDER BY position').all() as any[]).map(b => b.position);
  ids.forEach((id, position) => {
    db.prepare('UPDATE shots SET position=? WHERE id=?').run(position, id);
    db.prepare('UPDATE script_blocks SET position=? WHERE shot_id=?').run(slots[position] ?? position, id);
  });
}
export function reorderShots(directory: string, input: unknown): Project {
  const ids = z.array(uuid).max(10000).parse(input);
  return mutateProject(directory, db => {
    const current = db.prepare('SELECT id FROM shots').all() as any[];
    if (ids.length !== current.length || new Set(ids).size !== ids.length || current.some(s => !ids.includes(s.id))) throw new Error('镜头顺序不完整或含重复镜头，请刷新后重试');
    reorderRows(db, ids);
  });
}
export function reorderScriptBlocks(directory: string, input: unknown): Project {
  const ids = z.array(uuid).max(30000).parse(input);
  return mutateProject(directory, db => {
    const current = db.prepare('SELECT id FROM script_blocks').all() as any[];
    if (ids.length !== current.length || new Set(ids).size !== ids.length || current.some(b => !ids.includes(b.id))) throw new Error('脚本顺序不完整或有重复，请刷新后重试');
    ids.forEach((id, position) => db.prepare('UPDATE script_blocks SET position=? WHERE id=?').run(position, id));
    reorderRows(db, (db.prepare('SELECT shot_id FROM script_blocks WHERE shot_id IS NOT NULL ORDER BY position,id').all() as any[]).map(b => b.shot_id));
  });
}
export function createScriptSection(directory: string, input: unknown): Project {
  const data = z.object({
    title: z.string().max(4000).default('新标题'),
    beforeId: uuid.optional()
  }).parse(input);
  return mutateProject(directory, db => {
    let position = (db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM script_blocks').get() as any).n;
    if (data.beforeId) {
      const before = db.prepare('SELECT position FROM script_blocks WHERE id=?').get(data.beforeId) as any;
      if (!before) throw new Error('段落已不存在');
      position = before.position;
      db.prepare('UPDATE script_blocks SET position=position+1 WHERE position>=?').run(position);
    }
    db.prepare("INSERT INTO script_blocks(id,position,kind,draft_text) VALUES (?,?,'heading',?)").run(randomUUID(), position, data.title);
    if (!data.beforeId) db.prepare("INSERT INTO script_blocks(id,position,kind,draft_text) VALUES (?,?,'body','')").run(randomUUID(), position + 1);
  });
}
export function addScriptParagraph(directory: string, sectionId: unknown): Project {
  const headingId = uuid.nullable().parse(sectionId);
  return mutateProject(directory, db => {
    let start = -1;
    if (headingId) {
      const heading = db.prepare("SELECT position FROM script_blocks WHERE id=? AND kind='heading'").get(headingId) as any;
      if (!heading) throw new Error('脚本标题已不存在');
      start = heading.position;
    }
    const next = db.prepare("SELECT MIN(position) AS n FROM script_blocks WHERE kind='heading' AND position>?").get(start) as any;
    const position = next.n ?? (db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM script_blocks').get() as any).n;
    db.prepare('UPDATE script_blocks SET position=position+1 WHERE position>=?').run(position);
    db.prepare("INSERT INTO script_blocks(id,position,kind,draft_text) VALUES (?,?,'body','')").run(randomUUID(), position);
  });
}
export function addShotSource(directory: string, shotId: string, ideaId: string): Project {
  uuid.parse(shotId);
  uuid.parse(ideaId);
  return mutateProject(directory, db => {
    if (!db.prepare('SELECT 1 FROM shots WHERE id=?').get(shotId)) throw new Error('镜头不存在');
    const idea = db.prepare('SELECT text FROM ideas WHERE id=?').get(ideaId) as any;
    if (!idea) throw new Error('项目灵感不存在');
    if (!db.prepare('SELECT 1 FROM shot_sources WHERE shot_id=? AND idea_id=?').get(shotId, ideaId)) db.prepare('INSERT INTO shot_sources VALUES (?,?,?,?)').run(randomUUID(), shotId, ideaId, idea.text);
  });
}
export function removeShotSource(directory: string, shotId: string, sourceId: string): Project {
  uuid.parse(shotId);
  uuid.parse(sourceId);
  return mutateProject(directory, db => {
    if (!db.prepare('DELETE FROM shot_sources WHERE shot_id=? AND id=?').run(shotId, sourceId).changes) throw new Error('灵感来源已不存在');
  });
}
export function clearShotPrimary(directory: string, shotId: string): Project {
  return mutateProject(directory, db => {
    if (!db.prepare('SELECT 1 FROM shots WHERE id=?').get(uuid.parse(shotId))) throw new Error('镜头不存在');
    db.prepare('DELETE FROM shot_assets WHERE shot_id=?').run(shotId);
  });
}
export function bindLibrarySelect(directory:string,shotId:string,asset:LibraryAsset,select:AssetSelect):Project{
  uuid.parse(shotId);uuid.parse(select.id);validateMediaRange(asset,select.inMs,select.outMs,'video');
  if(select.assetId!==asset.id||select.libraryId!==asset.libraryId||select.hidden)throw new Error('精华片段来源无效或已隐藏');
  return mutateProject(directory,db=>{
    if(!db.prepare('SELECT 1 FROM shots WHERE id=?').get(shotId))throw new Error('镜头不存在');
    const id=attachAssetRow(db,asset);
    db.prepare('INSERT OR IGNORE INTO shot_candidates VALUES (?,?)').run(shotId,id);
    db.prepare('INSERT INTO shot_assets(shot_id,asset_id,in_ms,out_ms,source_select_id,source_select_version,source_select_name) VALUES (?,?,?,?,?,?,?) ON CONFLICT(shot_id) DO UPDATE SET asset_id=excluded.asset_id,in_ms=excluded.in_ms,out_ms=excluded.out_ms,source_select_id=excluded.source_select_id,source_select_version=excluded.source_select_version,source_select_name=excluded.source_select_name').run(shotId,id,select.inMs,select.outMs,select.id,select.version,select.name);
  });
}
export function saveAudioClip(directory:string,input:unknown):Project{
  const raw=z.object({id:uuid.optional(),assetId:uuid,timelineStartMs:z.number(),inMs:z.number(),outMs:z.number(),gain:z.number(),fadeInMs:z.number(),fadeOutMs:z.number()}).parse(input);
  const value=audioClipSchema.parse({...raw,id:raw.id??randomUUID()}),project=readProject(directory),asset=project.assets.find(a=>a.id===value.assetId);
  if(!asset)throw new Error('音频素材不存在');validateMediaRange(asset,value.inMs,value.outMs,'audio');
  return mutateProject(directory,db=>{
    if(raw.id&&!db.prepare('SELECT 1 FROM audio_clips WHERE id=?').get(raw.id))throw new Error('BGM 片段已不存在');
    if(!raw.id&&(db.prepare('SELECT count(*) AS n FROM audio_clips').get() as any).n>=128)throw new Error('BGM 片段最多 128 条');
    db.prepare('INSERT INTO audio_clips VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET asset_id=excluded.asset_id,timeline_start_ms=excluded.timeline_start_ms,in_ms=excluded.in_ms,out_ms=excluded.out_ms,gain=excluded.gain,fade_in_ms=excluded.fade_in_ms,fade_out_ms=excluded.fade_out_ms').run(value.id,value.assetId,value.timelineStartMs,value.inMs,value.outMs,value.gain,value.fadeInMs,value.fadeOutMs);
  });
}
export function deleteAudioClip(directory:string,id:string):Project{return mutateProject(directory,db=>{if(!db.prepare('DELETE FROM audio_clips WHERE id=?').run(uuid.parse(id)).changes)throw new Error('BGM 片段已不存在');});}
export function saveTimelineSettings(directory:string,input:unknown):Project{const v=timelineSettingsSchema.parse(input);return mutateProject(directory,db=>{db.prepare('UPDATE timeline_settings SET width=?,height=?,fps_num=?,fps_den=?,video_gain=?,bgm_gain=? WHERE id=1').run(v.width,v.height,v.fpsNum,v.fpsDen,v.videoGain,v.bgmGain);});}
export function createShotsFromIdeas(directory: string, input: unknown, commandId: string, draft?: unknown): Project {
  const ids = z.array(uuid).min(1).max(100).parse(input);
  uuid.parse(commandId);
  if (new Set(ids).size !== ids.length) throw new Error('卡片重复');
  const descriptions = draft === undefined ? null : z.array(shotSchema).min(1).max(10).parse(draft);
  return mutateProject(directory, db => {
    if (db.prepare('SELECT 1 FROM commands WHERE command_id=?').get(commandId)) return;
    const ideas = ids.map(id => {
      const row = db.prepare('SELECT id,text FROM ideas WHERE id=?').get(id) as any;
      if (!row) throw new Error('灵感不存在');
      return row;
    });
    const start = (db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM shots').get() as any).n;
    const rows = descriptions ?? ideas.map(() => ({
      description: '',
      actionDialogue: '',
      durationMs: 3000
    }));
    rows.forEach((row, index) => {
      const id = randomUUID();
      db.prepare('INSERT INTO shots(id,position,description,action_dialogue,duration_ms) VALUES (?,?,?,?,?)').run(id, start + index, row.description, row.actionDialogue, row.durationMs);
      for (const idea of descriptions ? ideas : [ideas[index]]) db.prepare('INSERT INTO shot_sources VALUES (?,?,?,?)').run(randomUUID(), id, idea.id, idea.text);
    });
    db.prepare('INSERT INTO commands VALUES (?,?)').run(commandId, JSON.stringify({
      count: rows.length
    }));
  });
}
export function saveScriptBlock(directory: string, input: unknown): Project {
  const b = z.object({
    id: uuid.optional(),
    kind: z.enum(['body', 'heading', 'note']),
    text: z.string().max(4000)
  }).parse(input);
  return mutateProject(directory, db => {
    if (!b.id) {
      const pos = (db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM script_blocks').get() as any).n;
      db.prepare('INSERT INTO script_blocks(id,position,kind,draft_text) VALUES (?,?,?,?)').run(randomUUID(), pos, b.kind, b.text);
      return;
    }
    const old = db.prepare('SELECT shot_id FROM script_blocks WHERE id=?').get(b.id) as any;
    if (!old) throw new Error('段落不存在');
    if (old.shot_id) {
      if (b.kind !== 'body') throw new Error('关联镜头的段落保留正文类型');
      db.prepare('UPDATE shots SET action_dialogue=? WHERE id=?').run(b.text, old.shot_id);
    } else db.prepare('UPDATE script_blocks SET kind=?,draft_text=? WHERE id=?').run(b.kind, b.text, b.id);
  });
}
export function convertScriptBlocks(directory: string, input: unknown, commandId: string): Project {
  const ids = z.array(uuid).min(1).max(500).parse(input);
  uuid.parse(commandId);
  return mutateProject(directory, db => {
    if (db.prepare('SELECT 1 FROM commands WHERE command_id=?').get(commandId)) return;
    let pos = (db.prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM shots').get() as any).n;
    for (const id of [...new Set(ids)]) {
      const block = db.prepare('SELECT * FROM script_blocks WHERE id=?').get(id) as any;
      if (!block) throw new Error('段落不存在');
      if (block.shot_id) continue;
      if (block.kind !== 'body') throw new Error('只有正文段落可转镜头');
      const shot = randomUUID();
      db.prepare('INSERT INTO shots(id,position,description,action_dialogue,duration_ms) VALUES (?,?,\'\',?,3000)').run(shot, pos++, block.draft_text ?? '');
      db.prepare('DELETE FROM script_blocks WHERE id=?').run(shot);
      db.prepare('UPDATE script_blocks SET shot_id=?,draft_text=NULL WHERE id=?').run(shot, id);
    }
    const ordered = (db.prepare('SELECT shot_id FROM script_blocks WHERE shot_id IS NOT NULL ORDER BY position,id').all() as any[]).map(b => b.shot_id);
    reorderRows(db, ordered);
    db.prepare('INSERT INTO commands VALUES (?,?)').run(commandId, '{}');
  });
}
export function deleteScriptBlock(directory: string, id: string): Project {
  return mutateProject(directory, db => {
    const b = db.prepare('SELECT shot_id FROM script_blocks WHERE id=?').get(uuid.parse(id)) as any;
    if (!b) throw new Error('段落不存在');
    if (b.shot_id) {
      for (const table of ['shot_assets', 'shot_candidates', 'shot_audio']) db.prepare(`DELETE FROM ${table} WHERE shot_id=?`).run(b.shot_id);
      db.prepare('DELETE FROM shots WHERE id=?').run(b.shot_id);
    } else db.prepare('DELETE FROM script_blocks WHERE id=?').run(id);
    const ids = (db.prepare('SELECT id FROM shots ORDER BY position').all() as any[]).map(s => s.id);
    reorderRows(db, ids);
  });
}
export function splitScriptBlock(directory: string, id: string, offsetInput: unknown): Project {
  const offset = z.number().int().positive().parse(offsetInput);
  uuid.parse(id);
  return mutateProject(directory, db => {
    const block = db.prepare('SELECT b.*,s.action_dialogue,s.duration_ms FROM script_blocks b LEFT JOIN shots s ON s.id=b.shot_id WHERE b.id=?').get(id) as any;
    if (!block || block.kind !== 'body') throw new Error('只能拆分正文段落');
    const text = block.shot_id ? block.action_dialogue : block.draft_text ?? '';
    if (offset >= text.length) throw new Error('请把光标放在正文中间再拆分');
    db.prepare('UPDATE script_blocks SET position=position+1 WHERE position>?').run(block.position);
    if (!block.shot_id) {
      db.prepare('UPDATE script_blocks SET draft_text=? WHERE id=?').run(text.slice(0, offset), id);
      db.prepare('INSERT INTO script_blocks(id,position,kind,draft_text) VALUES (?,?,\'body\',?)').run(randomUUID(), block.position + 1, text.slice(offset));
    } else {
      const shot = randomUUID(),
        duration = Math.max(100, Math.round(block.duration_ms * offset / text.length));
      db.prepare('UPDATE shots SET action_dialogue=?,duration_ms=?,needs_review=1 WHERE id=?').run(text.slice(0, offset), duration, block.shot_id);
      db.prepare('INSERT INTO shots(id,position,description,action_dialogue,duration_ms,needs_review) VALUES (?,0,\'\',?,?,1)').run(shot, text.slice(offset), Math.max(100, block.duration_ms - duration));
      db.prepare('UPDATE script_blocks SET position=? WHERE shot_id=?').run(block.position + 1, shot);
      for (const source of db.prepare('SELECT idea_id,excerpt FROM shot_sources WHERE shot_id=?').all(block.shot_id) as any[]) db.prepare('INSERT INTO shot_sources VALUES (?,?,?,?)').run(randomUUID(), shot, source.idea_id, source.excerpt);
    }
    reorderRows(db, (db.prepare('SELECT shot_id FROM script_blocks WHERE shot_id IS NOT NULL ORDER BY position,id').all() as any[]).map(b => b.shot_id));
  });
}
export function mergeScriptBlocks(directory: string, firstId: string, secondId: string): Project {
  uuid.parse(firstId);
  uuid.parse(secondId);
  if (firstId === secondId) throw new Error('请选择两个不同段落');
  return mutateProject(directory, db => {
    const blocks = db.prepare('SELECT b.*,s.action_dialogue,s.duration_ms FROM script_blocks b LEFT JOIN shots s ON s.id=b.shot_id ORDER BY b.position,b.id').all() as any[],
      index = blocks.findIndex(b => b.id === firstId),
      first = blocks[index],
      second = blocks[index + 1];
    if (!first || second?.id !== secondId || first.kind !== 'body' || second.kind !== 'body' || !!first.shot_id !== !!second.shot_id) throw new Error('只能合并相邻的两个草稿段落，或相邻的两个镜头正文');
    const text = (first.shot_id ? first.action_dialogue : first.draft_text ?? '') + '\n' + (second.shot_id ? second.action_dialogue : second.draft_text ?? '');
    if (text.length > 4000) throw new Error('合并后的正文超过 4000 字符');
    if (!first.shot_id) {
      db.prepare('UPDATE script_blocks SET draft_text=? WHERE id=?').run(text, first.id);
      db.prepare('DELETE FROM script_blocks WHERE id=?').run(second.id);
    } else {
      db.prepare('UPDATE shots SET action_dialogue=?,duration_ms=?,needs_review=1 WHERE id=?').run(text, Math.min(600000, first.duration_ms + second.duration_ms), first.shot_id);
      db.prepare('UPDATE shot_sources SET shot_id=? WHERE shot_id=?').run(first.shot_id, second.shot_id);
      db.prepare('INSERT OR IGNORE INTO shot_candidates(shot_id,asset_id) SELECT ?,asset_id FROM shot_candidates WHERE shot_id=?').run(first.shot_id, second.shot_id);
      for (const table of ['shot_assets', 'shot_audio', 'shot_candidates']) db.prepare(`DELETE FROM ${table} WHERE shot_id=?`).run(second.shot_id);
      db.prepare('DELETE FROM shots WHERE id=?').run(second.shot_id);
    }
    reorderRows(db, (db.prepare('SELECT id FROM shots ORDER BY position,id').all() as any[]).map(s => s.id));
  });
}
