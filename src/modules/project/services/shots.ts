import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { shotMetadataSchema, uuid } from '../../../shared/schemas';

import { validateMediaRange } from '../../../shared/creative';

import type { AssetSelect } from '../../../shared/models';

import type { Project, LibraryAsset } from '../../../shared/models';

import { shotSchema } from '../validation';

import { openDatabase } from '../database';

import { readProject } from '../repositories/read-project';

import { reorderRows } from '../repositories/order';

import { mutateProject } from '../transaction';

import { attachAssetRow } from '../repositories/asset-rows';

export function appendDraftShots(directory: string, input: unknown): Project {
  const shots = z.array(shotSchema).min(1).max(10).parse(input);
  const db = openDatabase(directory);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const next = db
        .prepare(
          'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM shots',
        )
        .get() as {
        position: number;
      };
      shots.forEach((shot, index) =>
        db
          .prepare(
            'INSERT INTO shots (id, position, description, action_dialogue, duration_ms) VALUES (?, ?, ?, ?, ?)',
          )
          .run(
            randomUUID(),
            next.position + index,
            shot.description,
            shot.actionDialogue,
            shot.durationMs,
          ),
      );
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

export function linkAsset(
  directory: string,
  shotId: string,
  assetId: string,
): Project {
  const db = openDatabase(directory);
  try {
    if (
      !db.prepare('SELECT 1 FROM shots WHERE id = ?').get(shotId) ||
      !db
        .prepare("SELECT 1 FROM assets WHERE id = ? AND kind != 'audio'")
        .get(assetId)
    )
      throw new Error('镜头或画面素材不存在');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        'INSERT OR IGNORE INTO shot_candidates (shot_id, asset_id) VALUES (?, ?)',
      ).run(shotId, assetId);
      db.prepare(
        'INSERT INTO shot_assets (shot_id, asset_id) VALUES (?, ?) ON CONFLICT(shot_id) DO UPDATE SET asset_id = excluded.asset_id, in_ms = 0, out_ms = NULL,source_select_id=NULL,source_select_version=NULL,source_select_name=NULL',
      ).run(shotId, assetId);
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

export function addCandidate(
  directory: string,
  shotId: string,
  assetId: string,
): Project {
  const db = openDatabase(directory);
  try {
    if (
      !db.prepare('SELECT 1 FROM shots WHERE id = ?').get(shotId) ||
      !db
        .prepare("SELECT 1 FROM assets WHERE id = ? AND kind != 'audio'")
        .get(assetId)
    )
      throw new Error('镜头或画面素材不存在');
    db.prepare(
      'INSERT OR IGNORE INTO shot_candidates (shot_id, asset_id) VALUES (?, ?)',
    ).run(shotId, assetId);
  } finally {
    db.close();
  }
  return readProject(directory);
}

export function removeCandidate(
  directory: string,
  shotId: string,
  assetId: string,
): Project {
  const db = openDatabase(directory);
  try {
    if (
      db
        .prepare('SELECT 1 FROM shot_assets WHERE shot_id = ? AND asset_id = ?')
        .get(shotId, assetId)
    )
      throw new Error('请先选择其他主画面');
    db.prepare(
      'DELETE FROM shot_candidates WHERE shot_id = ? AND asset_id = ?',
    ).run(shotId, assetId);
  } finally {
    db.close();
  }
  return readProject(directory);
}

export function linkAudio(
  directory: string,
  shotId: string,
  assetId: string,
): Project {
  const db = openDatabase(directory);
  try {
    const row = db
      .prepare('SELECT kind FROM assets WHERE id = ?')
      .get(assetId) as
      | {
          kind: string;
        }
      | undefined;
    if (
      !db.prepare('SELECT 1 FROM shots WHERE id = ?').get(shotId) ||
      row?.kind !== 'audio'
    )
      throw new Error('镜头或音频素材不存在');
    db.prepare(
      'INSERT INTO shot_audio (shot_id, asset_id) VALUES (?, ?) ON CONFLICT(shot_id) DO UPDATE SET asset_id = excluded.asset_id',
    ).run(shotId, assetId);
  } finally {
    db.close();
  }
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
      const rows = db
        .prepare('SELECT id FROM shots ORDER BY position, id')
        .all() as Array<{
        id: string;
      }>;
      reorderRows(
        db,
        rows.map((row) => row.id),
      );
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

export function moveShot(
  directory: string,
  id: string,
  offset: -1 | 1,
): Project {
  const db = openDatabase(directory);
  try {
    const rows = db
      .prepare('SELECT id FROM shots ORDER BY position, id')
      .all() as Array<{
      id: string;
    }>;
    const index = rows.findIndex((row) => row.id === id);
    if (index < 0 || index + offset < 0 || index + offset >= rows.length)
      throw new Error('无法移动该镜头');
    [rows[index], rows[index + offset]] = [rows[index + offset], rows[index]];
    db.exec('BEGIN IMMEDIATE');
    try {
      reorderRows(
        db,
        rows.map((row) => row.id),
      );
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

export function updateTrim(
  directory: string,
  shotId: string,
  inMsInput: unknown,
  outMsInput: unknown,
): Project {
  const inMs = z
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60 * 1000)
    .parse(inMsInput);
  const outMs = z
    .number()
    .int()
    .min(1)
    .max(24 * 60 * 60 * 1000)
    .nullable()
    .parse(outMsInput);
  if (outMs !== null && outMs <= inMs) throw new Error('出点必须晚于入点');
  const db = openDatabase(directory);
  try {
    const link = db
      .prepare(`SELECT a.duration_ms FROM shot_assets sa JOIN assets a ON a.id = sa.asset_id
      WHERE sa.shot_id = ? AND a.kind = 'video'`)
      .get(shotId) as
      | {
          duration_ms: number | null;
        }
      | undefined;
    if (!link) throw new Error('镜头尚未关联视频素材');
    if (
      link.duration_ms !== null &&
      (inMs >= link.duration_ms || (outMs !== null && outMs > link.duration_ms))
    )
      throw new Error('裁剪区间超过视频时长');
    db.prepare(
      'UPDATE shot_assets SET in_ms = ?, out_ms = ? WHERE shot_id = ?',
    ).run(inMs, outMs, shotId);
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
      const next = db
        .prepare(
          'SELECT COALESCE(MAX(position), -1) + 1 AS position FROM shots',
        )
        .get() as {
        position: number;
      };
      db.prepare(
        'INSERT INTO shots (id, position, description, action_dialogue, duration_ms) VALUES (?, ?, ?, ?, ?)',
      ).run(
        randomUUID(),
        next.position,
        shot.description,
        shot.actionDialogue,
        shot.durationMs,
      );
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

export function updateShot(
  directory: string,
  id: string,
  input: unknown,
): Project {
  const shot = shotSchema
    .extend({
      description: z.string().trim().max(4000),
    })
    .parse(input);
  const db = openDatabase(directory);
  try {
    const result = db
      .prepare(
        'UPDATE shots SET description = ?, action_dialogue = ?, duration_ms = ? WHERE id = ?',
      )
      .run(shot.description, shot.actionDialogue, shot.durationMs, id);
    if (result.changes !== 1) throw new Error('镜头不存在');
  } finally {
    db.close();
  }
  return readProject(directory);
}

export function updateShotMetadata(
  directory: string,
  id: string,
  input: unknown,
): Project {
  const data = shotMetadataSchema.parse(input);
  return mutateProject(directory, (db) => {
    if (
      !db
        .prepare(
          'UPDATE shots SET scene=?,time_of_day=?,shot_size=?,movement=?,status=?,needs_review=?,review_note=?,props=?,production_state=? WHERE id=?',
        )
        .run(
          data.scene,
          data.timeOfDay,
          data.shotSize,
          data.movement,
          data.status,
          data.needsReview ? 1 : 0,
          data.reviewNote,
          data.props,
          data.productionState,
          uuid.parse(id),
        ).changes
    )
      throw new Error('镜头不存在');
  });
}

export function reorderShots(directory: string, input: unknown): Project {
  const ids = z.array(uuid).max(10000).parse(input);
  return mutateProject(directory, (db) => {
    const current = db.prepare('SELECT id FROM shots').all() as any[];
    if (
      ids.length !== current.length ||
      new Set(ids).size !== ids.length ||
      current.some((s) => !ids.includes(s.id))
    )
      throw new Error('镜头顺序不完整或含重复镜头，请刷新后重试');
    reorderRows(db, ids);
  });
}

export function addShotSource(
  directory: string,
  shotId: string,
  ideaId: string,
): Project {
  uuid.parse(shotId);
  uuid.parse(ideaId);
  return mutateProject(directory, (db) => {
    if (!db.prepare('SELECT 1 FROM shots WHERE id=?').get(shotId))
      throw new Error('镜头不存在');
    const idea = db
      .prepare('SELECT text FROM ideas WHERE id=?')
      .get(ideaId) as any;
    if (!idea) throw new Error('项目灵感不存在');
    if (
      !db
        .prepare('SELECT 1 FROM shot_sources WHERE shot_id=? AND idea_id=?')
        .get(shotId, ideaId)
    )
      db.prepare('INSERT INTO shot_sources VALUES (?,?,?,?)').run(
        randomUUID(),
        shotId,
        ideaId,
        idea.text,
      );
  });
}

export function removeShotSource(
  directory: string,
  shotId: string,
  sourceId: string,
): Project {
  uuid.parse(shotId);
  uuid.parse(sourceId);
  return mutateProject(directory, (db) => {
    if (
      !db
        .prepare('DELETE FROM shot_sources WHERE shot_id=? AND id=?')
        .run(shotId, sourceId).changes
    )
      throw new Error('灵感来源已不存在');
  });
}

export function clearShotPrimary(directory: string, shotId: string): Project {
  return mutateProject(directory, (db) => {
    if (!db.prepare('SELECT 1 FROM shots WHERE id=?').get(uuid.parse(shotId)))
      throw new Error('镜头不存在');
    db.prepare('DELETE FROM shot_assets WHERE shot_id=?').run(shotId);
  });
}

export function bindLibrarySelect(
  directory: string,
  shotId: string,
  asset: LibraryAsset,
  select: AssetSelect,
): Project {
  uuid.parse(shotId);
  uuid.parse(select.id);
  validateMediaRange(asset, select.inMs, select.outMs, 'video');
  if (
    select.assetId !== asset.id ||
    select.libraryId !== asset.libraryId ||
    select.hidden
  )
    throw new Error('精华片段来源无效或已隐藏');
  return mutateProject(directory, (db) => {
    if (!db.prepare('SELECT 1 FROM shots WHERE id=?').get(shotId))
      throw new Error('镜头不存在');
    const id = attachAssetRow(db, asset);
    db.prepare('INSERT OR IGNORE INTO shot_candidates VALUES (?,?)').run(
      shotId,
      id,
    );
    db.prepare(
      'INSERT INTO shot_assets(shot_id,asset_id,in_ms,out_ms,source_select_id,source_select_version,source_select_name) VALUES (?,?,?,?,?,?,?) ON CONFLICT(shot_id) DO UPDATE SET asset_id=excluded.asset_id,in_ms=excluded.in_ms,out_ms=excluded.out_ms,source_select_id=excluded.source_select_id,source_select_version=excluded.source_select_version,source_select_name=excluded.source_select_name',
    ).run(
      shotId,
      id,
      select.inMs,
      select.outMs,
      select.id,
      select.version,
      select.name,
    );
  });
}
