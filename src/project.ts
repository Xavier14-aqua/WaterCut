import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statfsSync, statSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';

export type Shot = { id: string; position: number; description: string; actionDialogue: string; durationMs: number };
export type Asset = { id: string; name: string; kind: 'image' | 'video' | 'audio'; relativePath: string; size: number; tags: string; missing: boolean; thumbnail: boolean };
export type ShotAsset = { shotId: string; assetId: string; inMs: number; outMs: number | null };
export type Idea = { id: string; text: string; tags: string; notes: string; sourceAssetId: string | null; x: number; y: number };
export type BoardHandle = 'top' | 'right' | 'bottom' | 'left';
export type BoardEdge = { id: string; source: string; target: string; sourceHandle: BoardHandle; targetHandle: BoardHandle };
export type DraftShot = { description: string; actionDialogue: string; durationMs: number };
export type Project = { directory: string; name: string; shots: Shot[]; ideas: Idea[]; boardEdges: BoardEdge[]; assets: Asset[]; shotAssets: ShotAsset[]; shotAudio: Array<{ shotId: string; assetId: string }>; shotCandidates: Array<{ shotId: string; assetId: string }> };
const nameSchema = z.string().trim().min(1).max(100);
const shotSchema = z.object({ description: z.string().trim().min(1).max(4000), actionDialogue: z.string().max(4000).default(''), durationMs: z.number().int().min(100).max(600000) });
const CURRENT_VERSION = 7;
const mediaTypes: Record<string, Asset['kind']> = { '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.mp4': 'video', '.mov': 'video', '.webm': 'video', '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio' };
const additions = `CREATE TABLE ideas (id TEXT PRIMARY KEY, text TEXT NOT NULL);
  CREATE TABLE assets (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, relative_path TEXT NOT NULL, size INTEGER NOT NULL);
  CREATE TABLE shot_assets (shot_id TEXT PRIMARY KEY REFERENCES shots(id), asset_id TEXT NOT NULL REFERENCES assets(id));`;
const additionsV4 = `ALTER TABLE shots ADD COLUMN action_dialogue TEXT NOT NULL DEFAULT '';
  ALTER TABLE ideas ADD COLUMN tags TEXT NOT NULL DEFAULT '';
  ALTER TABLE ideas ADD COLUMN notes TEXT NOT NULL DEFAULT '';
  ALTER TABLE ideas ADD COLUMN source_asset_id TEXT;
  ALTER TABLE assets ADD COLUMN tags TEXT NOT NULL DEFAULT '';
  CREATE TABLE shot_audio (shot_id TEXT PRIMARY KEY REFERENCES shots(id), asset_id TEXT NOT NULL REFERENCES assets(id));`;
const additionsV5 = `CREATE TABLE shot_candidates (shot_id TEXT NOT NULL, asset_id TEXT NOT NULL, PRIMARY KEY (shot_id, asset_id));
  INSERT INTO shot_candidates (shot_id, asset_id) SELECT shot_id, asset_id FROM shot_assets;`;
const additionsV6 = `ALTER TABLE ideas ADD COLUMN x REAL NOT NULL DEFAULT 0;
  ALTER TABLE ideas ADD COLUMN y REAL NOT NULL DEFAULT 0;
  UPDATE ideas SET x = ((rowid - 1) % 4) * 230, y = CAST((rowid - 1) / 4 AS INTEGER) * 150;
  CREATE TABLE board_edges (id TEXT PRIMARY KEY, source TEXT NOT NULL REFERENCES ideas(id), target TEXT NOT NULL REFERENCES ideas(id), UNIQUE(source, target));`;
const additionsV7 = `ALTER TABLE board_edges ADD COLUMN source_handle TEXT NOT NULL DEFAULT 'bottom';
  ALTER TABLE board_edges ADD COLUMN target_handle TEXT NOT NULL DEFAULT 'top';`;

function databaseFile(directory: string) { return path.join(directory, 'project.sqlite'); }

