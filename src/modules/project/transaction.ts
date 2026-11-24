import { DatabaseSync } from 'node:sqlite';

import type { Project } from '../../shared/models';

import { openDatabase } from './database';

import { readProject } from './repositories/read-project';

export function mutateProject(
  directory: string,
  action: (db: DatabaseSync) => void,
): Project {
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
