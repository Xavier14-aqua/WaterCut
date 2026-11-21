import { afterEach, expect, test, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { addCandidate, addIdea, addShot, appendDraftShots, attachIdeaAsset, cleanupPartialAssets, connectIdeas, createProject, deleteAsset, deleteIdea, deleteShot, disconnectIdeas, importAsset, linkAsset, linkAudio, moveIdea, moveShot, readProject, relinkAsset, removeCandidate, renameProject, updateAssetTags, updateIdea, updateShot, updateTrim } from './project';

// Build genuine earlier schemas: remove the new tables/columns before applying
// each historical fixture's own downgrade. Only temporary test databases use this.
function stripV8(db: DatabaseSync) {
  for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as Array<{
    name: string;
  }>) db.exec(`DROP TRIGGER "${row.name}"`);
  db.exec('DROP TABLE revision_media_refs; DROP TABLE revisions; DROP TABLE asset_metadata; DROP TABLE project_origin; DROP TABLE shot_sources; DROP TABLE idea_media; DROP TABLE script_blocks; DROP TABLE outbox; DROP TABLE commands;');
  const columns: Record<string, string[]> = {
    project: ['revision', 'archived'],
    assets: ['storage_kind', 'source_library_id', 'source_asset_id', 'sha256', 'duration_ms', 'starred', 'imported_at'],
    ideas: ['kind', 'payload_json', 'recorded_at', 'occurred_at', 'source_library_id', 'source_idea_id', 'source_version'],
    board_edges: ['label', 'relation_kind'],
    shots: ['scene', 'time_of_day', 'shot_size', 'movement', 'status', 'needs_review', 'review_note']
  };
  for (const [table, names] of Object.entries(columns)) for (const name of names) db.exec(`ALTER TABLE ${table} DROP COLUMN ${name}`);
  db.exec('PRAGMA user_version=7');
}
function legacyProject(file: string, downgrade: string) {
  const db = new DatabaseSync(file);
  try {
    db.exec('BEGIN IMMEDIATE');
    stripV8(db);
    db.exec(downgrade);
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}
const folders: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const folder of folders.splice(0)) {
    if (path.dirname(folder) !== path.resolve(tmpdir()) || !path.basename(folder).startsWith('watercut-test-')) throw new Error('Unsafe fixture cleanup');
    rmSync(folder, { recursive: true, force: true });
  }
});

