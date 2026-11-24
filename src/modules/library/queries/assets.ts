import type { LibraryAsset } from '../../../shared/models';

import { Row, libraryId, openLibrary } from '../database';

import { parseAsset } from '../parsing';

import { safeLibraryPath } from '../storage-paths';

export function getLibraryAsset(
  root: string,
  id: string,
  includeHidden = true,
): LibraryAsset {
  const db = openLibrary(root, false);
  try {
    const row = db
      .prepare(
        `SELECT a.*,(SELECT payload_json FROM asset_metadata WHERE asset_id=a.id) AS metadata_json,b.relative_path,b.size FROM assets a JOIN blobs b ON b.sha256=a.blob_sha256 WHERE a.id=? ${includeHidden ? '' : 'AND a.hidden=0'}`,
      )
      .get(id) as Row | undefined;
    if (!row) throw new Error('素材不存在');
    return parseAsset(
      root,
      row,
      (db.prepare('SELECT id FROM library_meta').get() as Row).id,
    );
  } finally {
    db.close();
  }
}

export function resolveLibraryAsset(
  root: string,
  sourceLibraryId: string,
  sourceAssetId: string,
  sha256: string | null,
): string | null {
  try {
    const asset = getLibraryAsset(root, sourceAssetId);
    return asset.libraryId === sourceLibraryId && asset.sha256 === sha256
      ? safeLibraryPath(root, asset.relativePath)
      : null;
  } catch {
    return null;
  }
}
