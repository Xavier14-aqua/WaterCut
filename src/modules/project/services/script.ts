import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { uuid } from '../../../shared/schemas';

import type { Project } from '../../../shared/models';

import { mutateProject } from '../transaction';

import { reorderRows } from '../repositories/order';

import { shotSchema } from '../validation';

export function reorderScriptBlocks(
  directory: string,
  input: unknown,
): Project {
  const ids = z.array(uuid).max(30000).parse(input);
  return mutateProject(directory, (db) => {
    const current = db.prepare('SELECT id FROM script_blocks').all() as any[];
    if (
      ids.length !== current.length ||
      new Set(ids).size !== ids.length ||
      current.some((b) => !ids.includes(b.id))
    )
      throw new Error('脚本顺序不完整或有重复，请刷新后重试');
    ids.forEach((id, position) =>
      db
        .prepare('UPDATE script_blocks SET position=? WHERE id=?')
        .run(position, id),
    );
    reorderRows(
      db,
      (
        db
          .prepare(
            'SELECT shot_id FROM script_blocks WHERE shot_id IS NOT NULL ORDER BY position,id',
          )
          .all() as any[]
      ).map((b) => b.shot_id),
    );
  });
}

export function createScriptSection(
  directory: string,
  input: unknown,
): Project {
  const data = z
    .object({
      title: z.string().max(4000).default('新标题'),
      beforeId: uuid.optional(),
    })
    .parse(input);
  return mutateProject(directory, (db) => {
    let position = (
      db
        .prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM script_blocks')
        .get() as any
    ).n;
    if (data.beforeId) {
      const before = db
        .prepare('SELECT position FROM script_blocks WHERE id=?')
        .get(data.beforeId) as any;
      if (!before) throw new Error('段落已不存在');
      position = before.position;
      db.prepare(
        'UPDATE script_blocks SET position=position+1 WHERE position>=?',
      ).run(position);
    }
    db.prepare(
      "INSERT INTO script_blocks(id,position,kind,draft_text) VALUES (?,?,'heading',?)",
    ).run(randomUUID(), position, data.title);
    if (!data.beforeId)
      db.prepare(
        "INSERT INTO script_blocks(id,position,kind,draft_text) VALUES (?,?,'body','')",
      ).run(randomUUID(), position + 1);
  });
}

export function addScriptParagraph(
  directory: string,
  sectionId: unknown,
): Project {
  const headingId = uuid.nullable().parse(sectionId);
  return mutateProject(directory, (db) => {
    let start = -1;
    if (headingId) {
      const heading = db
        .prepare(
          "SELECT position FROM script_blocks WHERE id=? AND kind='heading'",
        )
        .get(headingId) as any;
      if (!heading) throw new Error('脚本标题已不存在');
      start = heading.position;
    }
    const next = db
      .prepare(
        "SELECT MIN(position) AS n FROM script_blocks WHERE kind='heading' AND position>?",
      )
      .get(start) as any;
    const position =
      next.n ??
      (
        db
          .prepare(
            'SELECT COALESCE(MAX(position),-1)+1 AS n FROM script_blocks',
          )
          .get() as any
      ).n;
    db.prepare(
      'UPDATE script_blocks SET position=position+1 WHERE position>=?',
    ).run(position);
    db.prepare(
      "INSERT INTO script_blocks(id,position,kind,draft_text) VALUES (?,?,'body','')",
    ).run(randomUUID(), position);
  });
}

export function createShotsFromIdeas(
  directory: string,
  input: unknown,
  commandId: string,
  draft?: unknown,
): Project {
  const ids = z.array(uuid).min(1).max(100).parse(input);
  uuid.parse(commandId);
  if (new Set(ids).size !== ids.length) throw new Error('卡片重复');
  const descriptions =
    draft === undefined
      ? null
      : z.array(shotSchema).min(1).max(10).parse(draft);
  return mutateProject(directory, (db) => {
    if (db.prepare('SELECT 1 FROM commands WHERE command_id=?').get(commandId))
      return;
    const ideas = ids.map((id) => {
      const row = db
        .prepare('SELECT id,text FROM ideas WHERE id=?')
        .get(id) as any;
      if (!row) throw new Error('灵感不存在');
      return row;
    });
    const start = (
      db
        .prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM shots')
        .get() as any
    ).n;
    const rows =
      descriptions ??
      ideas.map(() => ({
        description: '',
        actionDialogue: '',
        durationMs: 3000,
      }));
    rows.forEach((row, index) => {
      const id = randomUUID();
      db.prepare(
        'INSERT INTO shots(id,position,description,action_dialogue,duration_ms) VALUES (?,?,?,?,?)',
      ).run(
        id,
        start + index,
        row.description,
        row.actionDialogue,
        row.durationMs,
      );
      for (const idea of descriptions ? ideas : [ideas[index]])
        db.prepare('INSERT INTO shot_sources VALUES (?,?,?,?)').run(
          randomUUID(),
          id,
          idea.id,
          idea.text,
        );
    });
    db.prepare('INSERT INTO commands VALUES (?,?)').run(
      commandId,
      JSON.stringify({
        count: rows.length,
      }),
    );
  });
}

