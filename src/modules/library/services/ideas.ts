import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { ideaSchema, uuid } from '../../../shared/schemas';

import type { IdeaInput, LibraryIdea, Relation } from '../../../shared/models';

import { Row, openLibrary, transact } from '../database';

import { indexTags } from '../parsing';

import { getLibraryIdea } from '../queries/ideas';

export function saveLibraryIdea(
  root: string,
  input: IdeaInput,
  creationId?: string,
): LibraryIdea {
  const data = ideaSchema.parse(input),
    id = input.id
      ? uuid.parse(input.id)
      : creationId
        ? uuid.parse(creationId)
        : randomUUID(),
    db = openLibrary(root);
  try {
    transact(db, () => {
      const old = db.prepare('SELECT version FROM ideas WHERE id=?').get(id) as
        | Row
        | undefined;
      if (input.id && !old) throw new Error('灵感已不存在');
      if (old && creationId && !input.id) return;
      if (old && input.expectedVersion !== old.version)
        throw new Error('灵感已被更新，请重新打开后再保存；当前编辑仍保留');
      for (const m of data.media) {
        const a = db
          .prepare('SELECT kind FROM assets WHERE id=?')
          .get(m.assetId) as Row | undefined;
        if (!a || a.kind !== m.role)
          throw new Error('参考素材类型不匹配或素材不存在');
      }
      if (old)
        db.prepare(
          'UPDATE ideas SET kind=?,text=?,tags=?,notes=?,payload_json=?,occurred_at=?,version=version+1 WHERE id=?',
        ).run(
          data.kind,
          data.text,
          data.tags,
          data.notes,
          JSON.stringify(data.payload),
          data.occurredAt,
          id,
        );
      else
        db.prepare(
          'INSERT INTO ideas(id,kind,text,tags,notes,payload_json,recorded_at,occurred_at) VALUES (?,?,?,?,?,?,?,?)',
        ).run(
          id,
          data.kind,
          data.text,
          data.tags,
          data.notes,
          JSON.stringify(data.payload),
          new Date().toISOString(),
          data.occurredAt,
        );
      db.prepare('DELETE FROM idea_media WHERE idea_id=?').run(id);
      for (const m of data.media)
        db.prepare('INSERT INTO idea_media VALUES (?,?,?,?,?,?)').run(
          id,
          m.assetId,
          m.role,
          m.position,
          m.inMs,
          m.outMs,
        );
      indexTags(db, 'idea_tags', id, data.tags);
    });
  } finally {
    db.close();
  }
  return getLibraryIdea(root, id);
}

export function setLibraryHidden(
  root: string,
  kind: 'idea' | 'asset',
  id: string,
  hidden: boolean,
): void {
  uuid.parse(id);
  const db = openLibrary(root, false);
  try {
    const result = db
      .prepare(
        `UPDATE ${kind === 'idea' ? 'ideas' : 'assets'} SET hidden=? WHERE id=?`,
      )
      .run(hidden ? 1 : 0, id);
    if (!result.changes) throw new Error('对象不存在');
  } finally {
    db.close();
  }
}

export function connectLibraryIdeas(
  root: string,
  source: string,
  target: string,
  kind: Relation['kind'],
  note: string,
): void {
  uuid.parse(source);
  uuid.parse(target);
  z.enum(['related', 'sequence', 'contrast']).parse(kind);
  z.string().max(2000).parse(note);
  if (source === target) throw new Error('不能关联自身');
  if (kind !== 'sequence' && source > target)
    [source, target] = [target, source];
  const db = openLibrary(root, false);
  try {
    db.prepare(
      'INSERT INTO idea_relations VALUES (?,?,?,?,?) ON CONFLICT(source,target,kind) DO UPDATE SET note=excluded.note',
    ).run(randomUUID(), source, target, kind, note);
  } finally {
    db.close();
  }
}

export function disconnectLibraryIdeas(root: string, id: string): void {
  const db = openLibrary(root, false);
  try {
    db.prepare('DELETE FROM idea_relations WHERE id=?').run(uuid.parse(id));
  } finally {
    db.close();
  }
}
