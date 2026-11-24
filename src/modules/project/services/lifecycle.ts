import { DatabaseSync } from 'node:sqlite';

import { mkdirSync } from 'node:fs';

import path from 'node:path';

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { removeJobDirectory } from '../../../infrastructure/jobs/file-jobs';

import * as boxes from '../../organization/idea-boxes';

import type { Project } from '../../../shared/models';

import { nameSchema } from '../validation';

import { databaseFile, openDatabase } from '../database';

import {
  additions,
  additionsV4,
  additionsV5,
  additionsV6,
  additionsV7,
  additionsV8,
  additionsV9,
  installChangeTriggers,
  installV11,
} from '../migrations/schema';

import { readProject } from '../repositories/read-project';

import { mutateProject } from '../transaction';

export function createProject(root: string, nameInput: unknown): Project {
  const name = nameSchema.parse(nameInput);
  mkdirSync(root, {
    recursive: true,
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
      db.prepare('INSERT INTO project (id, name) VALUES (?, ?)').run(
        randomUUID(),
        name,
      );
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

export function forkProjectIdentity(directory: string): Project {
  return mutateProject(directory, (db) => {
    db.prepare('UPDATE project SET id=?,revision=revision+1').run(randomUUID());
  });
}

export function archiveProject(directory: string, archived: boolean): Project {
  return mutateProject(directory, (db) => {
    db.prepare('UPDATE project SET archived=?').run(
      z.boolean().parse(archived) ? 1 : 0,
    );
  });
}