export function saveScriptBlock(directory: string, input: unknown): Project {
  const b = z
    .object({
      id: uuid.optional(),
      kind: z.enum(['body', 'heading', 'note']),
      text: z.string().max(4000),
    })
    .parse(input);
  return mutateProject(directory, (db) => {
    if (!b.id) {
      const pos = (
        db
          .prepare(
            'SELECT COALESCE(MAX(position),-1)+1 AS n FROM script_blocks',
          )
          .get() as any
      ).n;
      db.prepare(
        'INSERT INTO script_blocks(id,position,kind,draft_text) VALUES (?,?,?,?)',
      ).run(randomUUID(), pos, b.kind, b.text);
      return;
    }
    const old = db
      .prepare('SELECT shot_id FROM script_blocks WHERE id=?')
      .get(b.id) as any;
    if (!old) throw new Error('段落不存在');
    if (old.shot_id) {
      if (b.kind !== 'body') throw new Error('关联镜头的段落保留正文类型');
      db.prepare('UPDATE shots SET action_dialogue=? WHERE id=?').run(
        b.text,
        old.shot_id,
      );
    } else
      db.prepare('UPDATE script_blocks SET kind=?,draft_text=? WHERE id=?').run(
        b.kind,
        b.text,
        b.id,
      );
  });
}

export function convertScriptBlocks(
  directory: string,
  input: unknown,
  commandId: string,
): Project {
  const ids = z.array(uuid).min(1).max(500).parse(input);
  uuid.parse(commandId);
  return mutateProject(directory, (db) => {
    if (db.prepare('SELECT 1 FROM commands WHERE command_id=?').get(commandId))
      return;
    let pos = (
      db
        .prepare('SELECT COALESCE(MAX(position),-1)+1 AS n FROM shots')
        .get() as any
    ).n;
    for (const id of [...new Set(ids)]) {
      const block = db
        .prepare('SELECT * FROM script_blocks WHERE id=?')
        .get(id) as any;
      if (!block) throw new Error('段落不存在');
      if (block.shot_id) continue;
      if (block.kind !== 'body') throw new Error('只有正文段落可转镜头');
      const shot = randomUUID();
      db.prepare(
        "INSERT INTO shots(id,position,description,action_dialogue,duration_ms) VALUES (?,?,'',?,3000)",
      ).run(shot, pos++, block.draft_text ?? '');
      db.prepare('DELETE FROM script_blocks WHERE id=?').run(shot);
      db.prepare(
        'UPDATE script_blocks SET shot_id=?,draft_text=NULL WHERE id=?',
      ).run(shot, id);
    }
    const ordered = (
      db
        .prepare(
          'SELECT shot_id FROM script_blocks WHERE shot_id IS NOT NULL ORDER BY position,id',
        )
        .all() as any[]
    ).map((b) => b.shot_id);
    reorderRows(db, ordered);
    db.prepare('INSERT INTO commands VALUES (?,?)').run(commandId, '{}');
  });
}

export function deleteScriptBlock(directory: string, id: string): Project {
  return mutateProject(directory, (db) => {
    const b = db
      .prepare('SELECT shot_id FROM script_blocks WHERE id=?')
      .get(uuid.parse(id)) as any;
    if (!b) throw new Error('段落不存在');
    if (b.shot_id) {
      for (const table of ['shot_assets', 'shot_candidates', 'shot_audio'])
        db.prepare(`DELETE FROM ${table} WHERE shot_id=?`).run(b.shot_id);
      db.prepare('DELETE FROM shots WHERE id=?').run(b.shot_id);
    } else db.prepare('DELETE FROM script_blocks WHERE id=?').run(id);
    const ids = (
      db.prepare('SELECT id FROM shots ORDER BY position').all() as any[]
    ).map((s) => s.id);
    reorderRows(db, ids);
  });
}