function openDatabase(directory: string): DatabaseSync {
  if (typeof directory !== 'string' || !directory.endsWith('.watercut')) throw new Error('请选择 .watercut 项目文件夹');
  const file = databaseFile(directory);
  if (!existsSync(file)) throw new Error('项目数据库不存在');
  const db = new DatabaseSync(file);
  try {
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version.user_version > CURRENT_VERSION) throw new Error('项目由更新版本的 WaterCut 创建，请升级应用');
    if (version.user_version < CURRENT_VERSION) {
      db.close();
      copyFileSync(file, `${file}.before-v${CURRENT_VERSION}.bak`);
      const migration = new DatabaseSync(file);
      try {
        migration.exec('BEGIN IMMEDIATE');
        if (version.user_version === 0) {
          migration.exec(`CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT NOT NULL);
            CREATE TABLE shots (id TEXT PRIMARY KEY, position INTEGER NOT NULL, description TEXT NOT NULL, duration_ms INTEGER NOT NULL);
            PRAGMA user_version = 1;`);
        }
        if (version.user_version < 2) migration.exec(`${additions} PRAGMA user_version = 2;`);
        if (version.user_version < 3) migration.exec(`ALTER TABLE shot_assets ADD COLUMN in_ms INTEGER NOT NULL DEFAULT 0;
          ALTER TABLE shot_assets ADD COLUMN out_ms INTEGER; PRAGMA user_version = 3;`);
        if (version.user_version < 4) migration.exec(`${additionsV4} PRAGMA user_version = 4;`);
        if (version.user_version < 5) migration.exec(`${additionsV5} PRAGMA user_version = 5;`);
        if (version.user_version < 6) migration.exec(`${additionsV6} PRAGMA user_version = 6;`);
        if (version.user_version < 7) migration.exec(`${additionsV7} PRAGMA user_version = 7;`);
        migration.exec('COMMIT');
        return migration;
      } catch (error) { migration.exec('ROLLBACK'); migration.close(); throw error; }
    }
    return db;
  } catch (error) { try { db.close(); } catch {} throw error; }
}

export function createProject(root: string, nameInput: unknown): Project {
  const name = nameSchema.parse(nameInput);
  mkdirSync(root, { recursive: true });
  const directory = path.join(root, `${randomUUID()}.watercut`);
  mkdirSync(directory);
  const db = new DatabaseSync(databaseFile(directory));
  try {
    db.exec(`CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE shots (id TEXT PRIMARY KEY, position INTEGER NOT NULL, description TEXT NOT NULL, duration_ms INTEGER NOT NULL);
      ${additions} ALTER TABLE shot_assets ADD COLUMN in_ms INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE shot_assets ADD COLUMN out_ms INTEGER; ${additionsV4} ${additionsV5} ${additionsV6} ${additionsV7} PRAGMA user_version = 7;`);
    db.prepare('INSERT INTO project (id, name) VALUES (?, ?)').run(randomUUID(), name);
  } finally { db.close(); }
  return { directory, name, shots: [], ideas: [], boardEdges: [], assets: [], shotAssets: [], shotAudio: [], shotCandidates: [] };
}

