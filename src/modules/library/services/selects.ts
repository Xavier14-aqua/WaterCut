import { DatabaseSync } from 'node:sqlite';

import { randomUUID } from 'node:crypto';

import { uuid } from '../../../shared/schemas';

import {
  selectInputSchema,
  validateMediaRange,
} from '../../../shared/creative';

import type { AssetSelect } from '../../../shared/models';

import { Row, openLibrary, transact } from '../database';

import { getLibraryAsset } from '../queries/assets';

export function listAssetSelects(
  root: string,
  assetId: string,
  includeHidden = false,
): AssetSelect[] {
  uuid.parse(assetId);
  const db = openLibrary(root, false);
  try {
    const lib = (db.prepare('SELECT id FROM library_meta').get() as Row).id;
    return db
      .prepare(
        `SELECT id,asset_id AS assetId,name,in_ms AS inMs,out_ms AS outMs,note,version,hidden,? AS libraryId FROM selects WHERE asset_id=? ${includeHidden ? '' : 'AND hidden=0'} ORDER BY in_ms,id`,
      )
      .all(lib, assetId)
      .map((r) => selectUsage(db, { ...r, hidden: !!r.hidden } as AssetSelect));
  } finally {
    db.close();
  }
}

export function selectUsage(
  db: DatabaseSync,
  select: AssetSelect,
): AssetSelect {
  const rows = db
    .prepare(
      "SELECT p.name,u.shot_number FROM usage_index u JOIN project_catalog p ON p.project_id=u.project_id WHERE u.global_id=? AND u.role='main' AND coalesce(u.out_ms,9223372036854775807)>? AND u.in_ms<? ORDER BY p.last_seen DESC,u.shot_number",
    )
    .all(select.assetId, select.inMs, select.outMs) as Row[];
  return {
    ...select,
    usageCount: rows.length,
    usageHint: rows
      .slice(0, 12)
      .map((r) => `${r.name} · 镜头 ${r.shot_number ?? '待核对'}`)
      .join('\n'),
  };
}

export function getAssetSelect(root: string, id: string): AssetSelect {
  uuid.parse(id);
  const db = openLibrary(root, false);
  try {
    const lib = (db.prepare('SELECT id FROM library_meta').get() as Row).id,
      row = db
        .prepare(
          'SELECT id,asset_id AS assetId,name,in_ms AS inMs,out_ms AS outMs,note,version,hidden,? AS libraryId FROM selects WHERE id=?',
        )
        .get(lib, id) as any;
    if (!row) throw new Error('精华片段不存在');
    return { ...row, hidden: !!row.hidden };
  } finally {
    db.close();
  }
}

export function saveAssetSelect(root: string, input: unknown): AssetSelect[] {
  const v = selectInputSchema.parse(input),
    asset = getLibraryAsset(root, v.assetId);
  validateMediaRange(asset, v.inMs, v.outMs, 'video');
  if (asset.hidden || asset.missing)
    throw new Error('原片已隐藏或离线，请恢复后再创建精华片段');
  const db = openLibrary(root, false);
  try {
    transact(db, () => {
      if (v.id) {
        const old = db
          .prepare(
            'SELECT asset_id,version FROM selects WHERE id=? AND hidden=0',
          )
          .get(v.id) as any;
        if (!old || old.asset_id !== v.assetId)
          throw new Error('精华片段来源不一致');
        if (v.expectedVersion !== old.version)
          throw new Error('精华片段已更新，请刷新后重试');
        db.prepare(
          'UPDATE selects SET name=?,in_ms=?,out_ms=?,note=?,version=version+1 WHERE id=?',
        ).run(v.name, v.inMs, v.outMs, v.note, v.id);
      } else {
        if (
          (
            db
              .prepare(
                'SELECT count(*) AS n FROM selects WHERE asset_id=? AND hidden=0',
              )
              .get(v.assetId) as any
          ).n >= 1000
        )
          throw new Error('单个原片最多 1000 条精华片段');
        db.prepare(
          'INSERT INTO selects(id,asset_id,name,in_ms,out_ms,note) VALUES (?,?,?,?,?,?)',
        ).run(randomUUID(), v.assetId, v.name, v.inMs, v.outMs, v.note);
      }
    });
  } finally {
    db.close();
  }
  return listAssetSelects(root, v.assetId);
}

export function hideAssetSelect(root: string, id: string): void {
  uuid.parse(id);
  const db = openLibrary(root, false);
  try {
    if (
      !db
        .prepare(
          'UPDATE selects SET hidden=1,version=version+1 WHERE id=? AND hidden=0',
        )
        .run(id).changes
    )
      throw new Error('精华片段已隐藏或不存在');
  } finally {
    db.close();
  }
}
