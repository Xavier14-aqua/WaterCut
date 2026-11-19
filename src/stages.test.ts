import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import * as p from './project';
import * as l from './library';
import * as w from './workspace';
import { emptyPayload, type IdeaInput, type LibraryAsset } from './shared/models';
import { buildPreviewSequence, effectiveDurationMs, suggestedIdeaOrder } from './shared/duration';
import { readStorageSettings, writeStorageSettings } from './settings';
import { boardRegion,withBoardRegion,boardRegions } from './shared/board';
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-stages-'));
  roots.push(root);
  return {
    root,
    library: path.join(root, 'library'),
    projects: path.join(root, 'projects')
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('watercut-stages-')) throw new Error('Unsafe test cleanup path');
    rmSync(root, {
      recursive: true,
      force: true
    });
  }
});
function idea(text: string, patch: Partial<IdeaInput> = {}): IdeaInput {
  return {
    kind: 'scene',
    text,
    tags: '雨后，孤独',
    notes: '',
    payload: {
      ...emptyPayload
    },
    occurredAt: null,
    ...patch
  };
}
function media(root: string, name = 'clip.mp4', content = 'test-original-bytes') {
  const file = path.join(root, name);
  writeFileSync(file, content);
  return file;
}
test('library deduplicates originals across filenames; cancellation leaves no media record', async () => {
  const f = fixture(),
    a = await l.importLibraryAsset(f.library, media(f.root, 'a.mp4')),
    b = await l.importLibraryAsset(f.library, media(f.root, 'b.mp4'));
  expect(a.id).toBe(b.id);
  expect(l.readLibrary(f.library).totalAssets).toBe(1);
  const controller = new AbortController();
  controller.abort();
  await expect(l.importLibraryAsset(f.library, media(f.root, 'other.mp4', 'different'), {
    signal: controller.signal
  })).rejects.toThrow();
  expect(l.readLibrary(f.library).totalAssets).toBe(1);
  expect(readdirSync(path.join(f.library, 'jobs')).filter(n => n.endsWith('.partial'))).toEqual([]);
});
test('Chinese short queries, literal wildcard queries, tags and date ranges are exact', () => {
  const f = fixture();
  l.saveLibraryIdea(f.library, idea('雨后 100% 平静_片段', {
    occurredAt: '2024-03-05T00:00:00.000Z'
  }));
  l.saveLibraryIdea(f.library, idea('晴天', {
    tags: '雨后街道'
  }));
  expect(l.readLibrary(f.library, {
    search: '雨'
  }).totalIdeas).toBe(2);
  expect(l.readLibrary(f.library, {
    search: '%'
  }).totalIdeas).toBe(1);
  expect(l.readLibrary(f.library, {
    search: '_'
  }).totalIdeas).toBe(1);
  expect(l.readLibrary(f.library, {
    tag: '雨后'
  }).totalIdeas).toBe(1);
  expect(l.readLibrary(f.library, {
    before: '2024-04-01T00:00:00.000Z'
  }).totalIdeas).toBe(1);
});
test('mood attachment limits, source versions and confirmed versus suggested relationships', async () => {
  const f = fixture(),
    a = l.saveLibraryIdea(f.library, idea('甲')),
    b = l.saveLibraryIdea(f.library, idea('乙'));
  expect(l.relatedIdeas(f.library, a.id)[0].idea.id).toBe(b.id);
  expect(l.readLibrary(f.library).relations).toHaveLength(0);
  l.connectLibraryIdeas(f.library, a.id, b.id, 'related', '相近情绪');
  l.connectLibraryIdeas(f.library, b.id, a.id, 'related', '修改备注');
  expect(l.readLibrary(f.library).relations).toHaveLength(1);
  l.saveLibraryIdea(f.library, {
    ...a,
    expectedVersion: a.version,
    text: '已更新'
  });
  expect(() => l.saveLibraryIdea(f.library, {
    ...a,
    expectedVersion: a.version,
    text: '旧内容'
  })).toThrow('已被更新');
  const assets: LibraryAsset[] = [];
  for (let i = 0; i < 4; i++) assets.push(await l.importLibraryAsset(f.library, media(f.root, `${i}.png`, `${i}`)));
  expect(() => l.saveLibraryIdea(f.library, idea('情绪', {
    kind: 'mood',
    media: assets.map((asset, position) => ({
      assetId: asset.id,
      role: 'image',
      position,
      inMs: 0,
      outMs: null
    }))
  }))).toThrow('最多关联三张');
});
test('shared originals keep two project trims and card edits independent; hiding does not break playback', async () => {
  const f = fixture(),
    asset = await l.importLibraryAsset(f.library, media(f.root));
  l.updateLibraryAsset(f.library, asset.id, {
    durationMs: 30000
  });
  const source = l.saveLibraryIdea(f.library, idea('原始灵感', {
    media: [{
      assetId: asset.id,
      role: 'video',
      position: 0,
      inMs: 0,
      outMs: null
    }]
  }));
  const a = p.createProject(f.projects, 'A'),
    b = p.createProject(f.projects, 'B');
  w.attachIdeas(a.directory, f.library, [source.id]);
  w.attachIdeas(b.directory, f.library, [source.id]);
  let first = w.hydrateProject(a.directory, f.library),
    second = w.hydrateProject(b.directory, f.library);
  expect(first.ideas[0].media[0].assetId).toBe(first.assets[0].id);
  first = p.addShot(a.directory, {
    description: 'A',
    durationMs: 1000
  });
  second = p.addShot(b.directory, {
    description: 'B',
    durationMs: 1000
  });
  p.linkAsset(a.directory, first.shots[0].id, first.assets[0].id);
  p.linkAsset(b.directory, second.shots[0].id, second.assets[0].id);
  p.updateTrim(a.directory, first.shots[0].id, 0, 5000);
  p.updateTrim(b.directory, second.shots[0].id, 20000, 25000);
  p.updateIdea(a.directory, first.ideas[0].id, {
    ...first.ideas[0],
    text: 'A 的局部修改'
  });
  l.saveLibraryIdea(f.library, {
    ...source,
    expectedVersion: source.version,
    text: '全局新版'
  });
  expect(p.readProject(a.directory).ideas[0].text).toBe('A 的局部修改');
  expect(p.readProject(b.directory).ideas[0].text).toBe('原始灵感');
  expect(p.readProject(b.directory).shotAssets[0].inMs).toBe(20000);
  l.setLibraryHidden(f.library, 'asset', asset.id, true);
  l.setLibraryHidden(f.library, 'idea', source.id, true);
  expect(l.readLibrary(f.library).totalAssets).toBe(0);
  expect(w.hydrateProject(a.directory, f.library).assets[0].missing).toBe(false);
  w.refreshIdea(b.directory, f.library, second.ideas[0].id);
  expect(p.readProject(b.directory).ideas[0].text).toBe('全局新版');
  expect(p.readProject(a.directory).ideas[0].text).toBe('A 的局部修改');
  p.deleteAsset(a.directory, first.assets[0].id);
  expect(existsSync(l.safeLibraryPath(f.library, asset.relativePath))).toBe(true);
  expect(w.hydrateProject(b.directory, f.library).assets[0].missing).toBe(false);
  const cloned=w.attachIdeas(a.directory,f.library,[source.id],true);expect(cloned.ideas).toHaveLength(2);expect(cloned.ideas[0].text).toBe('A 的局部修改');expect(cloned.ideas[1].id).not.toBe(cloned.ideas[0].id);
});
test('promotion is resumable/idempotent and preserves project originals and graph', async () => {
  const f = fixture();
  let project = p.createProject(f.projects, '旧项目');
  project = await p.importAsset(project.directory, media(f.root, 'a.mp4'));
  project = await p.importAsset(project.directory, media(f.root, 'b.mp4', 'other'));
  project = p.attachIdeaAsset(project.directory, project.assets[0].id);
  project = p.addIdea(project.directory, '另一张卡');
  project = p.connectIdeas(project.directory, project.ideas[0].id, project.ideas[1].id);
  const controller = new AbortController();
  await expect(w.promoteProject(project.directory, f.library, {
    signal: controller.signal,
    onProgress: () => controller.abort()
  })).rejects.toThrow('已取消');
  await w.promoteProject(project.directory, f.library);
  await w.promoteProject(project.directory, f.library);
  const page = l.readLibrary(f.library);
  expect(page.totalAssets).toBe(2);
  expect(page.totalIdeas).toBe(2);
  expect(page.relations).toHaveLength(1);
  expect(p.readProject(project.directory).assets.every(a => a.storageKind === 'local' && existsSync(path.join(project.directory, a.relativePath)))).toBe(true);
});
test('project registration rejects duplicate identities and reconciles usage outbox', async () => {
  const f = fixture(),
    asset = await l.importLibraryAsset(f.library, media(f.root));
  let project = p.createProject(f.projects, '引用');
  w.attachAssets(project.directory, f.library, [asset.id]);
  project = p.addShot(project.directory, {
    description: '镜头',
    durationMs: 1000
  });
  p.linkAsset(project.directory, project.shots[0].id, project.assets[0].id);
  w.projectEnvelope(project.directory, f.library);
  expect(l.listUsage(f.library, asset.id).some(u => u.role === 'main')).toBe(true);
  const db = p.openDatabase(project.directory);
  expect(db.prepare('SELECT * FROM outbox').all()).toHaveLength(0);
  db.close();
  expect(() => l.syncProjectCatalog(f.library, {
    ...project,
    directory: path.join(f.projects, 'copy.watercut')
  })).toThrow('相同项目 ID');
  p.deleteShot(project.directory, project.shots[0].id);
  w.reconcileCatalog(f.library);
  expect(l.listUsage(f.library, asset.id).filter(u => u.role === 'main')).toHaveLength(0);
});
test('library relinking verifies original content before restoring the shared file', async () => {
  const f = fixture(),
    source = media(f.root),
    asset = await l.importLibraryAsset(f.library, source);
  rmSync(l.safeLibraryPath(f.library, asset.relativePath));
  await expect(l.relinkLibraryAsset(f.library, asset.id, media(f.root, 'wrong.mp4', 'wrong'))).rejects.toThrow('内容与原件不同');
  expect(l.getLibraryAsset(f.library, asset.id).missing).toBe(true);
  expect((await l.relinkLibraryAsset(f.library, asset.id, source)).missing).toBe(false);
  expect(l.readLibrary(f.library).totalAssets).toBe(1);
});
test('script conversion is atomic and idempotent; both views share dialogue and order', () => {
  const f = fixture();
  let project = p.createProject(f.projects, '脚本');
  project = p.saveScriptBlock(project.directory, {
    kind: 'body',
    text: '第一段旁白'
  });
  project = p.saveScriptBlock(project.directory, {
    kind: 'body',
    text: '第二段旁白'
  });
  const ids = project.scriptBlocks.map(b => b.id),
    command = randomUUID();
  p.convertScriptBlocks(project.directory, ids, command);
  project = p.convertScriptBlocks(project.directory, ids, command);
  expect(project.shots).toHaveLength(2);
  expect(project.scriptBlocks).toHaveLength(2);
  project = p.saveScriptBlock(project.directory, {
    id: ids[0],
    kind: 'body',
    text: '从脚本改对白'
  });
  expect(project.shots[0].actionDialogue).toBe('从脚本改对白');
  project = p.updateShot(project.directory, project.shots[0].id, {
    ...project.shots[0],
    actionDialogue: '从分镜改对白'
  });
  expect(project.scriptBlocks[0].text).toBe('从分镜改对白');
  project = p.moveShot(project.directory, project.shots[1].id, -1);
  expect(project.scriptBlocks[0].shotId).toBe(project.shots[0].id);
  expect(() => p.reorderShots(project.directory, [project.shots[0].id, project.shots[0].id])).toThrow('顺序不完整');
  project = p.deleteScriptBlock(project.directory, ids[0]);
  expect(project.shots).toHaveLength(1);
  expect(project.scriptBlocks).toHaveLength(1);
});
test('manual board conversion records provenance and preserves excerpts after card removal', () => {
  const f = fixture();
  let project = p.addIdea(p.createProject(f.projects, '来源').directory, '场景来源');
  const source = project.ideas[0].id,
    command = randomUUID();
  p.createShotsFromIdeas(project.directory, [source], command);
  project = p.createShotsFromIdeas(project.directory, [source], command);
  expect(project.shots).toHaveLength(1);
  expect(project.shots[0].description).toBe('');
  expect(project.shotSources[0].excerpt).toBe('场景来源');
  project = p.deleteIdea(project.directory, source);
  expect(project.shotSources[0]).toMatchObject({
    ideaId: null,
    excerpt: '场景来源'
  });
});
test('script splitting and merging retain shared dialogue, candidates and provenance transactionally', () => {
  const f = fixture();
  let project = p.createProject(f.projects, '拆分合并');
  project = p.saveScriptBlock(project.directory, {
    kind: 'body',
    text: '前半后半'
  });
  const block = project.scriptBlocks[0].id;
  project = p.splitScriptBlock(project.directory, block, 2);
  expect(project.scriptBlocks.map(b => b.text)).toEqual(['前半', '后半']);
  project = p.convertScriptBlocks(project.directory, project.scriptBlocks.map(b => b.id), randomUUID());
  const first = project.scriptBlocks[0].id,
    second = project.scriptBlocks[1].id;
  project = p.mergeScriptBlocks(project.directory, first, second);
  expect(project.shots).toHaveLength(1);
  expect(project.shots[0]).toMatchObject({
    actionDialogue: '前半\n后半',
    needsReview: true
  });
  project = p.splitScriptBlock(project.directory, first, 3);
  expect(project.shots).toHaveLength(2);
  expect(project.scriptBlocks.map(b => b.shotId)).toEqual(project.shots.map(s => s.id));
  expect(() => p.mergeScriptBlocks(project.directory, project.scriptBlocks[1].id, project.scriptBlocks[0].id)).toThrow('相邻');
  expect(p.readProject(project.directory).shots).toHaveLength(2);
});
test('sequence order detects branches/cycles; preview durations retain missing video timing', async () => {
  const f = fixture();
  let project = p.createProject(f.projects, '时长');
  for (const text of ['甲', '乙', '丙']) project = p.addIdea(project.directory, text);
  const ids = project.ideas.map(i => i.id);
  project = p.connectIdeas(project.directory, ids[0], ids[1]);
  project = p.connectIdeas(project.directory, ids[1], ids[2]);
  expect(suggestedIdeaOrder(project, [ids[2], ids[0], ids[1]])).toEqual({
    ids,
    ambiguous: false
  });
  project = p.connectIdeas(project.directory, ids[2], ids[0]);
  expect(suggestedIdeaOrder(project, ids).ambiguous).toBe(true);
  project = p.addShot(project.directory, {
    description: '图像',
    durationMs: 2500
  });
  project = p.addShot(project.directory, {
    description: '视频',
    durationMs: 3000
  });
  project = await p.importAsset(project.directory, media(f.root));
  project = p.updateAssetDuration(project.directory, project.assets[0].id, 10000);
  project = p.linkAsset(project.directory, project.shots[1].id, project.assets[0].id);
  project = p.updateTrim(project.directory, project.shots[1].id, 1000, 5000);
  expect(buildPreviewSequence(project).map(c => [c.startMs, c.durationMs])).toEqual([[0, 2500], [2500, 4000]]);
  rmSync(path.join(project.directory, project.assets[0].relativePath));
  const missing = p.readProject(project.directory);
  expect(buildPreviewSequence(missing)[1]).toMatchObject({
    durationMs: 4000,
    playable: false
  });
  expect(() => p.updateTrim(project.directory, project.shots[1].id, 1000, 11000)).toThrow('超过视频时长');
});
test('storage roots persist across restarts and invalid settings do not replace previous configuration', () => {
  const f = fixture(),
    user = path.join(f.root, 'user');
  const settings = {
    configVersion: 1 as const,
    projectsRoot: f.projects,
    libraryRoot: f.library
  };
  writeStorageSettings(user, settings);
  expect(readStorageSettings(user, 'unused')).toEqual(settings);
  expect(() => writeStorageSettings(user, {
    ...settings,
    libraryRoot: f.projects
  })).toThrow('分别选择');
  expect(readStorageSettings(user, 'unused')).toEqual(settings);
});
test('storage selection cannot recreate personal libraries inside the source workspace', () => {
  const f = fixture(),
    source = path.join(f.root, 'source');
  mkdirSync(source);
  writeFileSync(path.join(source, 'package.json'), '{"name":"watercut"}');
  writeFileSync(path.join(source, 'forge.config.mts'), '');
  expect(() => writeStorageSettings(path.join(f.root, 'user'), {
    configVersion: 1,
    projectsRoot: path.join(source, 'projects'),
    libraryRoot: f.library
  })).toThrow('源码仓库外');
  expect(existsSync(path.join(source, 'projects'))).toBe(false);
});
test('offline global library does not prevent local project saves and preserves pending usage events',()=>{
  const f=fixture();let project=p.createProject(f.projects,'离线项目');project=p.addShot(project.directory,{description:'本地镜头',durationMs:2000});const unavailable=path.join(f.root,'unavailable-library');writeFileSync(unavailable,'not a directory');
  const envelope=w.projectEnvelope(project.directory,unavailable);expect(envelope.project.shots[0].description).toBe('本地镜头');const db=p.openDatabase(project.directory);try{expect(db.prepare('SELECT * FROM outbox').all()).toHaveLength(1);}finally{db.close();}
  project=p.updateShot(project.directory,project.shots[0].id,{...project.shots[0],actionDialogue:'断开总库仍能编辑'});expect(w.projectEnvelope(project.directory,unavailable).project.shots[0].actionDialogue).toBe('断开总库仍能编辑');
});

