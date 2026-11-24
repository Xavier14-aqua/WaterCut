import { DatabaseSync } from 'node:sqlite';

import { randomUUID } from 'node:crypto';

import type { LibraryAsset } from '../../../shared/models';

export function attachAssetRow(db: DatabaseSync, asset: LibraryAsset): string {
  const existing = db
    .prepare(
      'SELECT id FROM assets WHERE source_library_id=? AND source_asset_id=?',
    )
    .get(asset.libraryId, asset.id) as any;
  if (existing) return existing.id;
  const id = randomUUID();
  db.prepare(
    "INSERT INTO assets(id,name,kind,relative_path,size,tags,storage_kind,source_library_id,source_asset_id,sha256,duration_ms,imported_at) VALUES (?,?,?,'',?,?,'library',?,?,?,?,?)",
  ).run(
    id,
    asset.name,
    asset.kind,
    asset.size,
    asset.tags,
    asset.libraryId,
    asset.id,
    asset.sha256,
    asset.durationMs,
    asset.importedAt,
  );
  if (asset.metadata)
    db.prepare('INSERT INTO asset_metadata VALUES (?,?)').run(
      id,
      JSON.stringify(asset.metadata),
    );
  return id;
}
