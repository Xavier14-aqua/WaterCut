import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as p from '../../src/modules/project/index';
import * as l from '../../src/modules/library/index';
import { colorFamily, hexToHSL, hslToHex, paletteMatches } from '../../src/shared/colors';
import { scriptSections, moveScriptItems } from '../../src/shared/script';
import { emptyPayload } from '../../src/shared/models';
import { createRevision, restoreRevision, listRevisions } from '../../src/modules/delivery/revisions';
import { projectDocument } from '../../src/shared/document';
const folders: string[] = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-patch131-'));
  folders.push(root);
  return {
    root,
    library: path.join(root, 'library'),
    project: p.createProject(path.join(root, 'projects'), '修复测试')
  };
}
afterEach(() => {
  for (const folder of folders.splice(0)) {
    if (path.dirname(folder) !== path.resolve(tmpdir()) || !path.basename(folder).startsWith('watercut-patch131-')) throw Error('Unsafe cleanup');
    rmSync(folder, {
      recursive: true,
      force: true
    });
  }
});
test('neighboring hues share a family and black, white, brown remain distinct', () => {
  expect(colorFamily('#ee3344')).toBe('red');
  expect(colorFamily('#991122')).toBe('red');
  expect(colorFamily('#663311')).toBe('brown');
  for (const c of ['#000000', '#ffffff', '#909090']) expect(colorFamily(c)).toBe('neutral');
  expect(paletteMatches(['#ee3344', '#4488ee'], 'blue')).toBe(true);
  expect(paletteMatches(['#ee3344'], 'green')).toBe(false);
  expect(colorFamily('not-a-color')).toBeNull();
});
test('HSL picker values round trip through valid RGB colors', () => {
  for (const color of ['#ffffff', '#000000', '#cc2244', '#2ca087', '#3388ee']) {
    const hsl = hexToHSL(color)!;
    expect(hslToHex(hsl.h, hsl.s, hsl.l)).toBe(color);
  }
  expect(hslToHex(360, 100, 50)).toBe('#ff0000');
  expect(hslToHex(-120, 100, 50)).toBe('#0000ff');
});
test('color filtering applies before totals and pagination, also with type and text filters', () => {
  const f = fixture();
  for (let i = 0; i < 7; i++) l.saveLibraryIdea(f.library, {
    kind: 'mood',
    text: `红色情绪 ${i}`,
    tags: '暖色',
    notes: '',
    payload: {
      ...emptyPayload,
      colors: [i % 2 ? '#dd3344' : '#991122']
    },
    occurredAt: null
  });
  l.saveLibraryIdea(f.library, {
    kind: 'mood',
    text: '蓝色情绪',
    tags: '',
    notes: '',
    payload: {
      ...emptyPayload,
      colors: ['#3388ee']
    },
    occurredAt: null
  });
  const first = l.readLibrary(f.library, {
      color: 'red',
      kind: 'mood',
      limit: 3
    }),
    second = l.readLibrary(f.library, {
      color: 'red',
      offset: 3,
      limit: 3
    });
  expect(first.totalIdeas).toBe(7);
  expect(first.ideas).toHaveLength(3);
  expect(second.ideas).toHaveLength(3);
  expect(second.ideas.every(i => !first.ideas.some(f => f.id === i.id))).toBe(true);
  expect(l.readLibrary(f.library, {
    color: 'blue',
    search: '蓝色'
  }).totalIdeas).toBe(1);
  expect(() => l.readLibrary(f.library, {
    color: 'invalid' as any
  })).toThrow();
});
test('a new script title owns an initial draft and multiple paragraphs stay in that section', () => {
  const f = fixture();
  let project = p.createScriptSection(f.project.directory, {
    title: '第一节'
  });
  expect(project.scriptBlocks.map(b => b.kind)).toEqual(['heading', 'body']);
  const first = project.scriptBlocks[0].id;
  project = p.createScriptSection(project.directory, {
    title: '第二节'
  });
  project = p.addScriptParagraph(project.directory, first);
  const sections = scriptSections(project.scriptBlocks);
  expect(sections.map(s => s.heading?.text)).toEqual(['第一节', '第二节']);
  expect(sections[0].blocks).toHaveLength(2);
  expect(sections[1].blocks).toHaveLength(1);
});
test('giving legacy paragraphs a heading keeps the original IDs and text', () => {
  const f = fixture();
  let project = p.saveScriptBlock(f.project.directory, {
      kind: 'body',
      text: '旧稿'
    }),
    id = project.scriptBlocks[0].id;
  project = p.createScriptSection(project.directory, {
    title: '旧稿分组',
    beforeId: id
  });
  expect(project.scriptBlocks[1].id).toBe(id);
  expect(project.scriptBlocks[1].text).toBe('旧稿');
  expect(scriptSections(project.scriptBlocks)[0].blocks[0].id).toBe(id);
});
test('paragraph and section order persist and linked shots follow the same sequence', () => {
  const f = fixture();
  let project = p.createScriptSection(f.project.directory, {
      title: '第一组'
    }),
    first = project.scriptBlocks[0].id,
    a = project.scriptBlocks[1];
  project = p.saveScriptBlock(project.directory, {
    ...a,
    text: '第一段'
  });
  project = p.addScriptParagraph(project.directory, first);
  const b = project.scriptBlocks[2];
  project = p.saveScriptBlock(project.directory, {
    ...b,
    text: '第二段'
  });
  project = p.convertScriptBlocks(project.directory, [a.id, b.id], crypto.randomUUID());
  project = p.reorderScriptBlocks(project.directory, moveScriptItems(project.scriptBlocks, [b.id], a.id));
  expect(project.shots.map(s => s.actionDialogue)).toEqual(['第二段', '第一段']);
  project = p.createScriptSection(project.directory, {
    title: '第二组'
  });
  const sections = scriptSections(project.scriptBlocks),
    moving = [sections[1].id, ...sections[1].blocks.map(b => b.id)];
  project = p.reorderScriptBlocks(project.directory, moveScriptItems(project.scriptBlocks, moving, first));
  expect(scriptSections(p.readProject(project.directory).scriptBlocks)[0].heading?.text).toBe('第二组');
  const before = projectDocument(project);
  expect(() => p.reorderScriptBlocks(project.directory, [a.id, a.id])).toThrow();
  expect(projectDocument(p.readProject(project.directory))).toEqual(before);
});
test('manual shot sources are idempotent, scoped, removable, and keep deleted-card excerpts', () => {
  const f = fixture();
  let project = p.addShot(f.project.directory, {
    description: '画面',
    durationMs: 1000
  });
  project = p.addShot(project.directory, {
    description: '其他镜头',
    durationMs: 1000
  });
  project = p.addIdea(project.directory, '手动来源');
  const shot = project.shots[0].id,
    idea = project.ideas[0].id;
  project = p.addShotSource(project.directory, shot, idea);
  project = p.addShotSource(project.directory, shot, idea);
  expect(project.shotSources).toHaveLength(1);
  const source = project.shotSources[0];
  expect(source.id).toBeTruthy();
  expect(() => p.removeShotSource(project.directory, project.shots[1].id, source.id!)).toThrow();
  project = p.deleteIdea(project.directory, idea);
  expect(project.shotSources[0].ideaId).toBeNull();
  expect(project.shotSources[0].excerpt).toBe('手动来源');
  project = p.removeShotSource(project.directory, shot, source.id!);
  expect(project.shotSources).toHaveLength(0);
});
test('primary selection adds a candidate, changing clears trims, clearing keeps candidates', async () => {
  const f = fixture(),
    file = path.join(f.root, 'clip.mp4');
  writeFileSync(file, 'synthetic-video');
  let project = await p.importAsset(f.project.directory, file);
  writeFileSync(path.join(f.root, 'image.png'), 'synthetic-image');
  project = await p.importAsset(project.directory, path.join(f.root, 'image.png'));
  project = p.addShot(project.directory, {
    description: '主画面',
    durationMs: 2000
  });
  const shot = project.shots[0].id;
  project = p.linkAsset(project.directory, shot, project.assets[0].id);
  project = p.updateTrim(project.directory, shot, 500, 1500);
  project = p.linkAsset(project.directory, shot, project.assets[1].id);
  expect(project.shotAssets[0].inMs).toBe(0);
  expect(project.shotAssets[0].outMs).toBeNull();
  project = p.clearShotPrimary(project.directory, shot);
  expect(project.shotAssets).toHaveLength(0);
  expect(project.shotCandidates).toHaveLength(2);
});
test('headings, draft ordering and manual sources survive a snapshot restoration', async () => {
  const f = fixture();
  let project = p.createScriptSection(f.project.directory, {
    title: '可恢复标题'
  });
  project = p.addShot(project.directory, {
    description: '画面',
    durationMs: 1000
  });
  project = p.addIdea(project.directory, '来源');
  project = p.addShotSource(project.directory, project.shots[0].id, project.ideas[0].id);
  const before = projectDocument(project);
  await createRevision(project.directory, f.library, '保存');
  p.deleteScriptBlock(project.directory, project.scriptBlocks[0].id);
  project = await restoreRevision(project.directory, f.library, listRevisions(project.directory)[0].id);
  expect(projectDocument(project)).toEqual(before);
});
