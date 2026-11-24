import { openDatabase } from '../database';

export function markCatalogSynced(directory: string, revision: number): void {
  const db = openDatabase(directory);
  try {
    db.prepare('DELETE FROM outbox WHERE project_revision<=?').run(revision);
  } finally {
    db.close();
  }
}
