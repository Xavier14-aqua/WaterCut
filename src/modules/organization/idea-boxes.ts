import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { uuid } from '../../shared/schemas';
import type { IdeaBox } from '../../shared/models';

// Membership is separate from card content and limited to one box per card.
export const ideaBoxTables = `
  CREATE TABLE IF NOT EXISTS idea_boxes(id TEXT PRIMARY KEY,name TEXT NOT NULL,position INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS idea_box_items(idea_id TEXT PRIMARY KEY REFERENCES ideas(id) ON DELETE CASCADE,box_id TEXT NOT NULL REFERENCES idea_boxes(id) ON DELETE CASCADE);
  CREATE INDEX IF NOT EXISTS idea_box_members ON idea_box_items(box_id);`;
export function readIdeaBoxes(db: DatabaseSync): IdeaBox[] {
  return db
    .prepare('SELECT id,name,position FROM idea_boxes ORDER BY position,id')
    .all() as unknown as IdeaBox[];
}
export function saveIdeaBox(db: DatabaseSync, input: unknown): void {
  const value = z
    .object({
      id: uuid.optional(),
      name: z
        .string()
        .trim()
        .min(1, '请填写收纳盒名称')
        .max(80, '收纳盒名称最多 80 个字'),
    })
    .parse(input);
  const normalized = (name: string) => name.normalize('NFKC').toLowerCase();
  const boxes = readIdeaBoxes(db);
  if (
    boxes.some(
      (b) => b.id !== value.id && normalized(b.name) === normalized(value.name),
    )
  )
    throw new Error('已有同名收纳盒，请换一个名称');
  if (value.id) {
    if (
      !db
        .prepare('UPDATE idea_boxes SET name=? WHERE id=?')
        .run(value.name, value.id).changes
    )
      throw new Error('收纳盒已不存在');
  } else {
    if (boxes.length >= 1000)
      throw new Error('收纳盒已达 1000 个，请先整理已有收纳盒');
    const position = boxes.length
      ? Math.max(...boxes.map((b) => b.position)) + 1
      : 0;
    db.prepare('INSERT INTO idea_boxes VALUES (?,?,?)').run(
      randomUUID(),
      value.name,
      position,
    );
  }
}
export function deleteIdeaBox(db: DatabaseSync, id: unknown): void {
  if (
    !db.prepare('DELETE FROM idea_boxes WHERE id=?').run(uuid.parse(id)).changes
  )
    throw new Error('收纳盒已不存在');
}
export function moveIdeasToBox(
  db: DatabaseSync,
  input: unknown,
  target: unknown,
): void {
  const ids = z.array(uuid).min(1).max(10000).parse(input),
    boxId = uuid.nullable().parse(target);
  if (new Set(ids).size !== ids.length)
    throw new Error('收纳卡片重复，请重新选择');
  if (boxId && !db.prepare('SELECT 1 FROM idea_boxes WHERE id=?').get(boxId))
    throw new Error('收纳盒已不存在');
  const exists = db.prepare('SELECT 1 FROM ideas WHERE id=?');
  if (ids.some((id) => !exists.get(id)))
    throw new Error('部分灵感不属于当前库或已被移除，请刷新后重试');
  const statement = boxId
    ? db.prepare(
        'INSERT INTO idea_box_items VALUES (?,?) ON CONFLICT(idea_id) DO UPDATE SET box_id=excluded.box_id',
      )
    : db.prepare('DELETE FROM idea_box_items WHERE idea_id=?');
  for (const id of ids) boxId ? statement.run(id, boxId) : statement.run(id);
}
