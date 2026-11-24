import { DatabaseSync } from 'node:sqlite';

export function reorderRows(db: DatabaseSync, ids: string[]) {
  const slots = (
    db
      .prepare(
        'SELECT position FROM script_blocks WHERE shot_id IS NOT NULL ORDER BY position',
      )
      .all() as any[]
  ).map((b) => b.position);
  ids.forEach((id, position) => {
    db.prepare('UPDATE shots SET position=? WHERE id=?').run(position, id);
    db.prepare('UPDATE script_blocks SET position=? WHERE shot_id=?').run(
      slots[position] ?? position,
      id,
    );
  });
}
