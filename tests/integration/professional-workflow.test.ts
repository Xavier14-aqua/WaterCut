import { afterEach, expect, test, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  renameSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as p from '../../src/modules/project/index';
import * as l from '../../src/modules/library/index';
import * as w from '../../src/modules/workspace/index';
import * as ai from '../../src/modules/ai/proposals';
import { generateSuggestions } from '../../src/main/platform/ai-provider';
import {
  createRevision,
  restoreRevision,
} from '../../src/modules/delivery/revisions';
import {
  exportPackage as exportPackageJob,
  importPackage as importPackageJob,
} from '../../src/modules/delivery/project-package';
import { exportJianying as exportJianyingJob } from '../../src/modules/delivery/jianying-handoff';
import { testFileJobs } from '../support/file-jobs';
import {
  buildTimelineDocument,
  frameToUs,
  msToFrame,
} from '../../src/shared/timeline';
import { jianyingDocuments } from '../../src/modules/delivery/jianying-adapter';
import { filterShotList, rangesOverlap } from '../../src/shared/creative';
import {
  exportRows,
  shotListCSV,
  storyboardHTML,
} from '../../src/shared/print';
import { normalizeMediaInfo } from '../../src/shared/media';
import {
  emptyPayload,
  type Project,
  type IdeaInput,
} from '../../src/shared/models';
const roots: string[] = [];
const jobs = testFileJobs();
const exportPackage = jobs.wrap(exportPackageJob, 4),
  importPackage = jobs.wrap(importPackageJob, 2),
  exportJianying = jobs.wrap(exportJianyingJob, 5);
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-stage4a-'));
  roots.push(root);
  const library = path.join(root, '库'),
    projects = path.join(root, '项目');
  l.readLibrary(library);
  return { root, library, projects };
}
afterEach(async () => {
  await jobs.stop();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith('watercut-stage4a-')
    )
      throw new Error('Unsafe fixture');
    rmSync(root, { recursive: true, force: true });
  }
});
const idea = (text: string, tags = '雨夜'): IdeaInput => ({
  kind: 'scene',
  text,
  tags,
  notes: '',
  payload: { ...emptyPayload },
  occurredAt: null,
});
function original(root: string, name: string, bytes = 'synthetic-original') {
  const file = path.join(root, name);
  writeFileSync(file, bytes);
  return file;
}
function videoMetadata() {
  return normalizeMediaInfo({
    media: {
      track: [
        { '@type': 'General', Duration: 10, Format: 'WebM' },
        {
          '@type': 'Video',
          Width: 640,
          Height: 360,
          FrameRate_Num: 30,
          FrameRate_Den: 1,
          FrameRate_Mode: 'CFR',
        },
      ],
    },
  });
}
async function selected() {
  const f = fixture();
  let asset = await l.importLibraryAsset(
    f.library,
    original(f.root, '原片.webm'),
  );
  asset = l.updateLibraryAsset(f.library, asset.id, { durationMs: 10000 });
  const select = l.saveAssetSelect(f.library, {
    assetId: asset.id,
    name: '回头笑',
    inMs: 1000,
    outMs: 4000,
    note: '情绪转折',
  })[0];
  let project = p.addShot(p.createProject(f.projects, 'A').directory, {
    description: '雨夜',
    durationMs: 3000,
  });
  project = w.bindSelect(
    project.directory,
    f.library,
    project.shots[0].id,
    select.id,
  );
  return { ...f, asset, select, project };
}
async function music() {
  const f = fixture();
  let project = p.createProject(f.projects, '配乐');
  project = await p.importAsset(
    project.directory,
    original(f.root, 'music.wav'),
  );
  const assetId = project.assets[0].id;
  project = p.updateAssetDuration(project.directory, assetId, 10000);
  project = p.addShot(project.directory, {
    description: '雨夜',
    durationMs: 6000,
  });
  const clip = {
    assetId,
    timelineStartMs: 500,
    inMs: 1000,
    outMs: 6000,
    gain: 0.6,
    fadeInMs: 500,
    fadeOutMs: 1000,
  };
  project = p.saveAudioClip(project.directory, clip);
  return { ...f, project, clip };
}
test('selects require known video duration and reject invalid or cross-asset edits', async () => {
  const f = fixture(),
    a = await l.importLibraryAsset(f.library, original(f.root, 'clip.mp4'));
  const input = { assetId: a.id, name: '精选', inMs: 0, outMs: 1000, note: '' };
  expect(() => l.saveAssetSelect(f.library, input)).toThrow('时长未知');
  l.updateLibraryAsset(f.library, a.id, { durationMs: 2000 });
  for (const patch of [
    { inMs: -1 },
    { outMs: 3000 },
    { inMs: 1000, outMs: 1000 },
  ])
    expect(() =>
      l.saveAssetSelect(f.library, { ...input, ...patch }),
    ).toThrow();
  const s = l.saveAssetSelect(f.library, input)[0];
  expect(() =>
    l.saveAssetSelect(f.library, { ...s, name: '改名', expectedVersion: 99 }),
  ).toThrow('已更新');
  expect(l.listAssetSelects(f.library, a.id)[0].name).toBe('精选');
});
test('two projects keep independent ranges through select updates, hiding and snapshot restore', async () => {
  const f = await selected();
  let b = p.addShot(p.createProject(f.projects, 'B').directory, {
    description: 'B',
    durationMs: 1000,
  });
  b = w.bindSelect(b.directory, f.library, b.shots[0].id, f.select.id);
  p.updateTrim(b.directory, b.shots[0].id, 2000, 3000);
  const snap = (
    await createRevision(f.project.directory, f.library, '旧裁剪')
  )[0];
  l.saveAssetSelect(f.library, {
    ...f.select,
    inMs: 5000,
    outMs: 7000,
    expectedVersion: 1,
  });
  l.hideAssetSelect(f.library, f.select.id);
  expect(l.listAssetSelects(f.library, f.asset.id)).toHaveLength(0);
  expect(p.readProject(f.project.directory).shotAssets[0]).toMatchObject({
    inMs: 1000,
    outMs: 4000,
    sourceSelectVersion: 1,
  });
  expect(p.readProject(b.directory).shotAssets[0]).toMatchObject({
    inMs: 2000,
    outMs: 3000,
  });
  p.updateTrim(f.project.directory, f.project.shots[0].id, 0, 2000);
  await restoreRevision(f.project.directory, f.library, snap.id);
  expect(p.readProject(f.project.directory).shotAssets[0]).toMatchObject({
    inMs: 1000,
    outMs: 4000,
    sourceSelectId: f.select.id,
  });
});
test('usage indexes distinguish primary, candidate-only, reference audio and BGM without double count', async () => {
  const f = await selected();
  let project = p.addShot(f.project.directory, {
    description: '备选',
    durationMs: 1000,
  });
  const other = project.shots[1];
  project = p.addCandidate(project.directory, other.id, project.assets[0].id);
  w.projectEnvelope(project.directory, f.library);
  let usage = l.listUsage(f.library, f.asset.id);
  expect(usage.filter((u) => u.role === 'main')).toHaveLength(1);
  expect(usage.filter((u) => u.role === 'candidate')).toHaveLength(1);
  expect(
    l
      .listUsage(f.library, f.asset.id, { inMs: 4000, outMs: 5000 })
      .some((u) => u.role === 'main'),
  ).toBe(false);
  expect(l.listAssetSelects(f.library, f.asset.id)[0]).toMatchObject({
    usageCount: 1,
  });
  expect(usage.find((u) => u.role === 'main')).toMatchObject({
    shotNumber: 1,
    inMs: 1000,
    outMs: 4000,
    stale: false,
  });
  p.renameProject(project.directory, 'changed');
  expect(l.listUsage(f.library, f.asset.id).every((u) => u.stale)).toBe(true);
  w.projectEnvelope(project.directory, f.library);
  expect(l.listUsage(f.library, f.asset.id).every((u) => !u.stale)).toBe(true);
  renameSync(project.directory, project.directory + '-offline');
  usage = l.listUsage(f.library, f.asset.id);
  expect(usage.every((u) => !u.available && u.stale)).toBe(true);
  expect(
    rangesOverlap({ inMs: 0, outMs: 1000 }, { inMs: 1000, outMs: 2000 }),
  ).toBe(false);
});
test('BGM use footprints preserve audio ranges and reference-audio roles', async () => {
  const f = fixture();
  let a = await l.importLibraryAsset(f.library, original(f.root, 'bgm.wav'));
  a = l.updateLibraryAsset(f.library, a.id, { durationMs: 10000 });
  let project = p.attachLibraryAssets(
    p.createProject(f.projects, '角色').directory,
    [a],
  );
  project = p.addShot(project.directory, {
    description: '镜头',
    durationMs: 6000,
  });
  const id = project.assets[0].id;
  project = p.linkAudio(project.directory, project.shots[0].id, id);
  project = p.saveAudioClip(project.directory, {
    assetId: id,
    timelineStartMs: 0,
    inMs: 1000,
    outMs: 4000,
    gain: 1,
    fadeInMs: 0,
    fadeOutMs: 0,
  });
  w.projectEnvelope(project.directory, f.library);
  expect(
    l
      .listUsage(f.library, a.id)
      .map((u) => u.role)
      .sort(),
  ).toEqual(['audio', 'bgm', 'project']);
  expect(
    l
      .listUsage(f.library, a.id, { inMs: 4000, outMs: 5000 })
      .map((u) => u.role),
  ).toEqual(['audio']);
});
test('BGM bounds, gain and fade validation are atomic; deleting audio removes its clips', async () => {
  const f = await music(),
    before = p.readProject(f.project.directory);
  for (const patch of [
    { outMs: 11000 },
    { gain: 2.1 },
    { fadeInMs: 5000, fadeOutMs: 1000 },
    { inMs: 6000, outMs: 6000 },
  ])
    expect(() =>
      p.saveAudioClip(before.directory, { ...f.clip, ...patch }),
    ).toThrow();
  expect(p.readProject(before.directory).revision).toBe(before.revision);
  expect(p.readProject(before.directory).audioClips).toEqual(before.audioClips);
  expect(
    p.deleteAsset(before.directory, before.assets[0].id).audioClips,
  ).toEqual([]);
});
test('audio settings and production fields survive snapshot and independent ZIP', async () => {
  const f = await music();
  let project = p.updateShotMetadata(
    f.project.directory,
    f.project.shots[0].id,
    {
      ...f.project.shots[0],
      scene: '地铁',
      timeOfDay: '夜',
      props: '耳机',
      productionState: 'pickup',
    },
  );
  project = p.saveTimelineSettings(project.directory, {
    ...project.timelineSettings,
    videoGain: 0.5,
    bgmGain: 0.3,
    fpsNum: 25,
  });
  const snapshot = (
    await createRevision(project.directory, f.library, '配乐版')
  )[0];
  p.deleteAudioClip(project.directory, project.audioClips[0].id);
  await restoreRevision(project.directory, f.library, snapshot.id);
  const zip = path.join(f.root, 'copy.zip');
  await exportPackage(project.directory, f.library, zip, {
    includeMedia: true,
    includeHistory: true,
  });
  const imported = await importPackage(zip, path.join(f.root, '目标'));
  expect(imported.audioClips[0]).toMatchObject(f.clip);
  expect(imported.timelineSettings).toMatchObject({
    videoGain: 0.5,
    bgmGain: 0.3,
    fpsNum: 25,
  });
  expect(imported.shots[0]).toMatchObject({
    props: '耳机',
    productionState: 'pickup',
  });
});
test('independent project packages retain select names and trims without dangling global identities', async () => {
  const f = await selected(),
    zip = path.join(f.root, 'select.zip');
  await exportPackage(f.project.directory, f.library, zip, {
    includeMedia: true,
    includeHistory: false,
  });
  const imported = await importPackage(zip, path.join(f.root, '导入'));
  expect(imported.shotAssets[0]).toMatchObject({
    inMs: 1000,
    outMs: 4000,
    sourceSelectName: '回头笑',
    sourceSelectId: null,
    sourceSelectVersion: null,
  });
  expect(imported.assets[0].storageKind).toBe('local');
});
test('genuine v10 database migrates with backup and preserves old clips and script ordering', () => {
  const f = fixture(),
    project = p.addShot(p.createProject(f.projects, '迁移').directory, {
      description: '原始镜头',
      durationMs: 3333,
    });
  const db = new DatabaseSync(path.join(project.directory, 'project.sqlite'));
  db.exec('BEGIN IMMEDIATE');
  for (const row of db
    .prepare("SELECT name FROM sqlite_master WHERE type='trigger'")
    .all() as any[])
    db.exec(`DROP TRIGGER "${row.name}"`);
  db.exec(
    'DROP TABLE audio_clips;DROP TABLE timeline_settings;DROP TABLE ai_proposals;ALTER TABLE shots DROP COLUMN props;ALTER TABLE shots DROP COLUMN production_state;ALTER TABLE shot_assets DROP COLUMN source_select_id;ALTER TABLE shot_assets DROP COLUMN source_select_version;ALTER TABLE shot_assets DROP COLUMN source_select_name;PRAGMA user_version=10;COMMIT;',
  );
  db.close();
  const migrated = p.readProject(project.directory);
  expect(migrated.shots[0]).toMatchObject({
    description: '原始镜头',
    props: '',
    productionState: 'planned',
  });
  expect(migrated.audioClips).toEqual([]);
  expect(
    readdirSync(project.directory).some((n) => n.includes('before-v11')),
  ).toBe(true);
});
test('shot-list UI and export share scene, day/night, prop, production and gap filtering', async () => {
  const f = await music();
  let project = p.updateShotMetadata(
    f.project.directory,
    f.project.shots[0].id,
    {
      ...f.project.shots[0],
      scene: '地铁',
      timeOfDay: '夜',
      props: '耳机',
      productionState: 'pickup',
    },
  );
  project = p.addShot(project.directory, {
    description: '不导出',
    durationMs: 1000,
  });
  const filter = {
    scene: '地铁',
    timeOfDay: '夜',
    props: '耳机',
    productionState: 'pickup' as const,
    onlyGaps: true,
  };
  expect(filterShotList(project, filter).map((s) => s.id)).toEqual(
    exportRows(project, true, filter).map((r) => r.id),
  );
  expect(shotListCSV(project, filter)).toContain('耳机');
  expect(shotListCSV(project, filter)).not.toContain('不导出');
  expect(
    storyboardHTML(project, { checklist: true, landscape: true, filter }, {}),
  ).not.toContain('不导出');
  expect(filterShotList(project, { onlyGaps: false })).toHaveLength(2);
});
test('timeline uses absolute rational frame boundaries without cumulative drift', () => {
  const f = fixture(),
    base = p.createProject(f.projects, '精度'),
    single = p.addShot(base.directory, { description: '镜头', durationMs: 101 })
      .shots[0];
  const project = {
    ...base,
    shots: Array.from({ length: 600 }, (_, i) => ({
      ...single,
      id: randomUUID(),
      position: i,
    })),
    timelineSettings: { ...base.timelineSettings, fpsNum: 30000, fpsDen: 1001 },
  };
  const doc = buildTimelineDocument(project);
  expect(doc.durationFrames).toBe(Math.round((60600 * 30000) / 1001000));
  expect(doc.durationUs).toBe(
    frameToUs(
      msToFrame(60600, project.timelineSettings),
      project.timelineSettings,
    ),
  );
  expect(
    doc.video.every(
      (c, i) =>
        i === 0 ||
        c.startUs === doc.video[i - 1].startUs + doc.video[i - 1].durationUs,
    ),
  ).toBe(true);
  expect(() => jianyingDocuments(doc, f.root)).toThrow('整数');
});
test('timeline rejects VFR, unknown rates, missing audio and invalid quantized ranges explicitly', async () => {
  const f = await selected(),
    project = w.hydrateProject(f.project.directory, f.library);
  project.assets[0].metadata = videoMetadata();
  expect(buildTimelineDocument(project).video[0].sourceInUs).toBe(1000000);
  project.assets[0].metadata!.streams[0].variableFrameRate = true;
  expect(() => buildTimelineDocument(project)).toThrow('变帧率');
  project.assets[0].metadata = null;
  expect(() => buildTimelineDocument(project)).toThrow('帧率未知');
  project.assets[0].missing = true;
  expect(() => buildTimelineDocument(project, false)).toThrow('缺少原件');
  expect(buildTimelineDocument(project).media[0].placeholderText).toContain(
    '雨夜',
  );
  const m = await music();
  m.project.assets[0].missing = true;
  expect(() => buildTimelineDocument(m.project)).toThrow('BGM 原件离线');
});
test('Jianying export copies media, preserves cuts/gains/fades and hashes the reviewable draft', async () => {
  const f = await music(),
    parent = path.join(f.root, '交接');
  mkdirSync(parent);
  const timeline = buildTimelineDocument(f.project),
    placeholder = original(f.root, 'placeholder.png', 'synthetic-png');
  const result = await exportJianying(
    f.project.directory,
    f.library,
    parent,
    { placeholders: true, baseRevision: f.project.revision },
    Object.fromEntries(
      timeline.media
        .filter((m) => !m.sourceAssetId)
        .map((m) => [m.id, placeholder]),
    ),
  );
  const content = JSON.parse(
      readFileSync(path.join(result.directory, 'draft_content.json'), 'utf8'),
    ),
    manifest = JSON.parse(
      readFileSync(
        path.join(result.directory, 'watercut-handoff.json'),
        'utf8',
      ),
    );
  expect(content.tracks.map((t: any) => t.type)).toEqual(['video', 'audio']);
  const audio = content.tracks[1].segments[0];
  expect(audio).toMatchObject({
    source_timerange: { start: 1000000, duration: 5000000 },
    target_timerange: { start: 500000, duration: 5000000 },
    volume: 0.6,
  });
  expect(content.materials.audio_fades[0]).toMatchObject({
    fade_in_duration: 500000,
    fade_out_duration: 1000000,
  });
  for (const item of manifest.files) {
    const bytes = readFileSync(path.join(result.directory, item.path));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(item.sha256);
  }
  expect(content.materials.audios.every((m: any) => existsSync(m.path))).toBe(
    true,
  );
  expect(result.placeholders).toBe(1);
  expect(
    readFileSync(path.join(result.directory, '分镜清单.csv'), 'utf8'),
  ).toContain('雨夜');
  const controller = new AbortController();
  controller.abort();
  await expect(
    exportJianying(
      f.project.directory,
      f.library,
      parent,
      { placeholders: true, baseRevision: f.project.revision },
      {},
      { signal: controller.signal },
    ),
  ).rejects.toThrow();
  expect(readdirSync(parent).filter((n) => n.startsWith('.watercut-'))).toEqual(
    [],
  );
});
test('truncated BGM with fades is rejected instead of silently changing its envelope', async () => {
  const f = await music();
  f.project.audioClips[0].outMs = 9000;
  expect(() => buildTimelineDocument(f.project)).toThrow('越过画面结尾');
});
test('local echoes rank tags, exclude attached/hidden cards and escape literal SQL patterns', () => {
  const f = fixture(),
    match = l.saveLibraryIdea(f.library, idea('雨夜地铁')),
    hidden = l.saveLibraryIdea(f.library, idea('雨夜隐藏'));
  l.setLibraryHidden(f.library, 'idea', hidden.id, true);
  expect(
    l.ideaEchoes(f.library, { text: '雨夜地铁', tags: '雨夜', exclude: [] })
      .ideas[0].idea.id,
  ).toBe(match.id);
  expect(
    l.ideaEchoes(f.library, { text: '雨夜', tags: '', exclude: [match.id] })
      .ideas,
  ).toEqual([]);
  expect(
    l.ideaEchoes(f.library, { text: '%%__', tags: '', exclude: [] }).ideas,
  ).toEqual([]);
});
function aiFixture() {
  const f = fixture();
  let project = p.createIdea(
    p.createProject(f.projects, 'AI').directory,
    idea('雨夜思路'),
  );
  project = p.addShot(project.directory, {
    description: '原画面',
    actionDialogue: '原对白',
    durationMs: 3000,
  });
  project = p.addShotSource(
    project.directory,
    project.shots[0].id,
    project.ideas[0].id,
  );
  return { ...f, project };
}
function visual(f: ReturnType<typeof aiFixture>) {
  const prepared = ai.prepareAIRequest(f.project.directory, {
    kind: 'visual',
    shotIds: [f.project.shots[0].id],
  });
  return ai.storeAIProposal(
    f.project.directory,
    prepared.project,
    prepared.request,
    {
      suggestions: [
        {
          shotKey: 'shot-1',
          description: '建议画面',
          shotSize: '特写',
          movement: '推',
          reason: '加强情绪',
        },
      ],
    },
  );
}
test('AI input aliases selected text, excludes paths/media/payload and validates returned identities', () => {
  const f = aiFixture(),
    request = ai.prepareAIRequest(f.project.directory, {
      kind: 'visual',
      shotIds: [f.project.shots[0].id],
      ideaIds: [f.project.ideas[0].id],
    });
  const serialized = JSON.stringify(request.text);
  expect(serialized).toContain('原对白');
  expect(serialized).not.toContain(f.project.shots[0].id);
  expect(serialized).not.toContain(f.project.directory);
  expect(serialized).not.toContain('payload');
  expect(() =>
    ai.storeAIProposal(f.project.directory, request.project, request.request, {
      suggestions: [
        {
          shotKey: 'shot-2',
          description: '越权',
          shotSize: '',
          movement: '',
          reason: '',
        },
      ],
    }),
  ).toThrow('范围外');
  expect(ai.listAIProposals(f.project.directory)).toEqual([]);
});
test('AI proposals persist separately; explicit visual adoption is idempotent and preserves dialogue', () => {
  const f = aiFixture(),
    proposal = visual(f);
  expect(p.readProject(f.project.directory).revision).toBe(f.project.revision);
  expect(ai.listAIProposals(f.project.directory)[0].id).toBe(proposal.id);
  const result = ai.applyAIProposal(f.project.directory, proposal.id, {
    mode: 'visual',
    index: 0,
    description: '创作者修订',
  });
  expect(result.shots[0]).toMatchObject({
    description: '创作者修订',
    actionDialogue: '原对白',
    shotSize: '特写',
  });
  expect(() =>
    ai.applyAIProposal(f.project.directory, proposal.id, { mode: 'visual' }),
  ).toThrow('已处理');
});
test('AI adoption rejects stale target content without changing the manual draft', () => {
  const f = aiFixture(),
    proposal = visual(f);
  const edited = p.updateShot(f.project.directory, f.project.shots[0].id, {
    ...f.project.shots[0],
    description: '手工新稿',
  });
  const result = ai.applyAIProposal(f.project.directory, proposal.id, {
    mode: 'visual',
  });
  expect(result.shots[0].description).toBe('手工新稿');
  expect(result.revision).toBe(edited.revision);
  expect(ai.listAIProposals(f.project.directory)[0].status).toBe('stale');
});
test('outline route adoption appends one route only and requires its exact baseline', () => {
  const f = aiFixture(),
    prepared = ai.prepareAIRequest(f.project.directory, {
      kind: 'outline',
      ideaIds: [f.project.ideas[0].id],
    }),
    routes = [1, 2].map((n) => ({
      title: `路线${n}`,
      summary: '摘要',
      shots: Array.from({ length: 3 }, () => ({
        description: `新画面${n}`,
        actionDialogue: '',
        durationMs: 2000,
      })),
    }));
  const proposal = ai.storeAIProposal(
    f.project.directory,
    prepared.project,
    prepared.request,
    { routes },
  );
  const result = ai.applyAIProposal(f.project.directory, proposal.id, {
    mode: 'route',
    index: 1,
  });
  expect(result.shots.map((s) => s.description)).toEqual([
    '原画面',
    '新画面2',
    '新画面2',
    '新画面2',
  ]);
  expect(result.shotSources).toHaveLength(4);
  const stale = ai.storeAIProposal(
    f.project.directory,
    prepared.project,
    prepared.request,
    { routes },
  );
  expect(
    ai.applyAIProposal(f.project.directory, stale.id, {
      mode: 'route',
      index: 0,
    }).shots,
  ).toHaveLength(4);
  expect(
    ai.listAIProposals(f.project.directory).find((p) => p.id === stale.id)
      ?.status,
  ).toBe('stale');
});
test('review annotation preserves original and optional insert keeps canonical script order and sources', () => {
  const f = aiFixture();
  p.saveScriptBlock(f.project.directory, {
    kind: 'body',
    text: '保留未转镜段落',
  });
  const prepared = ai.prepareAIRequest(f.project.directory, {
      kind: 'review',
      shotIds: [f.project.shots[0].id],
    }),
    proposal = ai.storeAIProposal(
      f.project.directory,
      prepared.project,
      prepared.request,
      {
        issues: [
          {
            shotKey: 'shot-1',
            issueType: 'logic',
            explanation: '跳跃',
            suggestedAction: '补过渡',
            insertShot: null,
          },
          {
            shotKey: 'shot-1',
            issueType: 'missing',
            explanation: '缺景',
            suggestedAction: '增加空镜',
            insertShot: {
              description: '地铁空镜',
              actionDialogue: '',
              durationMs: 1000,
            },
          },
        ],
      },
    );
  const marked = ai.applyAIProposal(f.project.directory, proposal.id, {
    mode: 'mark',
    index: 0,
  });
  expect(marked.shots[0]).toMatchObject({
    description: '原画面',
    actionDialogue: '原对白',
    needsReview: true,
  });
  const inserted = ai.applyAIProposal(f.project.directory, proposal.id, {
    mode: 'insert',
    index: 1,
  });
  expect(inserted.shots.map((s) => s.position)).toEqual([0, 1]);
  expect(
    inserted.scriptBlocks.filter((b) => b.shotId).map((b) => b.shotId),
  ).toEqual(inserted.shots.map((s) => s.id));
  expect(
    inserted.shotSources.find((s) => s.shotId === inserted.shots[1].id)
      ?.excerpt,
  ).toBe('雨夜思路');
  expect(new Set(inserted.scriptBlocks.map((b) => b.position)).size).toBe(
    inserted.scriptBlocks.length,
  );
  expect(inserted.scriptBlocks.find((b) => !b.shotId)?.position).toBe(2);
});
test('AI provider enforces schemas, request cancellation and errors without saving formal content', async () => {
  const input = {
    ideas: [],
    shots: [
      {
        key: 'shot-1',
        description: '文',
        actionDialogue: '白',
        durationMs: 1000,
        shotSize: '',
        movement: '',
      },
    ],
  };
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      Response.json({
        output: [{ content: [{ type: 'output_text', text: '{"issues":[]}' }] }],
      }),
    );
  expect(
    await generateSuggestions('review', input, 'mock-model', 'test-key'),
  ).toEqual({ issues: [] });
  const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
  expect(body.text.format.strict).toBe(true);
  expect(JSON.parse(body.input[1].content)).toEqual(input);
  fetch.mockResolvedValueOnce(
    Response.json({
      output: [{ content: [{ type: 'output_text', text: '{"issues":[{}]}' }] }],
    }),
  );
  await expect(
    generateSuggestions('review', input, 'mock', 'key'),
  ).rejects.toThrow('结构');
  fetch.mockResolvedValueOnce(new Response('', { status: 429 }));
  await expect(
    generateSuggestions('review', input, 'mock', 'key'),
  ).rejects.toThrow('429');
  fetch.mockImplementationOnce(async (_url, options) => {
    if (options?.signal?.aborted)
      throw new DOMException('aborted', 'AbortError');
    return new Promise((_resolve, reject) =>
      options?.signal?.addEventListener('abort', () =>
        reject(new DOMException('aborted', 'AbortError')),
      ),
    );
  });
  const controller = new AbortController(),
    pending = generateSuggestions(
      'review',
      input,
      'mock',
      'key',
      controller.signal,
    );
  controller.abort();
  await expect(pending).rejects.toThrow('已取消');
});

