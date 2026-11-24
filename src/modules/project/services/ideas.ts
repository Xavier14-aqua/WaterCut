import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { ideaSchema, uuid } from '../../../shared/schemas';

import type {
  Project,
  LibraryAsset,
  LibraryIdea,
} from '../../../shared/models';

import { openDatabase } from '../database';

import { readProject } from '../repositories/read-project';

import { mutateProject } from '../transaction';

import { attachAssetRow } from '../repositories/asset-rows';

export function addIdea(directory: string, textInput: unknown): Project {
  const text = z.string().trim().min(1).max(4000).parse(textInput);
  const db = openDatabase(directory);
  try {
    const count = (
      db.prepare('SELECT COUNT(*) AS count FROM ideas').get() as {
        count: number;
      }
    ).count;
    db.prepare(
      'INSERT INTO ideas (id,text,x,y,recorded_at) VALUES (?,?,?,?,?)',
    ).run(
      randomUUID(),
      text,
      (count % 4) * 230,
      Math.floor(count / 4) * 150,
      new Date().toISOString(),
    );
  } finally {
    db.close();
  }
  return readProject(directory);
}

export function updateIdea(
  directory: string,
  id: string,
  input: unknown,
): Project {
  const old = readProject(directory).ideas.find((i) => i.id === id);
  if (!old) throw new Error('灵感不存在');
  const idea = ideaSchema.parse({
    ...old,
    ...z.record(z.string(), z.unknown()).parse(input),
  });
  const db = openDatabase(directory);
  try {
    db.exec('BEGIN IMMEDIATE');
    const result = db
      .prepare(
        'UPDATE ideas SET text=?,tags=?,notes=?,kind=?,payload_json=?,occurred_at=? WHERE id=?',
      )
      .run(
        idea.text,
        idea.tags,
        idea.notes,
        idea.kind,
        JSON.stringify(idea.payload),
        idea.occurredAt,
        id,
      );
    if (result.changes !== 1) throw new Error('灵感不存在');
    db.prepare('DELETE FROM idea_media WHERE idea_id=?').run(id);
    for (const m of idea.media) {
      const a = db
        .prepare('SELECT kind FROM assets WHERE id=?')
        .get(m.assetId) as any;
      if (!a || a.kind !== m.role) throw new Error('参考素材不匹配');
      db.prepare('INSERT INTO idea_media VALUES (?,?,?,?,?,?)').run(
        id,
        m.assetId,
        m.role,
        m.position,
        m.inMs,
        m.outMs,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  } finally {
    db.close();
  }
  return readProject(directory);
}

export function deleteIdea(directory: string, id: string): Project {
  const db = openDatabase(directory);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM board_edges WHERE source = ? OR target = ?').run(
        id,
        id,
      );
      const result = db.prepare('DELETE FROM ideas WHERE id = ?').run(id);
      if (result.changes !== 1) throw new Error('灵感不存在');
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

export function moveIdea(
  directory: string,
  id: string,
  xInput: unknown,
  yInput: unknown,
): Project {
  const coordinate = z.number().finite().min(-100000).max(100000);
  const x = coordinate.parse(xInput),
    y = coordinate.parse(yInput);
  const db = openDatabase(directory);
  try {
    if (
      db.prepare('UPDATE ideas SET x = ?, y = ? WHERE id = ?').run(x, y, id)
        .changes !== 1
    )
      throw new Error('灵感不存在');
  } finally {
    db.close();
  }
  return readProject(directory);
}

export function connectIdeas(
  directory: string,
  sourceInput: unknown,
  targetInput: unknown,
  sourceHandleInput: unknown = 'bottom',
  targetHandleInput: unknown = 'top',
): Project {
  const source = z.string().uuid().parse(sourceInput),
    target = z.string().uuid().parse(targetInput);
  const handle = z.enum(['top', 'right', 'bottom', 'left']);
  const sourceHandle = handle.parse(sourceHandleInput),
    targetHandle = handle.parse(targetHandleInput);
  if (source === target) throw new Error('不能将卡片连接到自身');
  const db = openDatabase(directory);
  try {
    for (const id of [source, target])
      if (!db.prepare('SELECT 1 FROM ideas WHERE id = ?').get(id))
        throw new Error('灵感不存在');
    db.prepare(
      'INSERT OR IGNORE INTO board_edges (id, source, target, source_handle, target_handle) VALUES (?, ?, ?, ?, ?)',
    ).run(randomUUID(), source, target, sourceHandle, targetHandle);
  } finally {
    db.close();
  }
  return readProject(directory);
}

export function disconnectIdeas(directory: string, idInput: unknown): Project {
  const id = z.string().uuid().parse(idInput);
  const db = openDatabase(directory);
  try {
    if (
      db.prepare('DELETE FROM board_edges WHERE id = ?').run(id).changes !== 1
    )
      throw new Error('连线不存在');
  } finally {
    db.close();
  }
  return readProject(directory);
}

export function attachIdeaAsset(directory: string, assetId: string): Project {
  const db = openDatabase(directory);
  try {
    const row = db
      .prepare('SELECT name,kind FROM assets WHERE id = ?')
      .get(assetId) as
      | {
          name: string;
          kind: string;
        }
      | undefined;
    if (!row) throw new Error('素材不存在');
    const count = (
      db.prepare('SELECT COUNT(*) AS count FROM ideas').get() as {
        count: number;
      }
    ).count;
    const id = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    db.prepare(
      'INSERT INTO ideas (id,text,source_asset_id,x,y,recorded_at) VALUES (?,?,?,?,?,?)',
    ).run(
      id,
      row.name,
      assetId,
      (count % 4) * 230,
      Math.floor(count / 4) * 150,
      new Date().toISOString(),
    );
    db.prepare('INSERT INTO idea_media VALUES (?,?,?,0,0,NULL)').run(
      id,
      assetId,
      row.kind,
    );
    db.exec('COMMIT');
  } finally {
    db.close();
  }
  return readProject(directory);
}

export function createIdea(directory: string, input: unknown): Project {
  const data = ideaSchema.parse(input);
  return mutateProject(directory, (db) => {
    const id = randomUUID(),
      n = (db.prepare('SELECT COUNT(*) AS n FROM ideas').get() as any).n;
    db.prepare(
      'INSERT INTO ideas(id,text,tags,notes,kind,payload_json,occurred_at,recorded_at,x,y) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run(
      id,
      data.text,
      data.tags,
      data.notes,
      data.kind,
      JSON.stringify(data.payload),
      data.occurredAt,
      new Date().toISOString(),
      (n % 4) * 260,
      Math.floor(n / 4) * 200,
    );
    for (const m of data.media) {
      const a = db
        .prepare('SELECT kind FROM assets WHERE id=?')
        .get(m.assetId) as any;
      if (a?.kind !== m.role) throw new Error('参考素材不匹配');
      db.prepare('INSERT INTO idea_media VALUES (?,?,?,?,?,?)').run(
        id,
        m.assetId,
        m.role,
        m.position,
        m.inMs,
        m.outMs,
      );
    }
  });
}

export function attachLibraryIdeas(
  directory: string,
  ideas: LibraryIdea[],
  assets: LibraryAsset[],
  edges: Array<{
    source: string;
    target: string;
    note: string;
    kind: 'related' | 'sequence' | 'contrast';
  }>,
  copy = false,
): Project {
  return mutateProject(directory, (db) => {
    const assetMap = new Map(assets.map((a) => [a.id, attachAssetRow(db, a)])),
      ideaMap = new Map<string, string>();
    for (const idea of ideas) {
      const existing = db
        .prepare(
          'SELECT id FROM ideas WHERE source_library_id=? AND source_idea_id=?',
        )
        .get(idea.libraryId, idea.id) as any;
      if (existing && !copy) {
        ideaMap.set(idea.id, existing.id);
        continue;
      }
      const id = randomUUID(),
        n = (db.prepare('SELECT COUNT(*) AS n FROM ideas').get() as any).n;
      db.prepare(
        'INSERT INTO ideas(id,text,tags,notes,kind,payload_json,occurred_at,recorded_at,source_library_id,source_idea_id,source_version,x,y) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        id,
        idea.text,
        idea.tags,
        idea.notes,
        idea.kind,
        JSON.stringify(idea.payload),
        idea.occurredAt,
        idea.recordedAt,
        idea.libraryId,
        idea.id,
        idea.version,
        (n % 4) * 260,
        idea.kind === 'mood' ? -230 : Math.floor(n / 4) * 200,
      );
      for (const m of idea.media) {
        const assetId = assetMap.get(m.assetId);
        if (!assetId) throw new Error('卡片参考素材未找到');
        db.prepare('INSERT INTO idea_media VALUES (?,?,?,?,?,?)').run(
          id,
          assetId,
          m.role,
          m.position,
          m.inMs,
          m.outMs,
        );
      }
      ideaMap.set(idea.id, id);
    }
    for (const e of edges) {
      const source = ideaMap.get(e.source),
        target = ideaMap.get(e.target);
      if (source && target)
        db.prepare(
          "INSERT OR IGNORE INTO board_edges(id,source,target,source_handle,target_handle,label,relation_kind) VALUES (?,?,?,'bottom','top',?,?)",
        ).run(randomUUID(), source, target, e.note, e.kind);
    }
  });
}

export function refreshLibraryIdea(
  directory: string,
  ideaId: string,
  source: LibraryIdea,
  assets: LibraryAsset[],
): Project {
  const old = readProject(directory).ideas.find((i) => i.id === ideaId);
  if (
    !old ||
    old.sourceIdeaId !== source.id ||
    old.sourceLibraryId !== source.libraryId
  )
    throw new Error('卡片来源不一致');
  return mutateProject(directory, (db) => {
    const mapping = new Map(assets.map((a) => [a.id, attachAssetRow(db, a)]));
    db.prepare(
      'UPDATE ideas SET kind=?,text=?,tags=?,notes=?,payload_json=?,occurred_at=?,source_version=? WHERE id=?',
    ).run(
      source.kind,
      source.text,
      source.tags,
      source.notes,
      JSON.stringify(source.payload),
      source.occurredAt,
      source.version,
      ideaId,
    );
    db.prepare('DELETE FROM idea_media WHERE idea_id=?').run(ideaId);
    for (const m of source.media)
      db.prepare('INSERT INTO idea_media VALUES (?,?,?,?,?,?)').run(
        ideaId,
        mapping.get(m.assetId)!,
        m.role,
        m.position,
        m.inMs,
        m.outMs,
      );
  });
}

export function updateEdgeLabel(
  directory: string,
  id: string,
  label: string,
): Project {
  return mutateProject(directory, (db) => {
    if (
      !db
        .prepare('UPDATE board_edges SET label=? WHERE id=?')
        .run(z.string().max(1000).parse(label), uuid.parse(id)).changes
    )
      throw new Error('连线不存在');
  });
}
