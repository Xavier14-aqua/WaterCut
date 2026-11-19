import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, statfsSync } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { z } from 'zod';
import { ideaSchema, tagsOf, uuid } from './shared/schemas';
import { colorFamily, colorFamilies } from './shared/colors';
import * as boxes from './idea-boxes';
import { selectInputSchema,validateMediaRange,rangesOverlap } from './shared/creative';
import type { AssetSelect } from './shared/models';
import type { IdeaInput, LibraryAsset, LibraryIdea, LibraryPage, LibraryQuery, Project, RelatedIdea, Relation, Usage } from './shared/models';
const kinds: Record<string, 'image' | 'video' | 'audio'> = {
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.webp': 'image',
  '.gif': 'image',
  '.mp4': 'video',
  '.mov': 'video',
  '.webm': 'video',
  '.mp3': 'audio',
  '.wav': 'audio',
  '.m4a': 'audio'
};
type Row = Record<string, any>;
export function openLibrary(root: string, create = true): DatabaseSync {
  const file = path.join(root, 'library.sqlite');
  if (!existsSync(file) && !create) throw new Error('全局库不可用，请在设置中重新选择');
  mkdirSync(root, {
    recursive: true
  });
  const db = new DatabaseSync(file);
  db.function('watercut_color_family', {
    deterministic: true
  }, value => colorFamily(value));
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  try {
    const version = (db.prepare('PRAGMA user_version').get() as Row).user_version;
    if (version > 4) throw new Error('全局库版本较新，请升级 WaterCut');
    if (version > 0 && version < 4) db.prepare('VACUUM INTO ?').run(`${file}.before-v4.${randomUUID()}.bak`);
    if (version === 0) {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1").get()) throw new Error('所选数据库不是 WaterCut 全局库');
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE library_meta(id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
        CREATE TABLE blobs(sha256 TEXT PRIMARY KEY,relative_path TEXT NOT NULL,size INTEGER NOT NULL);
        CREATE TABLE assets(id TEXT PRIMARY KEY,blob_sha256 TEXT NOT NULL REFERENCES blobs(sha256),name TEXT NOT NULL,kind TEXT NOT NULL,tags TEXT NOT NULL DEFAULT '',duration_ms INTEGER,imported_at TEXT NOT NULL,starred INTEGER NOT NULL DEFAULT 0,hidden INTEGER NOT NULL DEFAULT 0,palette_json TEXT NOT NULL DEFAULT '[]');
        CREATE INDEX assets_kind_time ON assets(kind,imported_at,id);
        CREATE TABLE ideas(id TEXT PRIMARY KEY,kind TEXT NOT NULL,text TEXT NOT NULL,tags TEXT NOT NULL,notes TEXT NOT NULL,payload_json TEXT NOT NULL,recorded_at TEXT NOT NULL,occurred_at TEXT,version INTEGER NOT NULL DEFAULT 1,hidden INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX ideas_time ON ideas(recorded_at,id);
        CREATE TABLE idea_media(idea_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,asset_id TEXT NOT NULL REFERENCES assets(id),role TEXT NOT NULL,position INTEGER NOT NULL,in_ms INTEGER NOT NULL,out_ms INTEGER,PRIMARY KEY(idea_id,asset_id,role));
        CREATE TABLE tags(id INTEGER PRIMARY KEY,label TEXT NOT NULL UNIQUE);
        CREATE TABLE idea_tags(entity_id TEXT NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,tag_id INTEGER NOT NULL REFERENCES tags(id),PRIMARY KEY(entity_id,tag_id));
        CREATE TABLE asset_tags(entity_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,tag_id INTEGER NOT NULL REFERENCES tags(id),PRIMARY KEY(entity_id,tag_id));
        CREATE INDEX idea_tags_tag ON idea_tags(tag_id,entity_id);
        CREATE INDEX asset_tags_tag ON asset_tags(tag_id,entity_id);
        CREATE TABLE idea_relations(id TEXT PRIMARY KEY,source TEXT NOT NULL REFERENCES ideas(id),target TEXT NOT NULL REFERENCES ideas(id),kind TEXT NOT NULL,note TEXT NOT NULL,UNIQUE(source,target,kind));
        CREATE TABLE project_catalog(project_id TEXT PRIMARY KEY,path TEXT NOT NULL,name TEXT NOT NULL,archived INTEGER NOT NULL,last_seen TEXT NOT NULL,indexed_revision INTEGER NOT NULL);
        CREATE TABLE usage_index(project_id TEXT NOT NULL REFERENCES project_catalog(project_id) ON DELETE CASCADE,entity_kind TEXT NOT NULL,global_id TEXT NOT NULL,shot_id TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(project_id,entity_kind,global_id,shot_id,role));
        CREATE INDEX usage_global ON usage_index(global_id);
        CREATE TABLE operations(operation_id TEXT PRIMARY KEY,kind TEXT NOT NULL,stage TEXT NOT NULL,mapping_json TEXT NOT NULL DEFAULT '{}',error TEXT);
        PRAGMA user_version=1;`);
      db.prepare('INSERT INTO library_meta VALUES (?,?)').run(randomUUID(), new Date().toISOString());
      db.exec('COMMIT');
    }
    if (version < 2) db.exec('BEGIN IMMEDIATE; CREATE TABLE asset_metadata(asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,payload_json TEXT NOT NULL); PRAGMA user_version=2; COMMIT;');
    if (version < 3) db.exec(`BEGIN IMMEDIATE; ${boxes.ideaBoxTables} PRAGMA user_version=3; COMMIT;`);
    if(version<4){db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS selects(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES assets(id),name TEXT NOT NULL,in_ms INTEGER NOT NULL,out_ms INTEGER NOT NULL,note TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,hidden INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS selects_asset ON selects(asset_id,in_ms,out_ms);`);
      const columns=new Set((db.prepare('PRAGMA table_info(usage_index)').all() as any[]).map(c=>c.name));
      for(const definition of ['shot_number INTEGER','in_ms INTEGER NOT NULL DEFAULT 0','out_ms INTEGER','source_select_id TEXT','indexed_version INTEGER NOT NULL DEFAULT 0'])if(!columns.has(definition.split(' ')[0]))db.exec(`ALTER TABLE usage_index ADD COLUMN ${definition}`);
      db.exec('PRAGMA user_version=4; COMMIT;');
    }
    if (!db.prepare('SELECT id FROM library_meta').get()) throw new Error('全局库标识缺失');
    return db;
  } catch (error) {
    try {
      if (db.isTransaction) db.exec('ROLLBACK');
    } finally {
      db.close();
    }
    throw error;
  }
}
export function libraryId(root: string): string {
  const db = openLibrary(root);
  try {
    return (db.prepare('SELECT id FROM library_meta').get() as Row).id;
  } finally {
    db.close();
  }
}
function transact<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
function indexTags(db: DatabaseSync, table: 'idea_tags' | 'asset_tags', id: string, text: string) {
  db.prepare(`DELETE FROM ${table} WHERE entity_id=?`).run(id);
  for (const label of tagsOf(text)) {
    db.prepare('INSERT OR IGNORE INTO tags(label) VALUES (?)').run(label);
    db.prepare(`INSERT INTO ${table}(entity_id,tag_id) SELECT ?,id FROM tags WHERE label=?`).run(id, label);
  }
}
function parseIdea(db: DatabaseSync, row: Row, id: string): LibraryIdea {
  const media = db.prepare('SELECT asset_id AS assetId,role,position,in_ms AS inMs,out_ms AS outMs FROM idea_media WHERE idea_id=? ORDER BY position').all(row.id) as any;
  return {
    boxId: (db.prepare('SELECT box_id FROM idea_box_items WHERE idea_id=?').get(row.id) as Row | undefined)?.box_id ?? null,
    id: row.id,
    libraryId: id,
    kind: row.kind,
    text: row.text,
    tags: row.tags,
    notes: row.notes,
    payload: JSON.parse(row.payload_json),
    recordedAt: row.recorded_at,
    occurredAt: row.occurred_at,
    version: row.version,
    hidden: !!row.hidden,
    media
  };
}
function parseAsset(root: string, row: Row, id: string): LibraryAsset {
  return {
    id: row.id,
    libraryId: id,
    name: row.name,
    kind: row.kind,
    relativePath: row.relative_path,
    size: row.size,
    tags: row.tags,
    sha256: row.blob_sha256,
    durationMs: row.duration_ms,
    starred: !!row.starred,
    hidden: !!row.hidden,
    importedAt: row.imported_at,
    missing: !existsSync(safeLibraryPath(root, row.relative_path)),
    thumbnail: existsSync(path.join(root, 'thumbnails', `${row.id}.png`)),
    palette: JSON.parse(row.palette_json),
    usageCount: row.usage_count ?? 0,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null
  };
}
export function safeLibraryPath(root: string, relative: string): string {
  if (path.isAbsolute(relative)) throw new Error('素材路径无效');
  const resolved = path.resolve(root, relative),
    prefix = path.resolve(root) + path.sep;
  if (!resolved.toLowerCase().startsWith(prefix.toLowerCase())) throw new Error('素材路径超出全局库');
  return resolved;
}
export function getLibraryAsset(root: string, id: string, includeHidden = true): LibraryAsset {
  const db = openLibrary(root, false);
  try {
    const row = db.prepare(`SELECT a.*,(SELECT payload_json FROM asset_metadata WHERE asset_id=a.id) AS metadata_json,b.relative_path,b.size FROM assets a JOIN blobs b ON b.sha256=a.blob_sha256 WHERE a.id=? ${includeHidden ? '' : 'AND a.hidden=0'}`).get(id) as Row | undefined;
    if (!row) throw new Error('素材不存在');
    return parseAsset(root, row, (db.prepare('SELECT id FROM library_meta').get() as Row).id);
  } finally {
    db.close();
  }
}
export function getLibraryIdea(root: string, id: string): LibraryIdea {
  const db = openLibrary(root, false);
  try {
    const row = db.prepare('SELECT * FROM ideas WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new Error('灵感不存在');
    return parseIdea(db, row, (db.prepare('SELECT id FROM library_meta').get() as Row).id);
  } finally {
    db.close();
  }
}
export function resolveLibraryAsset(root: string, sourceLibraryId: string, sourceAssetId: string, sha256: string | null): string | null {
  try {
    const asset = getLibraryAsset(root, sourceAssetId);
    return asset.libraryId === sourceLibraryId && asset.sha256 === sha256 ? safeLibraryPath(root, asset.relativePath) : null;
  } catch {
    return null;
  }
}
export function saveLibraryIdea(root: string, input: IdeaInput, creationId?: string): LibraryIdea {
  const data = ideaSchema.parse(input),
    id = input.id ? uuid.parse(input.id) : creationId ? uuid.parse(creationId) : randomUUID(),
    db = openLibrary(root);
  try {
    transact(db, () => {
      const old = db.prepare('SELECT version FROM ideas WHERE id=?').get(id) as Row | undefined;
      if (input.id && !old) throw new Error('灵感已不存在');
      if (old && creationId && !input.id) return;
      if (old && input.expectedVersion !== old.version) throw new Error('灵感已被更新，请重新打开后再保存；当前编辑仍保留');
      for (const m of data.media) {
        const a = db.prepare('SELECT kind FROM assets WHERE id=?').get(m.assetId) as Row | undefined;
        if (!a || a.kind !== m.role) throw new Error('参考素材类型不匹配或素材不存在');
      }
      if (old) db.prepare('UPDATE ideas SET kind=?,text=?,tags=?,notes=?,payload_json=?,occurred_at=?,version=version+1 WHERE id=?').run(data.kind, data.text, data.tags, data.notes, JSON.stringify(data.payload), data.occurredAt, id);else db.prepare('INSERT INTO ideas(id,kind,text,tags,notes,payload_json,recorded_at,occurred_at) VALUES (?,?,?,?,?,?,?,?)').run(id, data.kind, data.text, data.tags, data.notes, JSON.stringify(data.payload), new Date().toISOString(), data.occurredAt);
      db.prepare('DELETE FROM idea_media WHERE idea_id=?').run(id);
      for (const m of data.media) db.prepare('INSERT INTO idea_media VALUES (?,?,?,?,?,?)').run(id, m.assetId, m.role, m.position, m.inMs, m.outMs);
      indexTags(db, 'idea_tags', id, data.tags);
    });
  } finally {
    db.close();
  }
  return getLibraryIdea(root, id);
}
export function setLibraryHidden(root: string, kind: 'idea' | 'asset', id: string, hidden: boolean): void {
  uuid.parse(id);
  const db = openLibrary(root, false);
  try {
    const result = db.prepare(`UPDATE ${kind === 'idea' ? 'ideas' : 'assets'} SET hidden=? WHERE id=?`).run(hidden ? 1 : 0, id);
    if (!result.changes) throw new Error('对象不存在');
  } finally {
    db.close();
  }
}
export function updateLibraryAsset(root: string, id: string, input: {
  name?: string;
  tags?: string;
  starred?: boolean;
  durationMs?: number;
  palette?: string[];
}): LibraryAsset {
  const data = z.object({
    name: z.string().trim().min(1).max(300).optional(),
    tags: z.string().max(500).optional(),
    starred: z.boolean().optional(),
    durationMs: z.number().int().positive().max(86400000).optional(),
    palette: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).max(6).optional()
  }).parse(input);
  const db = openLibrary(root, false);
  try {
    transact(db, () => {
      const row = db.prepare('SELECT * FROM assets WHERE id=?').get(id) as Row | undefined;
      if (!row) throw new Error('素材不存在');
      db.prepare('UPDATE assets SET name=?,tags=?,starred=?,duration_ms=?,palette_json=? WHERE id=?').run(data.name ?? row.name, data.tags ?? row.tags, data.starred === undefined ? row.starred : data.starred ? 1 : 0, data.durationMs ?? row.duration_ms, data.palette ? JSON.stringify(data.palette) : row.palette_json, id);
      if (data.tags !== undefined) indexTags(db, 'asset_tags', id, data.tags);
    });
  } finally {
    db.close();
  }
  return getLibraryAsset(root, id);
}
export function connectLibraryIdeas(root: string, source: string, target: string, kind: Relation['kind'], note: string): void {
  uuid.parse(source);
  uuid.parse(target);
  z.enum(['related', 'sequence', 'contrast']).parse(kind);
  z.string().max(2000).parse(note);
  if (source === target) throw new Error('不能关联自身');
  if (kind !== 'sequence' && source > target) [source, target] = [target, source];
  const db = openLibrary(root, false);
  try {
    db.prepare('INSERT INTO idea_relations VALUES (?,?,?,?,?) ON CONFLICT(source,target,kind) DO UPDATE SET note=excluded.note').run(randomUUID(), source, target, kind, note);
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
export function relatedIdeas(root: string, id: string): RelatedIdea[] {
  const current = getLibraryIdea(root, id),
    db = openLibrary(root, false);
  try {
    const lib = (db.prepare('SELECT id FROM library_meta').get() as Row).id;
    return (db.prepare('SELECT * FROM ideas WHERE id!=? AND hidden=0').all(id) as Row[]).map(row => {
      const idea = parseIdea(db, row, lib),
        common = tagsOf(idea.tags).filter(t => tagsOf(current.tags).includes(t));
      const days = Math.abs(Date.parse(idea.occurredAt ?? idea.recordedAt) - Date.parse(current.occurredAt ?? current.recordedAt)) / 86400000;
      const reasons = [...common.map(t => `共同标签：${t}`), ...(days <= 7 ? [`记录时间相近（${Math.floor(days)} 天）`] : [])];
      return {
        idea,
        reasons,
        score: common.length * 10 + Math.max(0, 7 - days)
      };
    }).filter(v => v.reasons.length).sort((a, b) => b.score - a.score).slice(0, 12);
  } finally {
    db.close();
  }
}
function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, '\\$&');
}
export function ideaEchoes(root:string,input:unknown):{ideas:RelatedIdea[];assets:LibraryAsset[]}{
  const q=z.object({text:z.string().max(8000),tags:z.string().max(500),exclude:z.array(uuid).max(500).default([])}).parse(input);
  const words=q.text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)??[],tags=tagsOf(q.tags).map(t=>t.toLowerCase());
  const terms=[...new Set([...tags,...words.flatMap(w=>/^[\u3400-\u9fff]+$/.test(w)&&w.length>4?Array.from({length:w.length-1},(_,i)=>w.slice(i,i+2)):w)])].filter(t=>t.length>=2).slice(0,16);
  if(!terms.length)return{ideas:[],assets:[]};
  const db=openLibrary(root,false);try{
    const lib=(db.prepare('SELECT id FROM library_meta').get() as Row).id,patterns=terms.map(t=>`%${escapeLike(t)}%`),where=(fields:string)=>terms.map(()=>`lower(${fields}) LIKE ? ESCAPE '\\'`).join(' OR ');
    const ideaRows=db.prepare(`SELECT * FROM ideas WHERE hidden=0 AND (${where("text||' '||tags||' '||notes")}) ORDER BY recorded_at DESC LIMIT 200`).all(...patterns) as Row[];
    const ideas=ideaRows.filter(r=>!q.exclude.includes(r.id)).map(row=>{const common=terms.filter(t=>(row.text+' '+row.tags+' '+row.notes).toLowerCase().includes(t));return{idea:parseIdea(db,row,lib),reasons:common.slice(0,3).map(t=>`本地关键词：${t}`),score:common.reduce((n,t)=>n+(tags.includes(t)?10:1),0)};}).sort((a,b)=>b.score-a.score||a.idea.id.localeCompare(b.idea.id)).slice(0,6);
    const assetRows=db.prepare(`SELECT a.*,(SELECT payload_json FROM asset_metadata WHERE asset_id=a.id) AS metadata_json,b.relative_path,b.size FROM assets a JOIN blobs b ON b.sha256=a.blob_sha256 WHERE a.hidden=0 AND a.kind!='audio' AND (${where("a.name||' '||a.tags")}) AND NOT EXISTS(SELECT 1 FROM usage_index u WHERE u.global_id=a.id AND u.role='main') ORDER BY a.imported_at DESC LIMIT 12`).all(...patterns) as Row[];
    return{ideas,assets:assetRows.map(r=>parseAsset(root,r,lib)).filter(a=>!a.missing).slice(0,4)};
  }finally{db.close();}
}
export function readLibrary(root: string, query: LibraryQuery = {}): LibraryPage {
  const q = z.object({
    boxId: uuid.nullable().optional(),
    search: z.string().max(500).optional(),
    tag: z.string().max(100).optional(),
    kind: z.string().max(20).optional(),
    color: z.enum(colorFamilies.map(f => f.id)).optional(),
    after: z.string().optional(),
    before: z.string().optional(),
    hidden: z.boolean().optional(),
    starred: z.boolean().optional(),
    unused: z.boolean().optional(),
    missing: z.boolean().optional(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(30)
  }).parse(query);
  const db = openLibrary(root),
    id = (db.prepare('SELECT id FROM library_meta').get() as Row).id;
  try {
    let ideaBoxCounts: Record<string, number> = {};
    function select(table: 'ideas' | 'assets') {
      const clauses = ['e.hidden=?'],
        params: any[] = [q.hidden ? 1 : 0];
      if (q.search) {
        clauses.push(`(e.${table === 'ideas' ? 'text' : 'name'} LIKE ? ESCAPE '\\' OR e.tags LIKE ? ESCAPE '\\'${table === 'ideas' ? " OR e.notes LIKE ? ESCAPE '\\'" : ''})`);
        const term = `%${escapeLike(q.search)}%`;
        params.push(term, term);
        if (table === 'ideas') params.push(term);
      }
      if (q.tag) {
        clauses.push(`EXISTS(SELECT 1 FROM ${table === 'ideas' ? 'idea_tags' : 'asset_tags'} et JOIN tags t ON t.id=et.tag_id WHERE et.entity_id=e.id AND t.label=?)`);
        params.push(q.tag.normalize('NFKC').trim().toLowerCase());
      }
      if (table === 'ideas' && q.color) {
        clauses.push("EXISTS(SELECT 1 FROM json_each(e.payload_json,'$.colors') color WHERE watercut_color_family(color.value)=?)");
        params.push(q.color);
      }
      if (q.kind && (table === 'ideas' && ['note', 'mood', 'scene'].includes(q.kind) || table === 'assets' && ['image', 'video', 'audio'].includes(q.kind))) {
        clauses.push('e.kind=?');
        params.push(q.kind);
      }
      const date = table === 'ideas' ? 'COALESCE(e.occurred_at,e.recorded_at)' : 'e.imported_at';
      if (q.after) {
        clauses.push(`${date}>=?`);
        params.push(q.after);
      }
      if (q.before) {
        clauses.push(`${date}<?`);
        params.push(q.before);
      }
      if (table === 'ideas') {
        const counts = db.prepare(`SELECT COALESCE(m.box_id,'unfiled') AS box_id,count(*) AS n FROM ideas e LEFT JOIN idea_box_items m ON m.idea_id=e.id WHERE ${clauses.join(' AND ')} GROUP BY m.box_id`).all(...params) as Row[];
        ideaBoxCounts = Object.fromEntries(counts.map(r => [r.box_id, r.n]));
        if (q.boxId !== undefined) {
          clauses.push(q.boxId === null ? 'NOT EXISTS(SELECT 1 FROM idea_box_items m WHERE m.idea_id=e.id)' : 'EXISTS(SELECT 1 FROM idea_box_items m WHERE m.idea_id=e.id AND m.box_id=?)');
          if (q.boxId !== null) params.push(q.boxId);
        }
      }
      if (table === 'assets' && q.starred) clauses.push('e.starred=1');
      if (table === 'assets' && q.unused) clauses.push("NOT EXISTS(SELECT 1 FROM usage_index u WHERE u.global_id=e.id AND u.entity_kind='asset' AND u.role='main')");
      const where = clauses.join(' AND '),
        count = (db.prepare(`SELECT COUNT(*) AS n FROM ${table} e WHERE ${where}`).get(...params) as Row).n;
      const columns = table === 'ideas' ? 'e.*' : "e.*,(SELECT payload_json FROM asset_metadata WHERE asset_id=e.id) AS metadata_json,b.relative_path,b.size,(SELECT COUNT(*) FROM usage_index u WHERE u.global_id=e.id AND u.entity_kind='asset' AND u.role='main') AS usage_count";
      const join = table === 'assets' ? 'JOIN blobs b ON b.sha256=e.blob_sha256' : '';
      // Missing files are an external condition, so evaluate before paging when requested.
      const rows = db.prepare(`SELECT ${columns} FROM ${table} e ${join} WHERE ${where} ORDER BY ${date} DESC,e.id DESC ${q.missing && table === 'assets' ? '' : 'LIMIT ? OFFSET ?'}`).all(...params, ...(q.missing && table === 'assets' ? [] : [q.limit, q.offset])) as Row[];
      if (table === 'assets' && q.missing) {
        const missing = rows.filter(r => !existsSync(safeLibraryPath(root, r.relative_path)));
        return {
          rows: missing.slice(q.offset, q.offset + q.limit),
          count: missing.length
        };
      }
      return {
        rows,
        count
      };
    }
    const ideas = select('ideas'),
      assets = select('assets');
    const projects = (db.prepare('SELECT * FROM project_catalog ORDER BY last_seen DESC').all() as Row[]).map(r => ({
      id: r.project_id,
      name: r.name,
      directory: r.path,
      archived: !!r.archived,
      available: existsSync(path.join(r.path, 'project.sqlite')),
      lastSeen: r.last_seen,
      indexedRevision: r.indexed_revision
    }));
    const parsedIdeas = ideas.rows.map(r => parseIdea(db, r, id)),
      mediaIds = [...new Set(parsedIdeas.flatMap(i => i.media.map(m => m.assetId)))];
    const referenceAssets = mediaIds.length ? (db.prepare(`SELECT a.*,(SELECT payload_json FROM asset_metadata WHERE asset_id=a.id) AS metadata_json,b.relative_path,b.size FROM assets a JOIN blobs b ON b.sha256=a.blob_sha256 WHERE a.id IN (${mediaIds.map(() => '?').join(',')})`).all(...mediaIds) as Row[]).map(r => parseAsset(root, r, id)) : [];
    return {
      assetSelects:assets.rows.length?db.prepare(`SELECT s.id,s.asset_id AS assetId,s.name,s.in_ms AS inMs,s.out_ms AS outMs,s.note,s.version,s.hidden,? AS libraryId FROM selects s WHERE s.hidden=0 AND s.asset_id IN (${assets.rows.map(()=>'?').join(',')}) ORDER BY s.in_ms,s.id`).all(id,...assets.rows.map(a=>a.id)).map(r=>selectUsage(db,{...r,hidden:!!r.hidden} as AssetSelect)):[],
      ideaBoxes: boxes.readIdeaBoxes(db),
      ideaBoxCounts,
      id,
      root,
      ideas: parsedIdeas,
      assets: assets.rows.map(r => parseAsset(root, r, id)),
      referenceAssets,
      relations: db.prepare('SELECT * FROM idea_relations').all() as Relation[],
      projects,
      totalIdeas: ideas.count,
      totalAssets: assets.count
    };
  } finally {
    db.close();
  }
}
export function saveLibraryIdeaBox(root: string, input: unknown): void {
  const db = openLibrary(root);
  try {
    transact(db, () => boxes.saveIdeaBox(db, input));
  } finally {
    db.close();
  }
}
export function listAssetSelects(root:string,assetId:string,includeHidden=false):AssetSelect[]{
  uuid.parse(assetId);const db=openLibrary(root,false);try{const lib=(db.prepare('SELECT id FROM library_meta').get() as Row).id;return db.prepare(`SELECT id,asset_id AS assetId,name,in_ms AS inMs,out_ms AS outMs,note,version,hidden,? AS libraryId FROM selects WHERE asset_id=? ${includeHidden?'':'AND hidden=0'} ORDER BY in_ms,id`).all(lib,assetId).map(r=>selectUsage(db,{...r,hidden:!!r.hidden} as AssetSelect));}finally{db.close();}
}
function selectUsage(db:DatabaseSync,select:AssetSelect):AssetSelect{
  const rows=db.prepare("SELECT p.name,u.shot_number FROM usage_index u JOIN project_catalog p ON p.project_id=u.project_id WHERE u.global_id=? AND u.role='main' AND coalesce(u.out_ms,9223372036854775807)>? AND u.in_ms<? ORDER BY p.last_seen DESC,u.shot_number").all(select.assetId,select.inMs,select.outMs) as Row[];
  return{...select,usageCount:rows.length,usageHint:rows.slice(0,12).map(r=>`${r.name} · 镜头 ${r.shot_number??'待核对'}`).join('\n')};
}
export function getAssetSelect(root:string,id:string):AssetSelect{uuid.parse(id);const db=openLibrary(root,false);try{const lib=(db.prepare('SELECT id FROM library_meta').get() as Row).id,row=db.prepare('SELECT id,asset_id AS assetId,name,in_ms AS inMs,out_ms AS outMs,note,version,hidden,? AS libraryId FROM selects WHERE id=?').get(lib,id) as any;if(!row)throw new Error('精华片段不存在');return{...row,hidden:!!row.hidden};}finally{db.close();}}
export function saveAssetSelect(root:string,input:unknown):AssetSelect[]{
  const v=selectInputSchema.parse(input),asset=getLibraryAsset(root,v.assetId);validateMediaRange(asset,v.inMs,v.outMs,'video');if(asset.hidden||asset.missing)throw new Error('原片已隐藏或离线，请恢复后再创建精华片段');
  const db=openLibrary(root,false);try{transact(db,()=>{if(v.id){const old=db.prepare('SELECT asset_id,version FROM selects WHERE id=? AND hidden=0').get(v.id) as any;if(!old||old.asset_id!==v.assetId)throw new Error('精华片段来源不一致');if(v.expectedVersion!==old.version)throw new Error('精华片段已更新，请刷新后重试');db.prepare('UPDATE selects SET name=?,in_ms=?,out_ms=?,note=?,version=version+1 WHERE id=?').run(v.name,v.inMs,v.outMs,v.note,v.id);}else{if((db.prepare('SELECT count(*) AS n FROM selects WHERE asset_id=? AND hidden=0').get(v.assetId) as any).n>=1000)throw new Error('单个原片最多 1000 条精华片段');db.prepare('INSERT INTO selects(id,asset_id,name,in_ms,out_ms,note) VALUES (?,?,?,?,?,?)').run(randomUUID(),v.assetId,v.name,v.inMs,v.outMs,v.note);}});}finally{db.close();}return listAssetSelects(root,v.assetId);
}
export function hideAssetSelect(root:string,id:string):void{uuid.parse(id);const db=openLibrary(root,false);try{if(!db.prepare('UPDATE selects SET hidden=1,version=version+1 WHERE id=? AND hidden=0').run(id).changes)throw new Error('精华片段已隐藏或不存在');}finally{db.close();}}
export function deleteLibraryIdeaBox(root: string, id: unknown): void {
  const db = openLibrary(root);
  try {
    transact(db, () => boxes.deleteIdeaBox(db, id));
  } finally {
    db.close();
  }
}
export function moveLibraryIdeasToBox(root: string, ids: unknown, boxId: unknown): void {
  const db = openLibrary(root);
  try {
    transact(db, () => boxes.moveIdeasToBox(db, ids, boxId));
  } finally {
    db.close();
  }
}
export async function importLibraryAsset(root: string, source: string, options: {
  signal?: AbortSignal;
  onProgress?: (copied: number, total: number) => void;
} = {}): Promise<LibraryAsset> {
  const kind = kinds[path.extname(source).toLowerCase()];
  if (!kind) throw new Error('暂不支持此素材格式');
  const size = statSync(source).size;
  if (!size || size > 10 * 1024 ** 3) throw new Error('文件为空或超过 10 GB');
  const id = libraryId(root),
    job = randomUUID(),
    folder = path.join(root, 'jobs');
  mkdirSync(folder, {
    recursive: true
  });
  const space = statfsSync(root);
  if (space.bavail * space.bsize < size + 64 * 1024 ** 2) throw new Error('全局库磁盘空间不足');
  const temporary = path.join(folder, `${job}.partial`),
    db = openLibrary(root);
  db.prepare('INSERT INTO operations(operation_id,kind,stage) VALUES (?,?,?)').run(job, 'import', 'copying');
  db.close();
  try {
    const digest = createHash('sha256');
    let copied = 0,
      last = 0;
    await pipeline(createReadStream(source), new Transform({
      transform(chunk: Buffer, _enc, callback) {
        copied += chunk.length;
        digest.update(chunk);
        if (Date.now() - last >= 100 || copied === size) {
          options.onProgress?.(copied, size);
          last = Date.now();
        }
        callback(null, chunk);
      }
    }), createWriteStream(temporary, {
      flags: 'wx'
    }), {
      signal: options.signal
    });
    if (options.signal?.aborted) throw new Error('导入已取消');
    if (statSync(temporary).size !== size) throw new Error('复制不完整');
    const hash = digest.digest('hex'),
      connection = openLibrary(root);
    let assetId: string;
    try {
      assetId = transact(connection, () => {
        const existing = connection.prepare('SELECT id FROM assets WHERE blob_sha256=? ORDER BY imported_at LIMIT 1').get(hash) as Row | undefined;
        const blob = connection.prepare('SELECT relative_path FROM blobs WHERE sha256=?').get(hash) as Row | undefined;
        const relative = blob?.relative_path ?? path.join('objects', hash.slice(0, 2), `${hash}${path.extname(source).toLowerCase()}`),
          destination = safeLibraryPath(root, relative);
        mkdirSync(path.dirname(destination), {
          recursive: true
        });
        if (!existsSync(destination)) renameSync(temporary, destination);else rmSync(temporary, {
          force: true
        });
        connection.prepare('INSERT OR IGNORE INTO blobs VALUES (?,?,?)').run(hash, relative, size);
        const newId = existing?.id ?? randomUUID();
        if (!existing) connection.prepare('INSERT INTO assets(id,blob_sha256,name,kind,imported_at) VALUES (?,?,?,?,?)').run(newId, hash, path.basename(source), kind, new Date().toISOString());else connection.prepare('UPDATE assets SET hidden=0 WHERE id=?').run(newId);
        connection.prepare("UPDATE operations SET stage='done',mapping_json=? WHERE operation_id=?").run(JSON.stringify({
          assetId: newId,
          libraryId: id
        }), job);
        return newId;
      });
    } finally {
      connection.close();
    }
    return getLibraryAsset(root, assetId);
  } catch (error) {
    const connection = openLibrary(root);
    try {
      connection.prepare('UPDATE operations SET stage=?,error=? WHERE operation_id=?').run(options.signal?.aborted ? 'cancelled' : 'failed', error instanceof Error ? error.message : String(error), job);
    } finally {
      connection.close();
    }
    throw error;
  } finally {
    rmSync(temporary, {
      force: true
    });
  }
}
export function recoverLibraryJobs(root: string): void {
  const db = openLibrary(root);
  try {
    const jobs = db.prepare("SELECT operation_id FROM operations WHERE kind='import' AND stage='copying'").all() as Row[];
    for (const job of jobs) {
      if (/^[0-9a-f-]{36}$/i.test(job.operation_id)) rmSync(path.join(root, 'jobs', `${job.operation_id}.partial`), {
        force: true
      });
      db.prepare("UPDATE operations SET stage='interrupted',error='上次导入中断，请重新选择源文件' WHERE operation_id=?").run(job.operation_id);
    }
  } finally {
    db.close();
  }
}
export async function relinkLibraryAsset(root: string, id: string, source: string, options: {
  signal?: AbortSignal;
  onProgress?: (copied: number, total: number) => void;
} = {}): Promise<LibraryAsset> {
  const asset = getLibraryAsset(root, id);
  if (!asset.missing) throw new Error('此素材原件并未缺失');
  const digest = createHash('sha256');
  let copied = 0;
  const total = statSync(source).size;
  for await (const chunk of createReadStream(source)) {
    if (options.signal?.aborted) throw new Error('重新定位已取消');
    digest.update(chunk);
    copied += chunk.length;
    options.onProgress?.(copied, total);
  }
  if (digest.digest('hex') !== asset.sha256) throw new Error('所选文件内容与原件不同，请作为新素材导入；其他项目的引用未修改');
  const restored = await importLibraryAsset(root, source, options);
  if (restored.sha256 !== asset.sha256) throw new Error('源文件在复制期间发生变化，请重试');
  return getLibraryAsset(root, id);
}
export function syncProjectCatalog(root: string, project: Project): void {
  const db = openLibrary(root),
    lib = (db.prepare('SELECT id FROM library_meta').get() as Row).id;
  try {
    transact(db, () => {
      const old = db.prepare('SELECT path FROM project_catalog WHERE project_id=?').get(project.id) as Row | undefined;
      if (old && path.resolve(old.path).toLowerCase() !== path.resolve(project.directory).toLowerCase() && existsSync(path.join(old.path, 'project.sqlite'))) throw new Error('相同项目 ID 已在另一位置登记，请使用“作为副本打开”');
      db.prepare('INSERT INTO project_catalog VALUES (?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET path=excluded.path,name=excluded.name,archived=excluded.archived,last_seen=excluded.last_seen,indexed_revision=excluded.indexed_revision').run(project.id, project.directory, project.name, project.archived ? 1 : 0, new Date().toISOString(), project.revision);
      db.prepare('DELETE FROM usage_index WHERE project_id=?').run(project.id);
      const put = db.prepare('INSERT OR IGNORE INTO usage_index(project_id,entity_kind,global_id,shot_id,role,shot_number,in_ms,out_ms,source_select_id,indexed_version) VALUES (?,?,?,?,?,?,?,?,?,1)');
      for (const a of project.assets.filter(a => a.sourceLibraryId === lib && a.sourceAssetId)) {
        const number=(id:string)=>{const s=project.shots.find(s=>s.id===id);return s?s.position+1:null;};
        put.run(project.id, 'asset', a.sourceAssetId!, '', 'project',null,0,a.durationMs,null);
        for (const b of project.shotAssets.filter(b => b.assetId === a.id)) put.run(project.id, 'asset', a.sourceAssetId!, b.shotId, 'main',number(b.shotId),b.inMs,b.outMs??a.durationMs,b.sourceSelectId??null);
        for (const b of project.shotCandidates.filter(b => b.assetId === a.id&&!project.shotAssets.some(m=>m.shotId===b.shotId&&m.assetId===a.id))) put.run(project.id, 'asset', a.sourceAssetId!, b.shotId, 'candidate',number(b.shotId),0,a.durationMs,null);
        for (const b of project.shotAudio.filter(b => b.assetId === a.id)) put.run(project.id, 'asset', a.sourceAssetId!, b.shotId, 'audio',number(b.shotId),0,a.durationMs,null);
        for(const b of project.audioClips.filter(b=>b.assetId===a.id))put.run(project.id,'asset',a.sourceAssetId!,b.id,'bgm',null,b.inMs,b.outMs,null);
      }
      for (const i of project.ideas.filter(i => i.sourceLibraryId === lib && i.sourceIdeaId)) put.run(project.id, 'idea', i.sourceIdeaId!, '', 'project',null,0,null,null);
    });
  } finally {
    db.close();
  }
}
export function listUsage(root: string, id: string,range?:{inMs:number;outMs:number}): Usage[] {
  uuid.parse(id);const q=range?z.object({inMs:z.number().int().nonnegative(),outMs:z.number().int().positive()}).refine(v=>v.outMs>v.inMs).parse(range):undefined;
  const db = openLibrary(root, false);
  try {
    return (db.prepare("SELECT u.*,p.name,p.path,p.last_seen,p.indexed_revision FROM usage_index u JOIN project_catalog p ON p.project_id=u.project_id WHERE u.global_id=? ORDER BY p.last_seen DESC,u.shot_number").all(id) as Row[]).filter(r=>!q||r.role!=='project'&&rangesOverlap({inMs:r.in_ms,outMs:r.out_ms},q)).map(r => ({
      projectId: r.project_id,
      projectName: r.name,
      directory: r.path,
      shotId: r.role==='bgm'?'':r.shot_id,
      clipId:r.role==='bgm'?r.shot_id:null,shotNumber:r.shot_number,inMs:r.in_ms,outMs:r.out_ms,sourceSelectId:r.source_select_id,indexedRevision:r.indexed_revision,
      stale:(()=>{if(r.indexed_version!==1)return true;let other:DatabaseSync|undefined;try{other=new DatabaseSync(path.join(r.path,'project.sqlite'),{readOnly:true,allowExtension:false});other.exec('PRAGMA query_only=ON;PRAGMA trusted_schema=OFF;');return (other.prepare('SELECT revision FROM project').get() as any)?.revision!==r.indexed_revision;}catch{return true;}finally{other?.close();}})(),
      role: r.role,
      lastSeen: r.last_seen,
      available: existsSync(path.join(r.path, 'project.sqlite'))
    }));
  } finally {
    db.close();
  }
}
export function operationMapping(root: string, key: string): Record<string, string> {
  const db = openLibrary(root);
  try {
    const row = db.prepare('SELECT mapping_json FROM operations WHERE operation_id=?').get(key) as Row | undefined;
    return row ? JSON.parse(row.mapping_json) : {};
  } finally {
    db.close();
  }
}
export function saveOperation(root: string, key: string, mapping: Record<string, string>, stage: string) {
  const db = openLibrary(root);
  try {
    db.prepare("INSERT INTO operations(operation_id,kind,stage,mapping_json) VALUES (?,'promote',?,?) ON CONFLICT(operation_id) DO UPDATE SET stage=excluded.stage,mapping_json=excluded.mapping_json").run(key, stage, JSON.stringify(mapping));
  } finally {
    db.close();
  }
}