test('failed project initialization rolls back its schema and removes only its new directory', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const existing = createProject(root, '保留的项目');
  const exec = DatabaseSync.prototype.exec;
  let transactionAtFailure = false;
  let tablesAfterRollback = -1;
  const spy = vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(function (this: DatabaseSync, sql: string) {
    if (sql.includes('CREATE TRIGGER IF NOT EXISTS change_shots_UPDATE')) {
      transactionAtFailure = this.isTransaction;
      throw new Error('Synthetic initialization failure');
    }
    exec.call(this, sql);
    if (sql === 'ROLLBACK') tablesAfterRollback = Number(this.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()!.n);
  });
  expect(() => createProject(root, '应清理的项目')).toThrow('Synthetic initialization failure');
  spy.mockRestore();
  expect(transactionAtFailure).toBe(true);
  expect(tablesAfterRollback).toBe(0);
  expect(readdirSync(root)).toEqual([path.basename(existing.directory)]);
  expect(readProject(existing.directory).name).toBe('保留的项目');
});
test('board positions and connections persist; deleting a card removes its connections', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  let project = addIdea(createProject(root, '白板').directory, '雨夜');
  project = addIdea(project.directory, '归家');
  const [first, second] = project.ideas;
  project = moveIdea(project.directory, first.id, 412, -25);
  project = connectIdeas(project.directory, first.id, second.id);
  expect(readProject(project.directory).ideas[0]).toMatchObject({
    x: 412,
    y: -25
  });
  expect(readProject(project.directory).boardEdges).toHaveLength(1);
  expect(project.boardEdges[0]).toMatchObject({
    sourceHandle: 'bottom',
    targetHandle: 'top'
  });
  expect(connectIdeas(project.directory, first.id, second.id).boardEdges).toHaveLength(1);
  project = disconnectIdeas(project.directory, project.boardEdges[0].id);
  expect(project.boardEdges).toHaveLength(0);
  project = connectIdeas(project.directory, first.id, second.id, 'left', 'right');
  expect(readProject(project.directory).boardEdges[0]).toMatchObject({
    sourceHandle: 'left',
    targetHandle: 'right'
  });
  expect(deleteIdea(project.directory, first.id).boardEdges).toHaveLength(0);
});
test('v6 connections migrate with their original top and bottom anchors', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  let project = addIdea(createProject(root, '旧白板').directory, '甲');
  project = addIdea(project.directory, '乙');
  project = connectIdeas(project.directory, project.ideas[0].id, project.ideas[1].id);
  const file = path.join(project.directory, 'project.sqlite');
  legacyProject(file, 'ALTER TABLE board_edges DROP COLUMN source_handle; ALTER TABLE board_edges DROP COLUMN target_handle; PRAGMA user_version = 6;');
  const migrated = readProject(project.directory);
  expect(migrated.boardEdges[0]).toMatchObject({
    sourceHandle: 'bottom',
    targetHandle: 'top'
  });
  expect(existsSync(`${file}.before-v11.bak`)).toBe(true);
});
test('v5 ideas migrate to positioned board cards with a backup', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  let project = createProject(root, '迁移白板');
  project = addIdea(project.directory, '旧灵感一');
  project = addIdea(project.directory, '旧灵感二');
  const file = path.join(project.directory, 'project.sqlite');
  legacyProject(file, 'DROP TABLE board_edges; ALTER TABLE ideas DROP COLUMN x; ALTER TABLE ideas DROP COLUMN y; PRAGMA user_version = 5;');
  const migrated = readProject(project.directory);
  expect(migrated.ideas.map(idea => idea.x)).toEqual([0, 230]);
  expect(migrated.boardEdges).toEqual([]);
  expect(existsSync(`${file}.before-v11.bak`)).toBe(true);
});
test('draft is appended atomically and invalid input leaves existing shots untouched', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const project = addShot(createProject(root, '草案').directory, {
    description: '原镜头',
    durationMs: 1000
  });
  expect(() => appendDraftShots(project.directory, [{
    description: '有效',
    actionDialogue: '',
    durationMs: 2000
  }, {
    description: '',
    actionDialogue: '',
    durationMs: 1000
  }])).toThrow();
  expect(readProject(project.directory).shots).toHaveLength(1);
  const updated = appendDraftShots(project.directory, [{
    description: '新镜头',
    actionDialogue: '走进画面',
    durationMs: 3000
  }]);
  expect(updated.shots.map(shot => shot.description)).toEqual(['原镜头', '新镜头']);
});
test('three shots survive closing and reopening the database', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  let project = createProject(root, '雨夜');
  for (const description of ['街道远景', '主角入画', '抬头看灯']) project = addShot(project.directory, {
    description,
    durationMs: 3000
  });
  const reopened = readProject(project.directory);
  expect(reopened.shots.map(shot => shot.description)).toEqual(['街道远景', '主角入画', '抬头看灯']);
  expect(updateShot(project.directory, reopened.shots[1].id, {
    description: '主角跑入画面',
    durationMs: 2500
  }).shots[1].durationMs).toBe(2500);
});
test('a newer project format is refused without changing its data', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const project = createProject(root, '未来项目');
  const db = new DatabaseSync(path.join(project.directory, 'project.sqlite'));
  db.exec('PRAGMA user_version = 99');
  db.close();
  expect(() => readProject(project.directory)).toThrow('请升级应用');
  const check = new DatabaseSync(path.join(project.directory, 'project.sqlite'));
  expect((check.prepare('PRAGMA user_version').get() as {
    user_version: number;
  }).user_version).toBe(99);
  check.close();
});
test('v1 project migrates with a backup and keeps its shots', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const project = addShot(createProject(root, '旧项目').directory, {
    description: '原有镜头',
    durationMs: 2000
  });
  const file = path.join(project.directory, 'project.sqlite');
  legacyProject(file, `DROP TABLE board_edges; DROP TABLE shot_candidates; DROP TABLE shot_audio; DROP TABLE shot_assets; DROP TABLE assets; DROP TABLE ideas;
    ALTER TABLE shots DROP COLUMN action_dialogue; PRAGMA user_version = 1;`);
  const migrated = readProject(project.directory);
  expect(migrated.shots[0].description).toBe('原有镜头');
  expect(migrated.assets).toEqual([]);
  expect(existsSync(`${file}.before-v11.bak`)).toBe(true);
});
test('v2 links migrate to default full-video trim and preserve their asset', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const source = path.join(root, 'clip.mp4');
  writeFileSync(source, 'sample-video-bytes');
  let project = addShot(createProject(root, '旧素材项目').directory, {
    description: '开场',
    durationMs: 2000
  });
  project = await importAsset(project.directory, source);
  project = linkAsset(project.directory, project.shots[0].id, project.assets[0].id);
  const file = path.join(project.directory, 'project.sqlite');
  legacyProject(file, `DROP TABLE board_edges; DROP TABLE shot_candidates; DROP TABLE shot_audio;
    ALTER TABLE shots DROP COLUMN action_dialogue;
    ALTER TABLE ideas DROP COLUMN x; ALTER TABLE ideas DROP COLUMN y;
    ALTER TABLE ideas DROP COLUMN tags; ALTER TABLE ideas DROP COLUMN notes; ALTER TABLE ideas DROP COLUMN source_asset_id;
    ALTER TABLE assets DROP COLUMN tags;
    CREATE TABLE old_links AS SELECT shot_id, asset_id FROM shot_assets;
    DROP TABLE shot_assets;
    ALTER TABLE old_links RENAME TO shot_assets;
    PRAGMA user_version = 2;`);
  const migrated = readProject(project.directory);
  expect(migrated.shotAssets[0]).toEqual({
    shotId: project.shots[0].id,
    assetId: project.assets[0].id,
    inMs: 0,
    outMs: null
  });
  expect(existsSync(`${file}.before-v11.bak`)).toBe(true);
});
test('valid trim persists; invalid trim leaves the previous range intact', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const source = path.join(root, 'clip.mp4');
  writeFileSync(source, 'sample-video-bytes');
  let project = addShot(createProject(root, '裁剪项目').directory, {
    description: '开场',
    durationMs: 2000
  });
  project = await importAsset(project.directory, source);
  project = linkAsset(project.directory, project.shots[0].id, project.assets[0].id);
  project = updateTrim(project.directory, project.shots[0].id, 1500, 4000);
  expect(project.shotAssets[0].inMs).toBe(1500);
  expect(project.shotAssets[0].outMs).toBe(4000);
  expect(() => updateTrim(project.directory, project.shots[0].id, 4000, 1500)).toThrow('出点必须晚于入点');
  expect(readProject(project.directory).shotAssets[0].outMs).toBe(4000);
});
test('ideas and imported media persist and can be linked to a shot', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const source = path.join(root, 'frame.png');
  writeFileSync(source, 'sample-image-bytes');
  let project = addShot(createProject(root, '素材项目').directory, {
    description: '开场',
    durationMs: 1000
  });
  project = addIdea(project.directory, '雨中的街道');
  const progress: Array<[number, number]> = [];
  project = await importAsset(project.directory, source, {
    onProgress: (copied, total) => progress.push([copied, total])
  });
  expect(progress.at(-1)).toEqual([18, 18]);
  project = linkAsset(project.directory, project.shots[0].id, project.assets[0].id);
  const reopened = readProject(project.directory);
  expect(reopened.ideas[0].text).toBe('雨中的街道');
  expect(reopened.shotAssets[0].assetId).toBe(reopened.assets[0].id);
  expect(readFileSync(path.join(project.directory, reopened.assets[0].relativePath), 'utf8')).toBe('sample-image-bytes');
});
test('cancelled import leaves no asset record or partial file', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const source = path.join(root, 'large.mp4');
  writeFileSync(source, Buffer.alloc(4 * 1024 * 1024));
  const project = createProject(root, '取消导入');
  const controller = new AbortController();
  await expect(importAsset(project.directory, source, {
    signal: controller.signal,
    onProgress: () => controller.abort()
  })).rejects.toThrow();
  expect(readProject(project.directory).assets).toEqual([]);
  expect(readdirSync(path.join(project.directory, 'assets'))).toEqual([]);
});
test('rename, shot order, deletion and linked media survive reopening', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const source = path.join(root, 'sound.mp3');
  writeFileSync(source, 'sample-audio');
  let project = createProject(root, '原名');
  project = addShot(project.directory, {
    description: '第一镜',
    actionDialogue: '对白一',
    durationMs: 1000
  });
  project = addShot(project.directory, {
    description: '第二镜',
    durationMs: 2000
  });
  project = await importAsset(project.directory, source);
  project = linkAudio(project.directory, project.shots[0].id, project.assets[0].id);
  project = moveShot(project.directory, project.shots[1].id, -1);
  expect(project.shots.map(shot => shot.description)).toEqual(['第二镜', '第一镜']);
  project = deleteShot(project.directory, project.shots[0].id);
  project = renameProject(project.directory, '新名');
  const reopened = readProject(project.directory);
  expect(reopened.name).toBe('新名');
  expect(reopened.shots.map(shot => [shot.position, shot.description, shot.actionDialogue])).toEqual([[0, '第一镜', '对白一']]);
  expect(reopened.shotAudio[0].assetId).toBe(reopened.assets[0].id);
});
test('idea and asset metadata persist; missing media can be relinked', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const source = path.join(root, 'frame.png');
  writeFileSync(source, 'sample-image');
  let project = createProject(root, '灵感项目');
  project = await importAsset(project.directory, source);
  project = updateAssetTags(project.directory, project.assets[0].id, '雨夜,街道');
  project = attachIdeaAsset(project.directory, project.assets[0].id);
  project = updateIdea(project.directory, project.ideas[0].id, {
    text: '开场气氛',
    tags: '悬疑',
    notes: '蓝色调'
  });
  const assetFile = path.join(project.directory, project.assets[0].relativePath);
  rmSync(assetFile);
  expect(readProject(project.directory).assets[0].missing).toBe(true);
  project = await relinkAsset(project.directory, project.assets[0].id, source);
  expect(project.assets[0].missing).toBe(false);
  expect(project.assets[0].tags).toBe('雨夜,街道');
  expect(project.ideas[0]).toMatchObject({
    text: '开场气氛',
    tags: '悬疑',
    notes: '蓝色调',
    sourceAssetId: project.assets[0].id
  });
});
test('duplicate import is rejected and orphan partial is cleaned on reopen', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const source = path.join(root, 'frame.png');
  writeFileSync(source, 'same-content');
  let project = createProject(root, '去重');
  project = await importAsset(project.directory, source);
  await expect(importAsset(project.directory, source)).rejects.toThrow('已在项目中');
  expect(readProject(project.directory).assets).toHaveLength(1);
  const partial = path.join(project.directory, 'assets', '00000000-0000-0000-0000-000000000000.png.partial');
  writeFileSync(partial, 'orphan');
  expect(cleanupPartialAssets(project.directory)).toBe(1);
  expect(existsSync(partial)).toBe(false);
});
test('multiple visual candidates keep one selected main asset', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const first = path.join(root, 'one.png');
  const second = path.join(root, 'two.png');
  writeFileSync(first, 'image-one');
  writeFileSync(second, 'image-two');
  let project = addShot(createProject(root, '候选').directory, {
    description: '镜头',
    durationMs: 1000
  });
  project = await importAsset(project.directory, first);
  project = await importAsset(project.directory, second);
  project = addCandidate(project.directory, project.shots[0].id, project.assets[0].id);
  project = addCandidate(project.directory, project.shots[0].id, project.assets[1].id);
  project = linkAsset(project.directory, project.shots[0].id, project.assets[1].id);
  expect(project.shotCandidates).toHaveLength(2);
  expect(project.shotAssets[0].assetId).toBe(project.assets[1].id);
  expect(() => removeCandidate(project.directory, project.shots[0].id, project.assets[1].id)).toThrow('先选择其他主画面');
  project = removeCandidate(project.directory, project.shots[0].id, project.assets[0].id);
  expect(project.shotCandidates).toHaveLength(1);
});
test('existing v3 project retains trim and main asset after v8 migration', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const source = path.join(root, 'clip.mp4');
  writeFileSync(source, 'video-content');
  let project = addShot(createProject(root, '迁移').directory, {
    description: '镜头',
    durationMs: 1000
  });
  project = await importAsset(project.directory, source);
  project = linkAsset(project.directory, project.shots[0].id, project.assets[0].id);
  project = updateTrim(project.directory, project.shots[0].id, 500, 900);
  const file = path.join(project.directory, 'project.sqlite');
  legacyProject(file, `DROP TABLE board_edges; DROP TABLE shot_candidates; DROP TABLE shot_audio;
    ALTER TABLE shots DROP COLUMN action_dialogue;
    ALTER TABLE ideas DROP COLUMN x; ALTER TABLE ideas DROP COLUMN y;
    ALTER TABLE ideas DROP COLUMN tags; ALTER TABLE ideas DROP COLUMN notes; ALTER TABLE ideas DROP COLUMN source_asset_id;
    ALTER TABLE assets DROP COLUMN tags; PRAGMA user_version = 3;`);
  const reopened = readProject(project.directory);
  expect(reopened.shotAssets[0]).toMatchObject({
    inMs: 500,
    outMs: 900,
    assetId: project.assets[0].id
  });
  expect(reopened.shotCandidates).toEqual([{
    shotId: project.shots[0].id,
    assetId: project.assets[0].id
  }]);
  expect(existsSync(`${file}.before-v11.bak`)).toBe(true);
});
test('deleting an idea keeps its source; deleting media clears references and project copy', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const image = path.join(root, 'frame.png');
  const audio = path.join(root, 'sound.mp3');
  writeFileSync(image, 'image-bytes');
  writeFileSync(audio, 'audio-bytes');
  let project = addShot(createProject(root, '删除测试').directory, {
    description: '镜头',
    durationMs: 1000
  });
  project = await importAsset(project.directory, image);
  project = await importAsset(project.directory, audio);
  const imageId = project.assets[0].id;
  const audioId = project.assets[1].id;
  project = attachIdeaAsset(project.directory, imageId);
  const firstIdeaId = project.ideas[0].id;
  project = deleteIdea(project.directory, firstIdeaId);
  expect(project.ideas).toEqual([]);
  expect(project.assets).toHaveLength(2);
  project = attachIdeaAsset(project.directory, imageId);
  project = linkAsset(project.directory, project.shots[0].id, imageId);
  project = linkAudio(project.directory, project.shots[0].id, audioId);
  const projectImage = path.join(project.directory, project.assets[0].relativePath);
  project = deleteAsset(project.directory, imageId);
  expect(existsSync(projectImage)).toBe(false);
  expect(existsSync(image)).toBe(true);
  expect(project.shotAssets).toEqual([]);
  expect(project.shotCandidates).toEqual([]);
  expect(project.ideas[0].sourceAssetId).toBeNull();
  expect(project.shotAudio[0].assetId).toBe(audioId);
  project = deleteAsset(project.directory, audioId);
  expect(project.shotAudio).toEqual([]);
  expect(project.assets).toEqual([]);
});
test('interrupted media deletion restores project copy when database record still exists', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-test-'));
  folders.push(root);
  const source = path.join(root, 'frame.png');
  writeFileSync(source, 'image-bytes');
  const project = await importAsset(createProject(root, '恢复').directory, source);
  const file = path.join(project.directory, project.assets[0].relativePath);
  renameSync(file, `${file}.delete-pending`);
  expect(cleanupPartialAssets(project.directory)).toBe(0);
  expect(existsSync(file)).toBe(true);
  expect(existsSync(`${file}.delete-pending`)).toBe(false);
});
