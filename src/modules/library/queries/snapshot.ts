import { existsSync } from 'node:fs';

import path from 'node:path';

import { z } from 'zod';

import { uuid } from '../../../shared/schemas';

import { colorFamilies } from '../../../shared/colors';

import * as boxes from '../../organization';

import type { AssetSelect } from '../../../shared/models';

import type {
  LibraryPage,
  LibraryQuery,
  Relation,
} from '../../../shared/models';

import { Row, openLibrary } from '../database';

import { escapeLike, parseAsset, parseIdea } from '../parsing';

import { safeLibraryPath } from '../storage-paths';

import { selectUsage } from '../services/selects';

export function readLibrary(
  root: string,
  query: LibraryQuery = {},
): LibraryPage {
  const q = z
    .object({
      boxId: uuid.nullable().optional(),
      search: z.string().max(500).optional(),
      tag: z.string().max(100).optional(),
      kind: z.string().max(20).optional(),
      color: z.enum(colorFamilies.map((f) => f.id)).optional(),
      after: z.string().optional(),
      before: z.string().optional(),
      hidden: z.boolean().optional(),
      starred: z.boolean().optional(),
      unused: z.boolean().optional(),
      missing: z.boolean().optional(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(30),
    })
    .parse(query);
  const db = openLibrary(root),
    id = (db.prepare('SELECT id FROM library_meta').get() as Row).id;
  try {
    let ideaBoxCounts: Record<string, number> = {};
    function select(table: 'ideas' | 'assets') {
      const clauses = ['e.hidden=?'],
        params: any[] = [q.hidden ? 1 : 0];
      if (q.search) {
        clauses.push(
          `(e.${table === 'ideas' ? 'text' : 'name'} LIKE ? ESCAPE '\\' OR e.tags LIKE ? ESCAPE '\\'${table === 'ideas' ? " OR e.notes LIKE ? ESCAPE '\\'" : ''})`,
        );
        const term = `%${escapeLike(q.search)}%`;
        params.push(term, term);
        if (table === 'ideas') params.push(term);
      }
      if (q.tag) {
        clauses.push(
          `EXISTS(SELECT 1 FROM ${table === 'ideas' ? 'idea_tags' : 'asset_tags'} et JOIN tags t ON t.id=et.tag_id WHERE et.entity_id=e.id AND t.label=?)`,
        );
        params.push(q.tag.normalize('NFKC').trim().toLowerCase());
      }
      if (table === 'ideas' && q.color) {
        clauses.push(
          "EXISTS(SELECT 1 FROM json_each(e.payload_json,'$.colors') color WHERE watercut_color_family(color.value)=?)",
        );
        params.push(q.color);
      }
      if (
        q.kind &&
        ((table === 'ideas' && ['note', 'mood', 'scene'].includes(q.kind)) ||
          (table === 'assets' && ['image', 'video', 'audio'].includes(q.kind)))
      ) {
        clauses.push('e.kind=?');
        params.push(q.kind);
      }
      const date =
        table === 'ideas'
          ? 'COALESCE(e.occurred_at,e.recorded_at)'
          : 'e.imported_at';
      if (q.after) {
        clauses.push(`${date}>=?`);
        params.push(q.after);
      }
      if (q.before) {
        clauses.push(`${date}<?`);
        params.push(q.before);
      }
      if (table === 'ideas') {
        const counts = db
          .prepare(
            `SELECT COALESCE(m.box_id,'unfiled') AS box_id,count(*) AS n FROM ideas e LEFT JOIN idea_box_items m ON m.idea_id=e.id WHERE ${clauses.join(' AND ')} GROUP BY m.box_id`,
          )
          .all(...params) as Row[];
        ideaBoxCounts = Object.fromEntries(counts.map((r) => [r.box_id, r.n]));
        if (q.boxId !== undefined) {
          clauses.push(
            q.boxId === null
              ? 'NOT EXISTS(SELECT 1 FROM idea_box_items m WHERE m.idea_id=e.id)'
              : 'EXISTS(SELECT 1 FROM idea_box_items m WHERE m.idea_id=e.id AND m.box_id=?)',
          );
          if (q.boxId !== null) params.push(q.boxId);
        }
      }
      if (table === 'assets' && q.starred) clauses.push('e.starred=1');
      if (table === 'assets' && q.unused)
        clauses.push(
          "NOT EXISTS(SELECT 1 FROM usage_index u WHERE u.global_id=e.id AND u.entity_kind='asset' AND u.role='main')",
        );
      const where = clauses.join(' AND '),
        count = (
          db
            .prepare(`SELECT COUNT(*) AS n FROM ${table} e WHERE ${where}`)
            .get(...params) as Row
        ).n;
      const columns =
        table === 'ideas'
          ? 'e.*'
          : "e.*,(SELECT payload_json FROM asset_metadata WHERE asset_id=e.id) AS metadata_json,b.relative_path,b.size,(SELECT COUNT(*) FROM usage_index u WHERE u.global_id=e.id AND u.entity_kind='asset' AND u.role='main') AS usage_count";
      const join =
        table === 'assets' ? 'JOIN blobs b ON b.sha256=e.blob_sha256' : '';
      // Missing files are an external condition, so evaluate before paging when requested.
      const rows = db
        .prepare(
          `SELECT ${columns} FROM ${table} e ${join} WHERE ${where} ORDER BY ${date} DESC,e.id DESC ${q.missing && table === 'assets' ? '' : 'LIMIT ? OFFSET ?'}`,
        )
        .all(
          ...params,
          ...(q.missing && table === 'assets' ? [] : [q.limit, q.offset]),
        ) as Row[];
      if (table === 'assets' && q.missing) {
        const missing = rows.filter(
          (r) => !existsSync(safeLibraryPath(root, r.relative_path)),
        );
        return {
          rows: missing.slice(q.offset, q.offset + q.limit),
          count: missing.length,
        };
      }
      return {
        rows,
        count,
      };
    }
    const ideas = select('ideas'),
      assets = select('assets');
    const projects = (
      db
        .prepare('SELECT * FROM project_catalog ORDER BY last_seen DESC')
        .all() as Row[]
    ).map((r) => ({
      id: r.project_id,
      name: r.name,
      directory: r.path,
      archived: !!r.archived,
      available: existsSync(path.join(r.path, 'project.sqlite')),
      lastSeen: r.last_seen,
      indexedRevision: r.indexed_revision,
    }));
    const parsedIdeas = ideas.rows.map((r) => parseIdea(db, r, id)),
      mediaIds = [
        ...new Set(parsedIdeas.flatMap((i) => i.media.map((m) => m.assetId))),
      ];
    const referenceAssets = mediaIds.length
      ? (
          db
            .prepare(
              `SELECT a.*,(SELECT payload_json FROM asset_metadata WHERE asset_id=a.id) AS metadata_json,b.relative_path,b.size FROM assets a JOIN blobs b ON b.sha256=a.blob_sha256 WHERE a.id IN (${mediaIds.map(() => '?').join(',')})`,
            )
            .all(...mediaIds) as Row[]
        ).map((r) => parseAsset(root, r, id))
      : [];
    return {
      assetSelects: assets.rows.length
        ? db
            .prepare(
              `SELECT s.id,s.asset_id AS assetId,s.name,s.in_ms AS inMs,s.out_ms AS outMs,s.note,s.version,s.hidden,? AS libraryId FROM selects s WHERE s.hidden=0 AND s.asset_id IN (${assets.rows.map(() => '?').join(',')}) ORDER BY s.in_ms,s.id`,
            )
            .all(id, ...assets.rows.map((a) => a.id))
            .map((r) =>
              selectUsage(db, { ...r, hidden: !!r.hidden } as AssetSelect),
            )
        : [],
      ideaBoxes: boxes.readIdeaBoxes(db),
      ideaBoxCounts,
      id,
      root,
      ideas: parsedIdeas,
      assets: assets.rows.map((r) => parseAsset(root, r, id)),
      referenceAssets,
      relations: db.prepare('SELECT * FROM idea_relations').all() as Relation[],
      projects,
      totalIdeas: ideas.count,
      totalAssets: assets.count,
    };
  } finally {
    db.close();
  }
}