export function readProject(directory: string): Project {
  const db = openDatabase(directory);
  try {
    const row = db.prepare('SELECT name FROM project LIMIT 1').get() as { name: string } | undefined;
    if (!row) throw new Error('项目数据不完整');
    const shots = (db.prepare('SELECT id, position, description, action_dialogue, duration_ms FROM shots ORDER BY position, id').all() as Array<{ id: string; position: number; description: string; action_dialogue: string; duration_ms: number }>).map(({ duration_ms, action_dialogue, ...shot }) => ({ ...shot, actionDialogue: action_dialogue, durationMs: duration_ms }));
    const ideas = (db.prepare('SELECT id, text, tags, notes, source_asset_id, x, y FROM ideas ORDER BY rowid').all() as Array<{ id: string; text: string; tags: string; notes: string; source_asset_id: string | null; x: number; y: number }>).map(({ source_asset_id, ...idea }) => ({ ...idea, sourceAssetId: source_asset_id }));
    const boardEdges = (db.prepare('SELECT id, source, target, source_handle, target_handle FROM board_edges ORDER BY rowid').all() as Array<{ id: string; source: string; target: string; source_handle: BoardHandle; target_handle: BoardHandle }>).map(({ source_handle, target_handle, ...edge }) => ({ ...edge, sourceHandle: source_handle, targetHandle: target_handle }));
    const assets = (db.prepare('SELECT id, name, kind, relative_path, size, tags FROM assets ORDER BY rowid').all() as Array<{ id: string; name: string; kind: Asset['kind']; relative_path: string; size: number; tags: string }>).map(({ relative_path, ...asset }) => ({ ...asset, relativePath: relative_path, missing: !existsSync(path.join(directory, relative_path)), thumbnail: existsSync(path.join(directory, 'thumbnails', `${asset.id}.png`)) }));
    const shotAssets = (db.prepare('SELECT shot_id, asset_id, in_ms, out_ms FROM shot_assets').all() as Array<{ shot_id: string; asset_id: string; in_ms: number; out_ms: number | null }>).map(row => ({ shotId: row.shot_id, assetId: row.asset_id, inMs: row.in_ms, outMs: row.out_ms }));
    const shotAudio = (db.prepare('SELECT shot_id, asset_id FROM shot_audio').all() as Array<{ shot_id: string; asset_id: string }>).map(row => ({ shotId: row.shot_id, assetId: row.asset_id }));
    const shotCandidates = (db.prepare('SELECT shot_id, asset_id FROM shot_candidates').all() as Array<{ shot_id: string; asset_id: string }>).map(row => ({ shotId: row.shot_id, assetId: row.asset_id }));
    return { directory, name: row.name, shots, ideas, boardEdges, assets, shotAssets, shotAudio, shotCandidates };
  } finally { db.close(); }
}