test('board regions persist as local tags and bound their cards without becoming story sources',()=>{
  const f=fixture();let project=p.addIdea(p.createProject(f.projects,'分区').directory,'分区内的卡片');const id=project.ideas[0].id;project=p.updateIdea(project.directory,id,{...project.ideas[0],tags:withBoardRegion('雨后','开场')});expect(boardRegion(project.ideas[0].tags)).toBe('开场');expect(boardRegions(project.ideas)[0]).toMatchObject({name:'开场',x:-25,y:-45});expect(withBoardRegion(project.ideas[0].tags,'')).toBe('雨后');expect(project.ideas).toHaveLength(1);
});

test('v7 schema upgrades with backup, legacy dates unknown and script projection intact', () => {
  const f = fixture(),
    dir = path.join(f.projects, `${randomUUID()}.watercut`);
  mkdirSync(dir, {
    recursive: true
  });
  const db = new DatabaseSync(path.join(dir, 'project.sqlite'));
  const shot = randomUUID();
  db.exec(`CREATE TABLE project(id TEXT PRIMARY KEY,name TEXT NOT NULL);CREATE TABLE shots(id TEXT PRIMARY KEY,position INTEGER NOT NULL,description TEXT NOT NULL,duration_ms INTEGER NOT NULL,action_dialogue TEXT NOT NULL DEFAULT '');CREATE TABLE ideas(id TEXT PRIMARY KEY,text TEXT NOT NULL,tags TEXT NOT NULL DEFAULT '',notes TEXT NOT NULL DEFAULT '',source_asset_id TEXT,x REAL NOT NULL DEFAULT 0,y REAL NOT NULL DEFAULT 0);CREATE TABLE assets(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,relative_path TEXT NOT NULL,size INTEGER NOT NULL,tags TEXT NOT NULL DEFAULT '');CREATE TABLE shot_assets(shot_id TEXT PRIMARY KEY REFERENCES shots(id),asset_id TEXT NOT NULL REFERENCES assets(id),in_ms INTEGER NOT NULL DEFAULT 0,out_ms INTEGER);CREATE TABLE shot_audio(shot_id TEXT PRIMARY KEY REFERENCES shots(id),asset_id TEXT NOT NULL REFERENCES assets(id));CREATE TABLE shot_candidates(shot_id TEXT NOT NULL,asset_id TEXT NOT NULL,PRIMARY KEY(shot_id,asset_id));CREATE TABLE board_edges(id TEXT PRIMARY KEY,source TEXT NOT NULL REFERENCES ideas(id),target TEXT NOT NULL REFERENCES ideas(id),source_handle TEXT NOT NULL DEFAULT 'bottom',target_handle TEXT NOT NULL DEFAULT 'top',UNIQUE(source,target));PRAGMA user_version=7;`);
  db.prepare('INSERT INTO project VALUES (?,?)').run(randomUUID(), '真实旧结构');
  db.prepare('INSERT INTO shots VALUES (?,0,?,3000,?)').run(shot, '旧画面', '旧对白');
  db.prepare('INSERT INTO ideas(id,text) VALUES (?,?)').run(randomUUID(), '旧灵感');
  db.close();
  const project = p.readProject(dir);
  expect(project.scriptBlocks[0]).toMatchObject({
    shotId: shot,
    text: '旧对白'
  });
  expect(project.ideas[0].recordedAt).toBe(null);
  expect(existsSync(path.join(dir, 'project.sqlite.before-v11.bak'))).toBe(true);
});
