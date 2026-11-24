import { DatabaseSync } from 'node:sqlite';

import { existsSync } from 'node:fs';

import path from 'node:path';

import { z } from 'zod';

import { uuid } from '../../../shared/schemas';

import { rangesOverlap } from '../../../shared/creative';

import type { Project, Usage } from '../../../shared/models';

import { Row, openLibrary, transact } from '../database';

export function syncProjectCatalog(root: string, project: Project): void {
  const db = openLibrary(root),
    lib = (db.prepare('SELECT id FROM library_meta').get() as Row).id;
  try {
    transact(db, () => {
      const old = db
        .prepare('SELECT path FROM project_catalog WHERE project_id=?')
        .get(project.id) as Row | undefined;
      if (
        old &&
        path.resolve(old.path).toLowerCase() !==
          path.resolve(project.directory).toLowerCase() &&
        existsSync(path.join(old.path, 'project.sqlite'))
      )
        throw new Error('相同项目 ID 已在另一位置登记，请使用“作为副本打开”');
      db.prepare(
        'INSERT INTO project_catalog VALUES (?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET path=excluded.path,name=excluded.name,archived=excluded.archived,last_seen=excluded.last_seen,indexed_revision=excluded.indexed_revision',
      ).run(
        project.id,
        project.directory,
        project.name,
        project.archived ? 1 : 0,
        new Date().toISOString(),
        project.revision,
      );
      db.prepare('DELETE FROM usage_index WHERE project_id=?').run(project.id);
      const put = db.prepare(
        'INSERT OR IGNORE INTO usage_index(project_id,entity_kind,global_id,shot_id,role,shot_number,in_ms,out_ms,source_select_id,indexed_version) VALUES (?,?,?,?,?,?,?,?,?,1)',
      );
      for (const a of project.assets.filter(
        (a) => a.sourceLibraryId === lib && a.sourceAssetId,
      )) {
        const number = (id: string) => {
          const s = project.shots.find((s) => s.id === id);
          return s ? s.position + 1 : null;
        };
        put.run(
          project.id,
          'asset',
          a.sourceAssetId!,
          '',
          'project',
          null,
          0,
          a.durationMs,
          null,
        );
        for (const b of project.shotAssets.filter((b) => b.assetId === a.id))
          put.run(
            project.id,
            'asset',
            a.sourceAssetId!,
            b.shotId,
            'main',
            number(b.shotId),
            b.inMs,
            b.outMs ?? a.durationMs,
            b.sourceSelectId ?? null,
          );
        for (const b of project.shotCandidates.filter(
          (b) =>
            b.assetId === a.id &&
            !project.shotAssets.some(
              (m) => m.shotId === b.shotId && m.assetId === a.id,
            ),
        ))
          put.run(
            project.id,
            'asset',
            a.sourceAssetId!,
            b.shotId,
            'candidate',
            number(b.shotId),
            0,
            a.durationMs,
            null,
          );
        for (const b of project.shotAudio.filter((b) => b.assetId === a.id))
          put.run(
            project.id,
            'asset',
            a.sourceAssetId!,
            b.shotId,
            'audio',
            number(b.shotId),
            0,
            a.durationMs,
            null,
          );
        for (const b of project.audioClips.filter((b) => b.assetId === a.id))
          put.run(
            project.id,
            'asset',
            a.sourceAssetId!,
            b.id,
            'bgm',
            null,
            b.inMs,
            b.outMs,
            null,
          );
      }
      for (const i of project.ideas.filter(
        (i) => i.sourceLibraryId === lib && i.sourceIdeaId,
      ))
        put.run(
          project.id,
          'idea',
          i.sourceIdeaId!,
          '',
          'project',
          null,
          0,
          null,
          null,
        );
    });
  } finally {
    db.close();
  }
}

export function listUsage(
  root: string,
  id: string,
  range?: { inMs: number; outMs: number },
): Usage[] {
  uuid.parse(id);
  const q = range
    ? z
        .object({
          inMs: z.number().int().nonnegative(),
          outMs: z.number().int().positive(),
        })
        .refine((v) => v.outMs > v.inMs)
        .parse(range)
    : undefined;
  const db = openLibrary(root, false);
  try {
    return (
      db
        .prepare(
          'SELECT u.*,p.name,p.path,p.last_seen,p.indexed_revision FROM usage_index u JOIN project_catalog p ON p.project_id=u.project_id WHERE u.global_id=? ORDER BY p.last_seen DESC,u.shot_number',
        )
        .all(id) as Row[]
    )
      .filter(
        (r) =>
          !q ||
          (r.role !== 'project' &&
            rangesOverlap({ inMs: r.in_ms, outMs: r.out_ms }, q)),
      )
      .map((r) => ({
        projectId: r.project_id,
        projectName: r.name,
        directory: r.path,
        shotId: r.role === 'bgm' ? '' : r.shot_id,
        clipId: r.role === 'bgm' ? r.shot_id : null,
        shotNumber: r.shot_number,
        inMs: r.in_ms,
        outMs: r.out_ms,
        sourceSelectId: r.source_select_id,
        indexedRevision: r.indexed_revision,
        stale: (() => {
          if (r.indexed_version !== 1) return true;
          let other: DatabaseSync | undefined;
          try {
            other = new DatabaseSync(path.join(r.path, 'project.sqlite'), {
              readOnly: true,
              allowExtension: false,
            });
            other.exec('PRAGMA query_only=ON;PRAGMA trusted_schema=OFF;');
            return (
              (other.prepare('SELECT revision FROM project').get() as any)
                ?.revision !== r.indexed_revision
            );
          } catch {
            return true;
          } finally {
            other?.close();
          }
        })(),
        role: r.role,
        lastSeen: r.last_seen,
        available: existsSync(path.join(r.path, 'project.sqlite')),
      }));
  } finally {
    db.close();
  }
}

export function operationMapping(
  root: string,
  key: string,
): Record<string, string> {
  const db = openLibrary(root);
  try {
    const row = db
      .prepare('SELECT mapping_json FROM operations WHERE operation_id=?')
      .get(key) as Row | undefined;
    return row ? JSON.parse(row.mapping_json) : {};
  } finally {
    db.close();
  }
}

export function saveOperation(
  root: string,
  key: string,
  mapping: Record<string, string>,
  stage: string,
) {
  const db = openLibrary(root);
  try {
    db.prepare(
      "INSERT INTO operations(operation_id,kind,stage,mapping_json) VALUES (?,'promote',?,?) ON CONFLICT(operation_id) DO UPDATE SET stage=excluded.stage,mapping_json=excluded.mapping_json",
    ).run(key, stage, JSON.stringify(mapping));
  } finally {
    db.close();
  }
}
