import { DatabaseSync } from 'node:sqlite';

import { existsSync } from 'node:fs';

import path from 'node:path';

import * as boxes from '../../organization/idea-boxes';

import { defaultTimelineSettings } from '../../../shared/creative';

import type { AudioClip } from '../../../shared/models';

import type { Shot, Asset, Idea, Project } from '../../../shared/models';

import { databaseFile, localAssetPath, openDatabase } from '../database';

import { CURRENT_VERSION } from '../migrations/schema';

export function readProject(directory: string, readOnly = false): Project {
  const db = readOnly
    ? new DatabaseSync(databaseFile(directory), {
        readOnly: true,
        allowExtension: false,
      })
    : openDatabase(directory);
  try {
    const formatVersion = (db.prepare('PRAGMA user_version').get() as any)
      .user_version;
    if (readOnly) {
      db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
      const version = (db.prepare('PRAGMA user_version').get() as any)
        .user_version;
      if (![9, 10, CURRENT_VERSION].includes(version))
        throw new Error('项目包数据库格式不受支持');
    }
    const row = db
      .prepare('SELECT id,name,revision,archived FROM project LIMIT 1')
      .get() as
      | {
          id: string;
          name: string;
          revision: number;
          archived: number;
        }
      | undefined;
    if (!row) throw new Error('项目数据不完整');
    const shots = (
      db.prepare('SELECT * FROM shots ORDER BY position,id').all() as any[]
    ).map((s) => ({
      id: s.id,
      position: s.position,
      description: s.description,
      actionDialogue: s.action_dialogue,
      durationMs: s.duration_ms,
      scene: s.scene,
      timeOfDay: s.time_of_day,
      shotSize: s.shot_size,
      movement: s.movement,
      status: s.status,
      needsReview: !!s.needs_review,
      reviewNote: s.review_note,
      props: s.props ?? '',
      productionState: s.production_state ?? 'planned',
    })) as Shot[];
    const ideas = (
      db
        .prepare(
          `SELECT i.*,${formatVersion >= 10 ? '(SELECT box_id FROM idea_box_items WHERE idea_id=i.id)' : 'NULL'} AS box_id FROM ideas i ORDER BY i.rowid`,
        )
        .all() as any[]
    ).map((i) => ({
      boxId: i.box_id,
      id: i.id,
      text: i.text,
      tags: i.tags,
      notes: i.notes,
      kind: i.kind,
      payload: JSON.parse(i.payload_json),
      occurredAt: i.occurred_at,
      recordedAt: i.recorded_at,
      sourceAssetId: i.source_asset_id,
      x: i.x,
      y: i.y,
      sourceLibraryId: i.source_library_id,
      sourceIdeaId: i.source_idea_id,
      sourceVersion: i.source_version,
      media: db
        .prepare(
          'SELECT asset_id AS assetId,role,position,in_ms AS inMs,out_ms AS outMs FROM idea_media WHERE idea_id=? ORDER BY position',
        )
        .all(i.id),
    })) as Idea[];
    const boardEdges = (
      db
        .prepare(
          'SELECT id,source,target,source_handle,target_handle,label,relation_kind FROM board_edges ORDER BY rowid',
        )
        .all() as any[]
    ).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.source_handle,
      targetHandle: e.target_handle,
      label: e.label,
      kind: e.relation_kind,
    }));
    const assets = (
      db.prepare('SELECT * FROM assets ORDER BY rowid').all() as any[]
    ).map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      size: a.size,
      tags: a.tags,
      relativePath: a.relative_path,
      storageKind: a.storage_kind,
      sourceLibraryId: a.source_library_id,
      sourceAssetId: a.source_asset_id,
      sha256: a.sha256,
      durationMs: a.duration_ms,
      starred: !!a.starred,
      importedAt: a.imported_at,
      metadata: (() => {
        const m = db
          .prepare('SELECT payload_json FROM asset_metadata WHERE asset_id=?')
          .get(a.id) as any;
        return m ? JSON.parse(m.payload_json) : null;
      })(),
      missing:
        a.storage_kind === 'library' ||
        !existsSync(localAssetPath(directory, a.relative_path)),
      thumbnail: existsSync(path.join(directory, 'thumbnails', `${a.id}.png`)),
    })) as Asset[];
    const shotAssets = (
      db.prepare('SELECT * FROM shot_assets').all() as Array<{
        source_select_id?: string | null;
        source_select_version?: number | null;
        source_select_name?: string | null;
        shot_id: string;
        asset_id: string;
        in_ms: number;
        out_ms: number | null;
      }>
    ).map((row) => ({
      shotId: row.shot_id,
      assetId: row.asset_id,
      inMs: row.in_ms,
      outMs: row.out_ms,
      ...(row.source_select_id || row.source_select_name
        ? {
            sourceSelectId: row.source_select_id ?? null,
            sourceSelectVersion: row.source_select_version ?? null,
            sourceSelectName: row.source_select_name ?? null,
          }
        : {}),
    }));
    const shotAudio = (
      db.prepare('SELECT shot_id, asset_id FROM shot_audio').all() as Array<{
        shot_id: string;
        asset_id: string;
      }>
    ).map((row) => ({
      shotId: row.shot_id,
      assetId: row.asset_id,
    }));
    const shotCandidates = (
      db
        .prepare('SELECT shot_id, asset_id FROM shot_candidates')
        .all() as Array<{
        shot_id: string;
        asset_id: string;
      }>
    ).map((row) => ({
      shotId: row.shot_id,
      assetId: row.asset_id,
    }));
    const scriptBlocks = (
      db
        .prepare(
          'SELECT b.*,s.action_dialogue FROM script_blocks b LEFT JOIN shots s ON s.id=b.shot_id ORDER BY b.position,b.id',
        )
        .all() as any[]
    ).map((b) => ({
      id: b.id,
      position: b.position,
      kind: b.kind,
      text: b.shot_id ? b.action_dialogue : (b.draft_text ?? ''),
      shotId: b.shot_id,
    }));
    const shotSources = db
      .prepare(
        'SELECT id,shot_id AS shotId,idea_id AS ideaId,excerpt FROM shot_sources ORDER BY rowid',
      )
      .all() as any;
    return {
      audioClips:
        formatVersion >= 11
          ? (db
              .prepare(
                'SELECT id,asset_id AS assetId,timeline_start_ms AS timelineStartMs,in_ms AS inMs,out_ms AS outMs,gain,fade_in_ms AS fadeInMs,fade_out_ms AS fadeOutMs FROM audio_clips ORDER BY timeline_start_ms,id',
              )
              .all() as unknown as AudioClip[])
          : [],
      timelineSettings:
        formatVersion >= 11
          ? (db
              .prepare(
                'SELECT width,height,fps_num AS fpsNum,fps_den AS fpsDen,video_gain AS videoGain,bgm_gain AS bgmGain FROM timeline_settings WHERE id=1',
              )
              .get() as any)
          : { ...defaultTimelineSettings },
      ideaBoxes: formatVersion >= 10 ? boxes.readIdeaBoxes(db) : [],
      id: row.id,
      revision: row.revision,
      archived: !!row.archived,
      directory,
      name: row.name,
      shots,
      ideas,
      boardEdges,
      assets,
      shotAssets,
      shotAudio,
      shotCandidates,
      scriptBlocks,
      shotSources,
    };
  } finally {
    db.close();
  }
}