test('genuine global v3 migrates selects and range indexes with backup', async () => {
  const f = await selected(),
    db = new DatabaseSync(path.join(f.library, 'library.sqlite'));
  db.exec('BEGIN IMMEDIATE;DROP TABLE selects;');
  for (const column of [
    'shot_number',
    'in_ms',
    'out_ms',
    'source_select_id',
    'indexed_version',
  ])
    db.exec(`ALTER TABLE usage_index DROP COLUMN ${column}`);
  db.exec('PRAGMA user_version=3;COMMIT;');
  db.close();
  expect(l.readLibrary(f.library).assetSelects).toEqual([]);
  expect(l.getLibraryAsset(f.library, f.asset.id).name).toBe('原片.webm');
  expect(readdirSync(f.library).some((n) => n.includes('before-v4'))).toBe(
    true,
  );
  expect(
    l.saveAssetSelect(f.library, {
      assetId: f.asset.id,
      name: '迁移后精选',
      inMs: 0,
      outMs: 1000,
      note: '',
    }),
  ).toHaveLength(1);
});
test('corrupt optional suggestion history cannot blank the workbench or write a shot', () => {
  const f = aiFixture(),
    proposal = visual(f),
    db = p.openDatabase(f.project.directory);
  db.prepare('UPDATE ai_proposals SET payload_json=? WHERE id=?').run(
    JSON.stringify({ ...proposal, suggestions: [{ description: 10 }] }),
    proposal.id,
  );
  db.close();
  expect(ai.listAIProposals(f.project.directory)).toEqual([]);
  expect(() =>
    ai.applyAIProposal(f.project.directory, proposal.id, { mode: 'visual' }),
  ).toThrow('已损坏');
  expect(p.readProject(f.project.directory).revision).toBe(f.project.revision);
});
