import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as p from '../../src/modules/project/index';
import * as l from '../../src/modules/library/index';
import { createRevision, restoreRevision, listRevisions } from '../../src/modules/delivery/revisions';
import { exportPackage as exportPackageJob, importPackage as importPackageJob } from '../../src/modules/delivery/project-package';
import { writePackageZip as writePackageZipJob } from '../../src/infrastructure/files/package-zip';
import { testFileJobs } from '../support/file-jobs';
import { validateDocument, projectDocument } from '../../src/shared/document';
import { emptyPayload, type IdeaInput } from '../../src/shared/models';
const folders: string[] = [];
const jobs = testFileJobs();
const exportPackage = jobs.wrap(exportPackageJob, 4);
const importPackage = jobs.wrap(importPackageJob, 2);
const writePackageZip = jobs.wrap(writePackageZipJob, 3);
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-boxes-'));
  folders.push(root);
  const imports = path.join(root, 'imports');
  mkdirSync(imports);
  return {
    root,
    imports,
    library: path.join(root, 'library'),
    project: p.createProject(path.join(root, 'projects'), '收纳测试')
  };
}
function idea(text: string, kind: IdeaInput['kind'] = 'note'): IdeaInput {
  return {
    kind,
    text,
    tags: '测试',
    notes: '',
    occurredAt: null,
    payload: {
      ...emptyPayload,
      colors: kind === 'mood' ? ['#3388ee'] : []
    },
    media: []
  };
}
function stripBoxes(file: string, version: number) {
  const db = new DatabaseSync(file);
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'change_idea_box_%'").all() as {
      name: string;
    }[]) db.exec(`DROP TRIGGER ${row.name}`);
    db.exec(`DROP TABLE idea_box_items;DROP TABLE idea_boxes;PRAGMA user_version=${version};COMMIT;`);
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}
afterEach(async () => {
  await jobs.stop();
  for (const folder of folders.splice(0)) {
    if (path.dirname(folder) !== path.resolve(tmpdir()) || !path.basename(folder).startsWith('watercut-boxes-')) throw Error('Unsafe cleanup');
    rmSync(folder, {
      recursive: true,
      force: true
    });
  }
});
test('a v9 project upgrades before writing boxes and the backup retains its old schema', () => {
  const f = fixture();
  let project = p.createIdea(f.project.directory, idea('原有卡片'));
  const file = path.join(project.directory, 'project.sqlite');
  stripBoxes(file, 9);
  project = p.saveIdeaBox(project.directory, {
    name: '开场'
  });
  expect(project.ideas[0].text).toBe('原有卡片');
  expect(project.ideas[0].boxId).toBeNull();
  expect(project.ideaBoxes[0].name).toBe('开场');
  const backup = new DatabaseSync(file + '.before-v11.bak', {
    readOnly: true
  });
  try {
    expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(9);
    expect(backup.prepare("SELECT 1 FROM sqlite_master WHERE name='idea_boxes'").get()).toBeUndefined();
  } finally {
    backup.close();
  }
});
test('a v2 global library upgrades with a backup and keeps card contents', () => {
  const f = fixture(),
    card = l.saveLibraryIdea(f.library, idea('旧库卡片')),
    file = path.join(f.library, 'library.sqlite');
  stripBoxes(file, 2);
  l.saveLibraryIdeaBox(f.library, {
    name: '灵感合集'
  });
  expect(l.getLibraryIdea(f.library, card.id).text).toBe('旧库卡片');
  expect(readdirSync(f.library).some(n => n.startsWith('library.sqlite.before-v4.'))).toBe(true);
  expect(l.readLibrary(f.library).ideaBoxes[0].name).toBe('灵感合集');
});
test('all card kinds can be boxed together, moved, unfiled and reopened without changing their contents', () => {
  const f = fixture();
  let project = f.project;
  for (const kind of ['note', 'mood', 'scene'] as const) project = p.createIdea(project.directory, idea(kind, kind));
  project = p.saveIdeaBox(project.directory, {
    name: '第一盒'
  });
  project = p.saveIdeaBox(project.directory, {
    name: '第二盒'
  });
  const [first, second] = project.ideaBoxes,
    ids = project.ideas.map(i => i.id),
    before = project.ideas.map(({
      boxId,
      ...rest
    }) => rest),
    revision = project.revision;
  project = p.moveIdeasToBox(project.directory, ids, first.id);
  expect(project.revision).toBeGreaterThan(revision);
  expect(project.ideas.every(i => i.boxId === first.id)).toBe(true);
  project = p.moveIdeasToBox(project.directory, [ids[0]], second.id);
  project = p.moveIdeasToBox(project.directory, [ids[1]], null);
  project = p.readProject(project.directory);
  expect(project.ideas.map(i => i.boxId)).toEqual([second.id, null, first.id]);
  expect(project.ideas.map(({
    boxId,
    ...rest
  }) => rest)).toEqual(before);
});
test('rename and box removal retain every card and release their memberships', () => {
  const f = fixture();
  let project = p.createIdea(f.project.directory, idea('不能删除的卡片'));
  project = p.saveIdeaBox(project.directory, {
    name: '旧名称'
  });
  const box = project.ideaBoxes[0].id;
  project = p.moveIdeasToBox(project.directory, [project.ideas[0].id], box);
  project = p.saveIdeaBox(project.directory, {
    id: box,
    name: '新名称'
  });
  expect(project.ideaBoxes[0].name).toBe('新名称');
  project = p.deleteIdeaBox(project.directory, box);
  expect(project.ideaBoxes).toEqual([]);
  expect(project.ideas[0].boxId).toBeNull();
  expect(project.ideas[0].text).toBe('不能删除的卡片');
});
test('duplicate names, foreign card IDs and foreign boxes fail atomically', () => {
  const f = fixture();
  let project = p.createIdea(f.project.directory, idea('本项目'));
  project = p.saveIdeaBox(project.directory, {
    name: '片头Ａ'
  });
  const box = project.ideaBoxes[0].id,
    card = project.ideas[0].id,
    before = projectDocument(project);
  expect(() => p.saveIdeaBox(project.directory, {
    name: '片头a'
  })).toThrow('同名');
  expect(() => p.saveIdeaBox(project.directory, {
    name: '  '
  })).toThrow();
  expect(() => p.moveIdeasToBox(project.directory, [card, randomUUID()], box)).toThrow('不属于');
  expect(() => p.moveIdeasToBox(project.directory, [card], randomUUID())).toThrow('不存在');
  expect(projectDocument(p.readProject(project.directory))).toEqual(before);
});
test('global box filtering, search and hue counts apply before pagination', () => {
  const f = fixture();
  l.saveLibraryIdeaBox(f.library, {
    name: '蓝色碎片'
  });
  const box = l.readLibrary(f.library).ideaBoxes[0].id,
    ids = [];
  for (let i = 0; i < 7; i++) ids.push(l.saveLibraryIdea(f.library, idea('蓝色情绪 ' + i, 'mood')).id);
  l.saveLibraryIdea(f.library, idea('未收纳卡片'));
  l.moveLibraryIdeasToBox(f.library, ids, box);
  const first = l.readLibrary(f.library, {
      boxId: box,
      color: 'blue',
      search: '情绪',
      limit: 3
    }),
    second = l.readLibrary(f.library, {
      boxId: box,
      color: 'blue',
      offset: 3,
      limit: 3
    });
  expect(first.totalIdeas).toBe(7);
  expect(first.ideaBoxCounts[box]).toBe(7);
  expect(first.ideas).toHaveLength(3);
  expect(second.ideas).toHaveLength(3);
  expect(second.ideas.every(i => !first.ideas.some(f => f.id === i.id))).toBe(true);
  expect(l.readLibrary(f.library, {
    boxId: null
  }).ideas.map(i => i.text)).toEqual(['未收纳卡片']);
  expect(l.readLibrary(f.library).totalIdeas).toBe(8);
  expect(l.readLibrary(f.library, {
    color: 'red'
  }).ideaBoxCounts).toEqual({});
});
test('global hidden cards keep memberships; deleting a box unfiles hidden and visible cards', () => {
  const f = fixture();
  l.saveLibraryIdeaBox(f.library, {
    name: '存档'
  });
  const box = l.readLibrary(f.library).ideaBoxes[0].id,
    card = l.saveLibraryIdea(f.library, idea('隐藏卡片'));
  l.moveLibraryIdeasToBox(f.library, [card.id], box);
  l.setLibraryHidden(f.library, 'idea', card.id, true);
  expect(l.readLibrary(f.library, {
    boxId: box
  }).totalIdeas).toBe(0);
  expect(l.readLibrary(f.library, {
    boxId: box,
    hidden: true
  }).ideaBoxCounts[box]).toBe(1);
  l.deleteLibraryIdeaBox(f.library, box);
  expect(l.getLibraryIdea(f.library, card.id).boxId).toBeNull();
});
test('project and global membership are independent even when a card is a reference', () => {
  const f = fixture(),
    card = l.saveLibraryIdea(f.library, idea('全局原卡'));
  l.saveLibraryIdeaBox(f.library, {
    name: '全局盒'
  });
  const globalBox = l.readLibrary(f.library).ideaBoxes[0].id;
  l.moveLibraryIdeasToBox(f.library, [card.id], globalBox);
  const instance = p.attachLibraryIdeas(f.project.directory, [l.getLibraryIdea(f.library, card.id)], [], []);
  expect(instance.ideas[0].boxId).toBeNull();
  const project = p.saveIdeaBox(instance.directory, {
    name: '项目盒'
  });
  p.moveIdeasToBox(project.directory, [project.ideas[0].id], project.ideaBoxes[0].id);
  expect(l.getLibraryIdea(f.library, card.id).boxId).toBe(globalBox);
});
test('snapshot restoration and independent packages preserve boxes and memberships', async () => {
  const f = fixture();
  let project = p.createIdea(f.project.directory, idea('随项目迁移'));
  project = p.saveIdeaBox(project.directory, {
    name: '保留此盒'
  });
  project = p.moveIdeasToBox(project.directory, [project.ideas[0].id], project.ideaBoxes[0].id);
  const before = projectDocument(project);
  await createRevision(project.directory, f.library, '含收纳盒');
  p.deleteIdeaBox(project.directory, project.ideaBoxes[0].id);
  project = await restoreRevision(project.directory, f.library, listRevisions(project.directory)[0].id);
  expect(projectDocument(project)).toEqual(before);
  const file = path.join(f.root, 'boxed.zip');
  await exportPackage(project.directory, f.library, file, {
    includeHistory: true,
    includeMedia: true
  });
  const imported = await importPackage(file, f.imports);
  expect(imported.id).not.toBe(project.id);
  expect(projectDocument(imported)).toEqual(before);
});
test('legacy documents default to unfiled while dangling or duplicate box references are rejected', () => {
  const f = fixture(),
    project = p.createIdea(f.project.directory, idea('旧快照'));
  const legacy: any = projectDocument(project);
  delete legacy.ideaBoxes;
  delete legacy.ideas[0].boxId;
  const restored = validateDocument(legacy);
  expect(restored.ideaBoxes).toEqual([]);
  expect(restored.ideas[0].boxId).toBeNull();
  expect(() => validateDocument({
    ...restored,
    ideas: restored.ideas.map(i => ({
      ...i,
      boxId: randomUUID()
    }))
  })).toThrow('引用');
  const box = {
    id: randomUUID(),
    name: '重复',
    position: 0
  };
  expect(() => validateDocument({
    ...restored,
    ideaBoxes: [box, box]
  })).toThrow('重复');
});
test('v9 portable project packages remain importable without executing a database migration on the source', async () => {
  const f = fixture(),
    project = p.createIdea(f.project.directory, idea('旧版项目包')),
    file = path.join(project.directory, 'project.sqlite');
  stripBoxes(file, 9);
  const data = readFileSync(file),
    sha256 = createHash('sha256').update(data).digest('hex');
  const archive = path.join(f.root, 'legacy.zip'),
    manifest = {
      format: 'WaterCutProject',
      packageVersion: 1,
      projectFormatVersion: 9,
      projectId: project.id,
      createdAt: new Date().toISOString(),
      includeHistory: false,
      includeMedia: true,
      complete: true,
      missing: [],
      files: [{
        path: 'project.sqlite',
        size: data.length,
        sha256
      }]
    };
  await writePackageZip([{
    path: 'project.sqlite',
    file
  }], Buffer.from(JSON.stringify(manifest)), archive);
  const imported = await importPackage(archive, f.imports);
  expect(imported.ideas[0].text).toBe('旧版项目包');
  expect(imported.ideaBoxes).toEqual([]);
  expect(existsSync(file + '.before-v11.bak')).toBe(false);
});
