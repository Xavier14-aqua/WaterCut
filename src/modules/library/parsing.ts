import { DatabaseSync } from 'node:sqlite';

import { existsSync } from 'node:fs';

import path from 'node:path';

import { tagsOf } from '../../shared/schemas';

import type { LibraryAsset, LibraryIdea } from '../../shared/models';

import { Row, libraryId } from './database';

import { safeLibraryPath } from './storage-paths';

export function indexTags(
  db: DatabaseSync,
  table: 'idea_tags' | 'asset_tags',
  id: string,
  text: string,
) {
  db.prepare(`DELETE FROM ${table} WHERE entity_id=?`).run(id);
  for (const label of tagsOf(text)) {
    db.prepare('INSERT OR IGNORE INTO tags(label) VALUES (?)').run(label);
    db.prepare(
      `INSERT INTO ${table}(entity_id,tag_id) SELECT ?,id FROM tags WHERE label=?`,
    ).run(id, label);
  }
}

export function parseIdea(db: DatabaseSync, row: Row, id: string): LibraryIdea {
  const media = db
    .prepare(
      'SELECT asset_id AS assetId,role,position,in_ms AS inMs,out_ms AS outMs FROM idea_media WHERE idea_id=? ORDER BY position',
    )
    .all(row.id) as any;
  return {
    boxId:
      (
        db
          .prepare('SELECT box_id FROM idea_box_items WHERE idea_id=?')
          .get(row.id) as Row | undefined
      )?.box_id ?? null,
    id: row.id,
    libraryId: id,
    kind: row.kind,
    text: row.text,
    tags: row.tags,
    notes: row.notes,
    payload: JSON.parse(row.payload_json),
    recordedAt: row.recorded_at,
    occurredAt: row.occurred_at,
    version: row.version,
    hidden: !!row.hidden,
    media,
  };
}

export function parseAsset(root: string, row: Row, id: string): LibraryAsset {
  return {
    id: row.id,
    libraryId: id,
    name: row.name,
    kind: row.kind,
    relativePath: row.relative_path,
    size: row.size,
    tags: row.tags,
    sha256: row.blob_sha256,
    durationMs: row.duration_ms,
    starred: !!row.starred,
    hidden: !!row.hidden,
    importedAt: row.imported_at,
    missing: !existsSync(safeLibraryPath(root, row.relative_path)),
    thumbnail: existsSync(path.join(root, 'thumbnails', `${row.id}.png`)),
    palette: JSON.parse(row.palette_json),
    usageCount: row.usage_count ?? 0,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
  };
}

export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}
