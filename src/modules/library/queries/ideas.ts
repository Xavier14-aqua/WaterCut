import { z } from 'zod';

import { tagsOf, uuid } from '../../../shared/schemas';

import type {
  LibraryAsset,
  LibraryIdea,
  RelatedIdea,
} from '../../../shared/models';

import { Row, openLibrary } from '../database';

import { escapeLike, parseAsset, parseIdea } from '../parsing';

export function getLibraryIdea(root: string, id: string): LibraryIdea {
  const db = openLibrary(root, false);
  try {
    const row = db.prepare('SELECT * FROM ideas WHERE id=?').get(id) as
      | Row
      | undefined;
    if (!row) throw new Error('灵感不存在');
    return parseIdea(
      db,
      row,
      (db.prepare('SELECT id FROM library_meta').get() as Row).id,
    );
  } finally {
    db.close();
  }
}

export function relatedIdeas(root: string, id: string): RelatedIdea[] {
  const current = getLibraryIdea(root, id),
    db = openLibrary(root, false);
  try {
    const lib = (db.prepare('SELECT id FROM library_meta').get() as Row).id;
    return (
      db
        .prepare('SELECT * FROM ideas WHERE id!=? AND hidden=0')
        .all(id) as Row[]
    )
      .map((row) => {
        const idea = parseIdea(db, row, lib),
          common = tagsOf(idea.tags).filter((t) =>
            tagsOf(current.tags).includes(t),
          );
        const days =
          Math.abs(
            Date.parse(idea.occurredAt ?? idea.recordedAt) -
              Date.parse(current.occurredAt ?? current.recordedAt),
          ) / 86400000;
        const reasons = [
          ...common.map((t) => `共同标签：${t}`),
          ...(days <= 7 ? [`记录时间相近（${Math.floor(days)} 天）`] : []),
        ];
        return {
          idea,
          reasons,
          score: common.length * 10 + Math.max(0, 7 - days),
        };
      })
      .filter((v) => v.reasons.length)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  } finally {
    db.close();
  }
}

export function ideaEchoes(
  root: string,
  input: unknown,
): { ideas: RelatedIdea[]; assets: LibraryAsset[] } {
  const q = z
    .object({
      text: z.string().max(8000),
      tags: z.string().max(500),
      exclude: z.array(uuid).max(500).default([]),
    })
    .parse(input);
  const words =
      q.text
        .normalize('NFKC')
        .toLowerCase()
        .match(/[\p{L}\p{N}]{2,}/gu) ?? [],
    tags = tagsOf(q.tags).map((t) => t.toLowerCase());
  const terms = [
    ...new Set([
      ...tags,
      ...words.flatMap((w) =>
        /^[\u3400-\u9fff]+$/.test(w) && w.length > 4
          ? Array.from({ length: w.length - 1 }, (_, i) => w.slice(i, i + 2))
          : w,
      ),
    ]),
  ]
    .filter((t) => t.length >= 2)
    .slice(0, 16);
  if (!terms.length) return { ideas: [], assets: [] };
  const db = openLibrary(root, false);
  try {
    const lib = (db.prepare('SELECT id FROM library_meta').get() as Row).id,
      patterns = terms.map((t) => `%${escapeLike(t)}%`),
      where = (fields: string) =>
        terms.map(() => `lower(${fields}) LIKE ? ESCAPE '\\'`).join(' OR ');
    const ideaRows = db
      .prepare(
        `SELECT * FROM ideas WHERE hidden=0 AND (${where("text||' '||tags||' '||notes")}) ORDER BY recorded_at DESC LIMIT 200`,
      )
      .all(...patterns) as Row[];
    const ideas = ideaRows
      .filter((r) => !q.exclude.includes(r.id))
      .map((row) => {
        const common = terms.filter((t) =>
          (row.text + ' ' + row.tags + ' ' + row.notes)
            .toLowerCase()
            .includes(t),
        );
        return {
          idea: parseIdea(db, row, lib),
          reasons: common.slice(0, 3).map((t) => `本地关键词：${t}`),
          score: common.reduce((n, t) => n + (tags.includes(t) ? 10 : 1), 0),
        };
      })
      .sort((a, b) => b.score - a.score || a.idea.id.localeCompare(b.idea.id))
      .slice(0, 6);
    const assetRows = db
      .prepare(
        `SELECT a.*,(SELECT payload_json FROM asset_metadata WHERE asset_id=a.id) AS metadata_json,b.relative_path,b.size FROM assets a JOIN blobs b ON b.sha256=a.blob_sha256 WHERE a.hidden=0 AND a.kind!='audio' AND (${where("a.name||' '||a.tags")}) AND NOT EXISTS(SELECT 1 FROM usage_index u WHERE u.global_id=a.id AND u.role='main') ORDER BY a.imported_at DESC LIMIT 12`,
      )
      .all(...patterns) as Row[];
    return {
      ideas,
      assets: assetRows
        .map((r) => parseAsset(root, r, lib))
        .filter((a) => !a.missing)
        .slice(0, 4),
    };
  } finally {
    db.close();
  }
}