export function splitScriptBlock(
  directory: string,
  id: string,
  offsetInput: unknown,
): Project {
  const offset = z.number().int().positive().parse(offsetInput);
  uuid.parse(id);
  return mutateProject(directory, (db) => {
    const block = db
      .prepare(
        'SELECT b.*,s.action_dialogue,s.duration_ms FROM script_blocks b LEFT JOIN shots s ON s.id=b.shot_id WHERE b.id=?',
      )
      .get(id) as any;
    if (!block || block.kind !== 'body') throw new Error('只能拆分正文段落');
    const text = block.shot_id
      ? block.action_dialogue
      : (block.draft_text ?? '');
    if (offset >= text.length) throw new Error('请把光标放在正文中间再拆分');
    db.prepare(
      'UPDATE script_blocks SET position=position+1 WHERE position>?',
    ).run(block.position);
    if (!block.shot_id) {
      db.prepare('UPDATE script_blocks SET draft_text=? WHERE id=?').run(
        text.slice(0, offset),
        id,
      );
      db.prepare(
        "INSERT INTO script_blocks(id,position,kind,draft_text) VALUES (?,?,'body',?)",
      ).run(randomUUID(), block.position + 1, text.slice(offset));
    } else {
      const shot = randomUUID(),
        duration = Math.max(
          100,
          Math.round((block.duration_ms * offset) / text.length),
        );
      db.prepare(
        'UPDATE shots SET action_dialogue=?,duration_ms=?,needs_review=1 WHERE id=?',
      ).run(text.slice(0, offset), duration, block.shot_id);
      db.prepare(
        "INSERT INTO shots(id,position,description,action_dialogue,duration_ms,needs_review) VALUES (?,0,'',?,?,1)",
      ).run(
        shot,
        text.slice(offset),
        Math.max(100, block.duration_ms - duration),
      );
      db.prepare('UPDATE script_blocks SET position=? WHERE shot_id=?').run(
        block.position + 1,
        shot,
      );
      for (const source of db
        .prepare('SELECT idea_id,excerpt FROM shot_sources WHERE shot_id=?')
        .all(block.shot_id) as any[])
        db.prepare('INSERT INTO shot_sources VALUES (?,?,?,?)').run(
          randomUUID(),
          shot,
          source.idea_id,
          source.excerpt,
        );
    }
    reorderRows(
      db,
      (
        db
          .prepare(
            'SELECT shot_id FROM script_blocks WHERE shot_id IS NOT NULL ORDER BY position,id',
          )
          .all() as any[]
      ).map((b) => b.shot_id),
    );
  });
}

export function mergeScriptBlocks(
  directory: string,
  firstId: string,
  secondId: string,
): Project {
  uuid.parse(firstId);
  uuid.parse(secondId);
  if (firstId === secondId) throw new Error('请选择两个不同段落');
  return mutateProject(directory, (db) => {
    const blocks = db
        .prepare(
          'SELECT b.*,s.action_dialogue,s.duration_ms FROM script_blocks b LEFT JOIN shots s ON s.id=b.shot_id ORDER BY b.position,b.id',
        )
        .all() as any[],
      index = blocks.findIndex((b) => b.id === firstId),
      first = blocks[index],
      second = blocks[index + 1];
    if (
      !first ||
      second?.id !== secondId ||
      first.kind !== 'body' ||
      second.kind !== 'body' ||
      !!first.shot_id !== !!second.shot_id
    )
      throw new Error('只能合并相邻的两个草稿段落，或相邻的两个镜头正文');
    const text =
      (first.shot_id ? first.action_dialogue : (first.draft_text ?? '')) +
      '\n' +
      (second.shot_id ? second.action_dialogue : (second.draft_text ?? ''));
    if (text.length > 4000) throw new Error('合并后的正文超过 4000 字符');
    if (!first.shot_id) {
      db.prepare('UPDATE script_blocks SET draft_text=? WHERE id=?').run(
        text,
        first.id,
      );
      db.prepare('DELETE FROM script_blocks WHERE id=?').run(second.id);
    } else {
      db.prepare(
        'UPDATE shots SET action_dialogue=?,duration_ms=?,needs_review=1 WHERE id=?',
      ).run(
        text,
        Math.min(600000, first.duration_ms + second.duration_ms),
        first.shot_id,
      );
      db.prepare('UPDATE shot_sources SET shot_id=? WHERE shot_id=?').run(
        first.shot_id,
        second.shot_id,
      );
      db.prepare(
        'INSERT OR IGNORE INTO shot_candidates(shot_id,asset_id) SELECT ?,asset_id FROM shot_candidates WHERE shot_id=?',
      ).run(first.shot_id, second.shot_id);
      for (const table of ['shot_assets', 'shot_audio', 'shot_candidates'])
        db.prepare(`DELETE FROM ${table} WHERE shot_id=?`).run(second.shot_id);
      db.prepare('DELETE FROM shots WHERE id=?').run(second.shot_id);
    }
    reorderRows(
      db,
      (
        db.prepare('SELECT id FROM shots ORDER BY position,id').all() as any[]
      ).map((s) => s.id),
    );
  });
}
