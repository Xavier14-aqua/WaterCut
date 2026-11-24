import { DatabaseSync } from 'node:sqlite';

import { randomUUID } from 'node:crypto';

import { existsSync, mkdirSync } from 'node:fs';

import path from 'node:path';

import { colorFamily } from '../../shared/colors';

import * as boxes from '../organization/idea-boxes';

export type Row = Record<string, any>;

export function openLibrary(root: string, create = true): DatabaseSync {
  const file = path.join(root, 'library.sqlite');
  if (!existsSync(file) && !create)
    throw new Error('全局库不可用，请在设置中重新选择');
  mkdirSync(root, {
    recursive: true,
  });
  const db = new DatabaseSync(file);
  db.function(
    'watercut_color_family',
    {
      deterministic: true,
    },
    (value) => colorFamily(value),
  );
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  try {
    const version = (db.prepare('PRAGMA user_version').get() as Row)
      .user_version;
    if (version > 4) throw new Error('全局库版本较新，请升级 WaterCut');
    if (version > 0 && version < 4)
      db.prepare('VACUUM INTO ?').run(`${file}.before-v4.${randomUUID()}.bak`);
    if (version === 0) {
      if (
        db
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1")
          .get()
      )
        throw new Error('所选数据库不是 WaterCut 全局库');
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE library_meta(id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
        CREATE TABLE blobs(sha256 TEXT PRIMARY KEY,relative_path TEXT NOT NULL,size INTEGER NOT NULL);
        CREATE TABLE assets(id TEXT PRIMARY KEY,blob_sha256 TEXT NOT NULL REFERENCES blobs(sha256),name TEXT NOT NULL,kind TEXT NOT NULL,tags TEXT NOT NULL DEFAULT '',duration_ms INTEGER,imported_at TEXT NOT NULL,starred INTEGER NOT NULL DEFAULT 0,hidden INTEGER NOT NULL DEFAULT 0,palette_json TEXT NOT NULL DEFAULT '[]');
        CREATE INDEX assets_kind_time ON assets(kind,imported_at,id);
        CREATE TABLE ideas(id TEXT PRIMARY KEY,kind TEXT NOT NULL,text TEXT NOT NULL,tags TEXT NOT NULL,notes TEXT NOT NULL,payload_json TEXT NOT NULL,recorded_at TEXT NOT NULL,occurred_at TEXT,version INTEGER NOT NULL DEFAULT 1,hidden INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX ideas_time ON ideas(recorded_at,id);
        CREATE TABLE idea_media(idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,asset_id TEXT NOT NULL REFERENCES assets(id),role TEXT NOT NULL,position INTEGER NOT NULL,in_ms INTEGER NOT NULL,out_ms INTEGER,PRIMARY KEY(idea_id,asset_id,role));
        CREATE TABLE tags(id INTEGER PRIMARY KEY,label TEXT NOT NULL UNIQUE);
        CREATE TABLE idea_tags(entity_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,tag_id INTEGER NOT NULL REFERENCES tags(id),PRIMARY KEY(entity_id,tag_id));
        CREATE TABLE asset_tags(entity_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,tag_id INTEGER NOT NULL REFERENCES tags(id),PRIMARY KEY(entity_id,tag_id));
        CREATE INDEX idea_tags_tag ON idea_tags(tag_id,entity_id);
        CREATE INDEX asset_tags_tag ON asset_tags(tag_id,entity_id);
        CREATE TABLE idea_relations(id TEXT PRIMARY KEY,source TEXT NOT NULL REFERENCES ideas(id),target TEXT NOT NULL REFERENCES ideas(id),kind TEXT NOT NULL,note TEXT NOT NULL,UNIQUE(source,target,kind));
        CREATE TABLE project_catalog(project_id TEXT PRIMARY KEY,path TEXT NOT NULL,name TEXT NOT NULL,archived INTEGER NOT NULL,last_seen TEXT NOT NULL,indexed_revision INTEGER NOT NULL);
        CREATE TABLE usage_index(project_id TEXT NOT NULL REFERENCES project_catalog(project_id) ON DELETE CASCADE,entity_kind TEXT NOT NULL,global_id TEXT NOT NULL,shot_id TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(project_id,entity_kind,global_id,shot_id,role));
        CREATE INDEX usage_global ON usage_index(global_id);
        CREATE TABLE operations(operation_id TEXT PRIMARY KEY,kind TEXT NOT NULL,stage TEXT NOT NULL,mapping_json TEXT NOT NULL DEFAULT '{}',error TEXT);
        PRAGMA user_version=1;`);
      db.prepare('INSERT INTO library_meta VALUES (?,?)').run(
        randomUUID(),
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    }
    if (version < 2)
      db.exec(
        'BEGIN IMMEDIATE; CREATE TABLE asset_metadata(asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,payload_json TEXT NOT NULL); PRAGMA user_version=2; COMMIT;',
      );
    if (version < 3)
      db.exec(
        `BEGIN IMMEDIATE; ${boxes.ideaBoxTables} PRAGMA user_version=3; COMMIT;`,
      );
    if (version < 4) {
      db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS selects(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES assets(id),name TEXT NOT NULL,in_ms INTEGER NOT NULL,out_ms INTEGER NOT NULL,note TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,hidden INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS selects_asset ON selects(asset_id,in_ms,out_ms);`);
      const columns = new Set(
        (db.prepare('PRAGMA table_info(usage_index)').all() as any[]).map(
          (c) => c.name,
        ),
      );
      for (const definition of [
        'shot_number INTEGER',
        'in_ms INTEGER NOT NULL DEFAULT 0',
        'out_ms INTEGER',
        'source_select_id TEXT',
        'indexed_version INTEGER NOT NULL DEFAULT 0',
      ])
        if (!columns.has(definition.split(' ')[0]))
          db.exec(`ALTER TABLE usage_index ADD COLUMN ${definition}`);
      db.exec('PRAGMA user_version=4; COMMIT;');
    }
    if (!db.prepare('SELECT id FROM library_meta').get())
      throw new Error('全局库标识缺失');
    return db;
  } catch (error) {
    try {
      if (db.isTransaction) db.exec('ROLLBACK');
    } finally {
      db.close();
    }
    throw error;
  }
}

export function transact<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function libraryId(root: string): string {
  const db = openLibrary(root);
  try {
    return (db.prepare('SELECT id FROM library_meta').get() as Row).id;
  } finally {
    db.close();
  }
}