export function cleanupPartialAssets(directory: string): number {
  const db = openDatabase(directory);
  const folder = path.join(directory, 'assets');
  if (!existsSync(folder)) { db.close(); return 0; }
  let removed = 0;
  try {
    for (const name of readdirSync(folder)) {
      if (/^[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|m4a)\.partial$/i.test(name)) {
        rmSync(path.join(folder, name), { force: true });
        removed++;
      } else if (/^[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif|mp4|mov|webm|mp3|wav|m4a)\.delete-pending$/i.test(name)) {
        const original = name.slice(0, -'.delete-pending'.length);
        const record = db.prepare('SELECT 1 FROM assets WHERE relative_path = ?').get(path.join('assets', original));
        if (record && !existsSync(path.join(folder, original))) renameSync(path.join(folder, name), path.join(folder, original));
        else { rmSync(path.join(folder, name), { force: true }); removed++; }
      }
    }
  } finally { db.close(); }
  return removed;
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function addIdea(directory: string, textInput: unknown): Project {
  const text = z.string().trim().min(1).max(4000).parse(textInput);
  const db = openDatabase(directory);
  try {
    const count = (db.prepare('SELECT COUNT(*) AS count FROM ideas').get() as { count: number }).count;
    db.prepare('INSERT INTO ideas (id, text, x, y) VALUES (?, ?, ?, ?)').run(randomUUID(), text, (count % 4) * 230, Math.floor(count / 4) * 150);
  }
  finally { db.close(); }
  return readProject(directory);
}

export function renameProject(directory: string, nameInput: unknown): Project {
  const name = nameSchema.parse(nameInput);
  const db = openDatabase(directory);
  try { db.prepare('UPDATE project SET name = ?').run(name); } finally { db.close(); }
  return readProject(directory);
}

export function updateIdea(directory: string, id: string, input: unknown): Project {
  const idea = z.object({ text: z.string().trim().min(1).max(4000), tags: z.string().max(500), notes: z.string().max(4000) }).parse(input);
  const db = openDatabase(directory);
  try {
    const result = db.prepare('UPDATE ideas SET text = ?, tags = ?, notes = ? WHERE id = ?').run(idea.text, idea.tags, idea.notes, id);
    if (result.changes !== 1) throw new Error('灵感不存在');
  } finally { db.close(); }
  return readProject(directory);
}

export function deleteIdea(directory: string, id: string): Project {
  const db = openDatabase(directory);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM board_edges WHERE source = ? OR target = ?').run(id, id);
      const result = db.prepare('DELETE FROM ideas WHERE id = ?').run(id);
      if (result.changes !== 1) throw new Error('灵感不存在');
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
  return readProject(directory);
}

export function moveIdea(directory: string, id: string, xInput: unknown, yInput: unknown): Project {
  const coordinate = z.number().finite().min(-100000).max(100000);
  const x = coordinate.parse(xInput), y = coordinate.parse(yInput);
  const db = openDatabase(directory);
  try { if (db.prepare('UPDATE ideas SET x = ?, y = ? WHERE id = ?').run(x, y, id).changes !== 1) throw new Error('灵感不存在'); }
  finally { db.close(); }
  return readProject(directory);
}

export function connectIdeas(directory: string, sourceInput: unknown, targetInput: unknown, sourceHandleInput: unknown = 'bottom', targetHandleInput: unknown = 'top'): Project {
  const source = z.string().uuid().parse(sourceInput), target = z.string().uuid().parse(targetInput);
  const handle = z.enum(['top', 'right', 'bottom', 'left']);
  const sourceHandle = handle.parse(sourceHandleInput), targetHandle = handle.parse(targetHandleInput);
  if (source === target) throw new Error('不能将卡片连接到自身');
  const db = openDatabase(directory);
  try {
    for (const id of [source, target]) if (!db.prepare('SELECT 1 FROM ideas WHERE id = ?').get(id)) throw new Error('灵感不存在');
    db.prepare('INSERT OR IGNORE INTO board_edges (id, source, target, source_handle, target_handle) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), source, target, sourceHandle, targetHandle);
  } finally { db.close(); }
  return readProject(directory);
}

export function disconnectIdeas(directory: string, idInput: unknown): Project {
  const id = z.string().uuid().parse(idInput);
  const db = openDatabase(directory);
  try { if (db.prepare('DELETE FROM board_edges WHERE id = ?').run(id).changes !== 1) throw new Error('连线不存在'); }
  finally { db.close(); }
  return readProject(directory);
}

export function appendDraftShots(directory: string, input: unknown): Project {
  const shots = z.array(shotSchema).min(1).max(10).parse(input);
  const db = openDatabase(directory);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const next = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM shots').get() as { position: number };
      shots.forEach((shot, index) => db.prepare('INSERT INTO shots (id, position, description, action_dialogue, duration_ms) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), next.position + index, shot.description, shot.actionDialogue, shot.durationMs));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
  return readProject(directory);
}

export function attachIdeaAsset(directory: string, assetId: string): Project {
  const db = openDatabase(directory);
  try {
    const row = db.prepare('SELECT name FROM assets WHERE id = ?').get(assetId) as { name: string } | undefined;
    if (!row) throw new Error('素材不存在');
    const count = (db.prepare('SELECT COUNT(*) AS count FROM ideas').get() as { count: number }).count;
    db.prepare('INSERT INTO ideas (id, text, source_asset_id, x, y) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), row.name, assetId, (count % 4) * 230, Math.floor(count / 4) * 150);
  } finally { db.close(); }
  return readProject(directory);
}

export async function importAsset(directory: string, source: string, options: { signal?: AbortSignal; onProgress?: (copied: number, total: number) => void } = {}): Promise<Project> {
  const kind = mediaTypes[path.extname(source).toLowerCase()];
  if (!kind) throw new Error('暂不支持此文件格式');
  const size = statSync(source).size;
  if (!size || size > 10 * 1024 ** 3) throw new Error('文件为空或超过 10 GB');
  openDatabase(directory).close();
  const free = statfsSync(directory);
  if (free.bavail * free.bsize < size + 64 * 1024 * 1024) throw new Error('项目所在磁盘剩余空间不足');
  const id = randomUUID();
  const assetsDir = path.join(directory, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const relativePath = path.join('assets', `${id}${path.extname(source).toLowerCase()}`);
  const destination = path.join(directory, relativePath);
  const temporary = `${destination}.partial`;
  try {
    let copied = 0;
    let lastReport = 0;
    const digest = createHash('sha256');
    await pipeline(
      createReadStream(source),
      new Transform({ transform(chunk: Buffer, _encoding, callback) {
        copied += chunk.length;
        digest.update(chunk);
        const now = Date.now();
        if (!lastReport || now - lastReport >= 100 || copied === size) {
          options.onProgress?.(copied, size);
          lastReport = now;
        }
        callback(null, chunk);
      } }),
      createWriteStream(temporary, { flags: 'wx' }),
      { signal: options.signal },
    );
    if (options.signal?.aborted) throw new Error('导入已取消');
    if (statSync(temporary).size !== size) throw new Error('素材复制不完整');
    const checksum = digest.digest('hex');
    for (const existing of readProject(directory).assets) {
      if (options.signal?.aborted) throw new Error('导入已取消');
      if (existing.size === size && !existing.missing && await hashFile(path.join(directory, existing.relativePath)) === checksum)
        throw new Error(`素材已在项目中：${existing.name}`);
    }
    if (options.signal?.aborted) throw new Error('导入已取消');
    renameSync(temporary, destination);
    const db = openDatabase(directory);
    try { db.prepare('INSERT INTO assets (id, name, kind, relative_path, size) VALUES (?, ?, ?, ?, ?)').run(id, path.basename(source), kind, relativePath, size); }
    finally { db.close(); }
  } catch (error) { rmSync(temporary, { force: true }); rmSync(destination, { force: true }); throw error; }
  return readProject(directory);
}

export async function relinkAsset(directory: string, assetId: string, source: string, options: { signal?: AbortSignal; onProgress?: (copied: number, total: number) => void } = {}): Promise<Project> {
  const project = readProject(directory);
  const asset = project.assets.find(item => item.id === assetId);
  if (!asset || !asset.missing) throw new Error('只能重新定位缺失素材');
  if (path.extname(source).toLowerCase() !== path.extname(asset.relativePath).toLowerCase()) throw new Error('请选择相同扩展名的素材');
  const size = statSync(source).size;
  if (!size || size > 10 * 1024 ** 3) throw new Error('文件为空或超过 10 GB');
  const destination = path.join(directory, asset.relativePath);
  const temporary = `${destination}.partial`;
  let renamed = false;
  try {
    let copied = 0;
    let lastReport = 0;
    await pipeline(createReadStream(source), new Transform({ transform(chunk: Buffer, _encoding, callback) {
      copied += chunk.length;
      const now = Date.now();
      if (!lastReport || now - lastReport >= 100 || copied === size) { options.onProgress?.(copied, size); lastReport = now; }
      callback(null, chunk);
    } }), createWriteStream(temporary, { flags: 'wx' }), { signal: options.signal });
    if (options.signal?.aborted) throw new Error('重新定位已取消');
    if (statSync(temporary).size !== size) throw new Error('素材复制不完整');
    if (existsSync(destination)) throw new Error('素材文件已重新出现，请重新打开项目');
    renameSync(temporary, destination);
    renamed = true;
    const db = openDatabase(directory);
    try { db.prepare('UPDATE assets SET name = ?, size = ? WHERE id = ?').run(path.basename(source), size, assetId); }
    finally { db.close(); }
    rmSync(path.join(directory, 'thumbnails', `${assetId}.png`), { force: true });
  } catch (error) { rmSync(temporary, { force: true }); if (renamed) rmSync(destination, { force: true }); throw error; }
  return readProject(directory);
}

export function linkAsset(directory: string, shotId: string, assetId: string): Project {
  const db = openDatabase(directory);
  try {
    if (!db.prepare('SELECT 1 FROM shots WHERE id = ?').get(shotId) || !db.prepare("SELECT 1 FROM assets WHERE id = ? AND kind != 'audio'").get(assetId)) throw new Error('镜头或画面素材不存在');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT OR IGNORE INTO shot_candidates (shot_id, asset_id) VALUES (?, ?)').run(shotId, assetId);
      db.prepare('INSERT INTO shot_assets (shot_id, asset_id) VALUES (?, ?) ON CONFLICT(shot_id) DO UPDATE SET asset_id = excluded.asset_id, in_ms = 0, out_ms = NULL').run(shotId, assetId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
  return readProject(directory);
}

export function addCandidate(directory: string, shotId: string, assetId: string): Project {
  const db = openDatabase(directory);
  try {
    if (!db.prepare('SELECT 1 FROM shots WHERE id = ?').get(shotId) || !db.prepare("SELECT 1 FROM assets WHERE id = ? AND kind != 'audio'").get(assetId)) throw new Error('镜头或画面素材不存在');
    db.prepare('INSERT OR IGNORE INTO shot_candidates (shot_id, asset_id) VALUES (?, ?)').run(shotId, assetId);
  } finally { db.close(); }
  return readProject(directory);
}

export function removeCandidate(directory: string, shotId: string, assetId: string): Project {
  const db = openDatabase(directory);
  try {
    if (db.prepare('SELECT 1 FROM shot_assets WHERE shot_id = ? AND asset_id = ?').get(shotId, assetId)) throw new Error('请先选择其他主画面');
    db.prepare('DELETE FROM shot_candidates WHERE shot_id = ? AND asset_id = ?').run(shotId, assetId);
  } finally { db.close(); }
  return readProject(directory);
}

export function linkAudio(directory: string, shotId: string, assetId: string): Project {
  const db = openDatabase(directory);
  try {
    const row = db.prepare('SELECT kind FROM assets WHERE id = ?').get(assetId) as { kind: string } | undefined;
    if (!db.prepare('SELECT 1 FROM shots WHERE id = ?').get(shotId) || row?.kind !== 'audio') throw new Error('镜头或音频素材不存在');
    db.prepare('INSERT INTO shot_audio (shot_id, asset_id) VALUES (?, ?) ON CONFLICT(shot_id) DO UPDATE SET asset_id = excluded.asset_id').run(shotId, assetId);
  } finally { db.close(); }
  return readProject(directory);
}

export function updateAssetTags(directory: string, assetId: string, tagsInput: unknown): Project {
  const tags = z.string().max(500).parse(tagsInput);
  const db = openDatabase(directory);
  try {
    const result = db.prepare('UPDATE assets SET tags = ? WHERE id = ?').run(tags, assetId);
    if (result.changes !== 1) throw new Error('素材不存在');
  } finally { db.close(); }
  return readProject(directory);
}

export function deleteAsset(directory: string, assetId: string): Project {
  const db = openDatabase(directory);
  const row = db.prepare('SELECT relative_path FROM assets WHERE id = ?').get(assetId) as { relative_path: string } | undefined;
  if (!row) { db.close(); throw new Error('素材不存在'); }
  const file = path.join(directory, row.relative_path);
  const parked = `${file}.delete-pending`;
  let moved = false;
  try {
    if (existsSync(file)) { renameSync(file, parked); moved = true; }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('UPDATE ideas SET source_asset_id = NULL WHERE source_asset_id = ?').run(assetId);
      db.prepare('DELETE FROM shot_assets WHERE asset_id = ?').run(assetId);
      db.prepare('DELETE FROM shot_audio WHERE asset_id = ?').run(assetId);
      db.prepare('DELETE FROM shot_candidates WHERE asset_id = ?').run(assetId);
      db.prepare('DELETE FROM assets WHERE id = ?').run(assetId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } catch (error) {
    if (moved) renameSync(parked, file);
    throw error;
  } finally { db.close(); }
  if (moved) { try { rmSync(parked, { force: true }); } catch { /* clean on next project open */ } }
  try { rmSync(path.join(directory, 'thumbnails', `${assetId}.png`), { force: true }); } catch { /* cache cleanup can be retried later */ }
  return readProject(directory);
}

export function deleteShot(directory: string, id: string): Project {
  const db = openDatabase(directory);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM shot_assets WHERE shot_id = ?').run(id);
      db.prepare('DELETE FROM shot_audio WHERE shot_id = ?').run(id);
      db.prepare('DELETE FROM shot_candidates WHERE shot_id = ?').run(id);
      const result = db.prepare('DELETE FROM shots WHERE id = ?').run(id);
      if (result.changes !== 1) throw new Error('镜头不存在');
      const rows = db.prepare('SELECT id FROM shots ORDER BY position, id').all() as Array<{ id: string }>;
      rows.forEach((row, index) => db.prepare('UPDATE shots SET position = ? WHERE id = ?').run(index, row.id));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
  return readProject(directory);
}

export function moveShot(directory: string, id: string, offset: -1 | 1): Project {
  const db = openDatabase(directory);
  try {
    const rows = db.prepare('SELECT id FROM shots ORDER BY position, id').all() as Array<{ id: string }>;
    const index = rows.findIndex(row => row.id === id);
    if (index < 0 || index + offset < 0 || index + offset >= rows.length) throw new Error('无法移动该镜头');
    [rows[index], rows[index + offset]] = [rows[index + offset], rows[index]];
    db.exec('BEGIN IMMEDIATE');
    try { rows.forEach((row, position) => db.prepare('UPDATE shots SET position = ? WHERE id = ?').run(position, row.id)); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
  return readProject(directory);
}

export function updateTrim(directory: string, shotId: string, inMsInput: unknown, outMsInput: unknown): Project {
  const inMs = z.number().int().min(0).max(24 * 60 * 60 * 1000).parse(inMsInput);
  const outMs = z.number().int().min(1).max(24 * 60 * 60 * 1000).nullable().parse(outMsInput);
  if (outMs !== null && outMs <= inMs) throw new Error('出点必须晚于入点');
  const db = openDatabase(directory);
  try {
    const link = db.prepare(`SELECT 1 FROM shot_assets sa JOIN assets a ON a.id = sa.asset_id
      WHERE sa.shot_id = ? AND a.kind = 'video'`).get(shotId);
    if (!link) throw new Error('镜头尚未关联视频素材');
    db.prepare('UPDATE shot_assets SET in_ms = ?, out_ms = ? WHERE shot_id = ?').run(inMs, outMs, shotId);
  } finally { db.close(); }
  return readProject(directory);
}

export function addShot(directory: string, input: unknown): Project {
  const shot = shotSchema.parse(input);
  const db = openDatabase(directory);
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const next = db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM shots').get() as { position: number };
      db.prepare('INSERT INTO shots (id, position, description, action_dialogue, duration_ms) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), next.position, shot.description, shot.actionDialogue, shot.durationMs);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
  return readProject(directory);
}

export function updateShot(directory: string, id: string, input: unknown): Project {
  const shot = shotSchema.parse(input);
  const db = openDatabase(directory);
  try {
    const result = db.prepare('UPDATE shots SET description = ?, action_dialogue = ?, duration_ms = ? WHERE id = ?').run(shot.description, shot.actionDialogue, shot.durationMs, id);
    if (result.changes !== 1) throw new Error('镜头不存在');
  } finally { db.close(); }
  return readProject(directory);
}
