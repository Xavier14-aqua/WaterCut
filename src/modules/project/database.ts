import { DatabaseSync } from 'node:sqlite';

import { existsSync } from 'node:fs';

import path from 'node:path';

import { randomUUID } from 'node:crypto';

import * as boxes from '../organization/idea-boxes';

import {
  CURRENT_VERSION,
  additions,
  additionsV4,
  additionsV5,
  additionsV6,
  additionsV7,
  additionsV8,
  additionsV9,
  installChangeTriggers,
  installV11,
} from './migrations/schema';

export function databaseFile(directory: string) {
  return path.join(directory, 'project.sqlite');
}

export function localAssetPath(directory: string, relative: string): string {
  const file = path.resolve(directory, relative),
    root = path.resolve(directory) + path.sep;
  if (
    !relative ||
    path.isAbsolute(relative) ||
    !file.toLowerCase().startsWith(root.toLowerCase())
  )
    throw new Error('项目素材路径无效');
  return file;
}

export function openDatabase(directory: string): DatabaseSync {
  if (typeof directory !== 'string' || !directory.endsWith('.watercut'))
    throw new Error('请选择 .watercut 项目文件夹');
  const file = databaseFile(directory);
  if (!existsSync(file)) throw new Error('项目数据库不存在');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  try {
    const version = db.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    if (version.user_version > CURRENT_VERSION)
      throw new Error('项目由更新版本的 WaterCut 创建，请升级应用');
    if (version.user_version < CURRENT_VERSION) {
      const backupFile = existsSync(`${file}.before-v${CURRENT_VERSION}.bak`)
        ? `${file}.before-v${CURRENT_VERSION}.${randomUUID()}.bak`
        : `${file}.before-v${CURRENT_VERSION}.bak`;
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
        if (version.user_version < 2)
          migration.exec(`${additions} PRAGMA user_version = 2;`);
        if (version.user_version < 3)
          migration.exec(`ALTER TABLE shot_assets ADD COLUMN in_ms INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE shot_assets ADD COLUMN out_ms INTEGER; PRAGMA user_version = 3;`);
        if (version.user_version < 4)
          migration.exec(`${additionsV4} PRAGMA user_version = 4;`);
        if (version.user_version < 5)
          migration.exec(`${additionsV5} PRAGMA user_version = 5;`);
        if (version.user_version < 6)
          migration.exec(`${additionsV6} PRAGMA user_version = 6;`);
        if (version.user_version < 7)
          migration.exec(`${additionsV7} PRAGMA user_version = 7;`);
        if (version.user_version < 8) {
          migration.exec(additionsV8);
        }
        if (version.user_version < 9) migration.exec(additionsV9);
        if (version.user_version < 10)
          migration.exec(`${boxes.ideaBoxTables} PRAGMA user_version=10;`);
        if (version.user_version < 11) installV11(migration);
        installChangeTriggers(migration);
        if (migration.prepare('PRAGMA foreign_key_check').all().length)
          throw new Error('项目关联不完整，迁移已回滚');
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
