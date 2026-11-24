import { afterEach, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as yazl from 'yazl';
import * as p from '../../src/modules/project/index';
import * as l from '../../src/modules/library/index';
import { hydrateProject } from '../../src/modules/workspace/index';
import {
  createRevision,
  listRevisions,
  restoreRevision,
  deleteRevision,
} from '../../src/modules/delivery/revisions';
import {
  exportPackage as exportPackageJob,
  importPackage as importPackageJob,
} from '../../src/modules/delivery/project-package';
import {
  openPackageZip,
  readManifest,
  safePackagePath,
  writePackageZip as writePackageZipJob,
  PACKAGE_LIMITS,
} from '../../src/infrastructure/files/package-zip';
import { testFileJobs } from '../support/file-jobs';
import { projectDocument } from '../../src/shared/document';
import { emptyPayload } from '../../src/shared/models';
import { normalizeMediaInfo } from '../../src/shared/media';
import {
  exportRows,
  shotListCSV,
  storyboardHTML,
  textParts,
} from '../../src/shared/print';
const roots: string[] = [];
const jobs = testFileJobs();
const exportPackage = jobs.wrap(exportPackageJob, 4);
const importPackage = jobs.wrap(importPackageJob, 2);
const writePackageZip = jobs.wrap(writePackageZipJob, 3);
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'watercut-delivery-'));
  roots.push(root);
  const projects = path.join(root, '项目'),
    library = path.join(root, '总库'),
    imports = path.join(root, '另一台电脑');
  mkdirSync(imports);
  return {
    root,
    projects,
    library,
    imports,
  };
}
afterEach(async () => {
  await jobs.stop();
  for (const root of roots.splice(0)) {
    if (
      path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith('watercut-delivery-')
    )
      throw new Error('Invalid test cleanup');
    rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});
async function rich() {
  const f = fixture();
  let project = p.createProject(f.projects, '中文项目');
  const file = path.join(f.root, '同名素材.mp4');
  writeFileSync(file, 'synthetic-video-original');
  project = await p.importAsset(project.directory, file);
  const video = project.assets[0];
  writeFileSync(path.join(f.root, '同名素材.png'), 'synthetic-image-original');
  const image = await l.importLibraryAsset(
    f.library,
    path.join(f.root, '同名素材.png'),
  );
  project = p.attachLibraryAssets(project.directory, [image]);
  project = p.addShot(project.directory, {
    description: '开场画面',
    actionDialogue: '原始对白',
    durationMs: 3200,
  });
  project = p.linkAsset(project.directory, project.shots[0].id, video.id);
  project = p.updateTrim(project.directory, project.shots[0].id, 500, 2500);
  project = p.addCandidate(
    project.directory,
    project.shots[0].id,
    project.assets[1].id,
  );
  project = p.createIdea(project.directory, {
    kind: 'scene',
    text: '雨夜',
    notes: '来源备注',
    tags: '雨',
    payload: {
      ...emptyPayload,
    },
    occurredAt: null,
    media: [
      {
        assetId: project.assets[1].id,
        role: 'image',
        position: 0,
        inMs: 0,
        outMs: null,
      },
    ],
  });
  project = p.createIdea(project.directory, {
    kind: 'mood',
    text: '平静',
    notes: '',
    tags: '',
    payload: {
      ...emptyPayload,
      colors: ['#336699'],
    },
    occurredAt: null,
  });
  project = p.connectIdeas(
    project.directory,
    project.ideas[0].id,
    project.ideas[1].id,
    'right',
    'left',
  );
  project = p.createShotsFromIdeas(
    project.directory,
    [project.ideas[0].id],
    crypto.randomUUID(),
  );
  return {
    ...f,
    project,
    video,
  };
}
test('v8 project upgrades with a consistent backup and keeps its identity', () => {
  const f = fixture(),
    project = p.createProject(f.projects, '旧项目'),
    file = path.join(project.directory, 'project.sqlite');
  const db = new DatabaseSync(file);
  db.exec(
    'BEGIN IMMEDIATE;DROP TABLE revision_media_refs;DROP TABLE revisions;DROP TABLE asset_metadata;DROP TABLE project_origin;PRAGMA user_version=8;COMMIT;',
  );
  db.close();
  expect(p.readProject(project.directory).id).toBe(project.id);
  expect(existsSync(file + '.before-v11.bak')).toBe(true);
  const check = new DatabaseSync(file, {
    readOnly: true,
  });
  expect(check.prepare('PRAGMA user_version').get()?.user_version).toBe(11);
  check.close();
});
test('v1 library upgrades without losing assets and backs up before v4', async () => {
  const f = fixture();
  const file = path.join(f.root, 'image.png');
  writeFileSync(file, 'image');
  const asset = await l.importLibraryAsset(f.library, file);
  const db = new DatabaseSync(path.join(f.library, 'library.sqlite'));
  db.exec(
    'BEGIN IMMEDIATE;DROP TABLE asset_metadata;PRAGMA user_version=1;COMMIT;',
  );
  db.close();
  expect(l.getLibraryAsset(f.library, asset.id).id).toBe(asset.id);
  expect(readdirSync(f.library).some((n) => n.includes('.before-v4.'))).toBe(
    true,
  );
});
test('snapshot restores dialogue, order, board, trims, references and creates a pre-restore snapshot', async () => {
  const f = await rich(),
    before = projectDocument(p.readProject(f.project.directory));
  await createRevision(f.project.directory, f.library, 'V1');
  let project = p.updateShot(f.project.directory, f.project.shots[0].id, {
    ...f.project.shots[0],
    description: '修改后的画面',
    actionDialogue: '新对白',
  });
  project = p.moveIdea(project.directory, project.ideas[0].id, 700, 900);
  const changed = project.revision,
    target = listRevisions(project.directory)[0];
  project = await restoreRevision(project.directory, f.library, target.id);
  expect(projectDocument(project)).toEqual(before);
  expect(project.revision).toBeGreaterThan(changed);
  expect(listRevisions(project.directory)).toHaveLength(2);
  expect(listRevisions(project.directory).some((r) => r.automatic)).toBe(true);
});
test('deleting a current asset retains originals needed by old snapshots', async () => {
  const f = await rich();
  await createRevision(f.project.directory, f.library, '保留素材');
  const file = path.join(f.project.directory, f.video.relativePath);
  p.deleteAsset(f.project.directory, f.video.id);
  expect(existsSync(file)).toBe(true);
  const restored = await restoreRevision(
    f.project.directory,
    f.library,
    listRevisions(f.project.directory)[0].id,
  );
  expect(restored.assets.find((a) => a.id === f.video.id)?.missing).toBe(false);
  expect(restored.shotAssets[0].inMs).toBe(500);
});
test('invalid snapshot restoration is atomic and creates no misleading automatic version', async () => {
  const f = await rich();
  await createRevision(f.project.directory, f.library, '错误版本');
  const before = projectDocument(p.readProject(f.project.directory)),
    id = listRevisions(f.project.directory)[0].id,
    db = p.openDatabase(f.project.directory);
  db.prepare('UPDATE revisions SET payload_json=? WHERE id=?').run(
    '{"name":"broken"}',
    id,
  );
  db.close();
  await expect(
    restoreRevision(f.project.directory, f.library, id),
  ).rejects.toThrow();
  expect(projectDocument(p.readProject(f.project.directory))).toEqual(before);
  expect(listRevisions(f.project.directory)).toHaveLength(1);
});
test('snapshot media loss retains the document and exposes a missing original', async () => {
  const f = await rich();
  await createRevision(f.project.directory, f.library, '丢失原件');
  rmSync(path.join(f.project.directory, f.video.relativePath));
  await restoreRevision(
    f.project.directory,
    f.library,
    listRevisions(f.project.directory)[0].id,
  );
  expect(
    hydrateProject(f.project.directory, f.library).assets.find(
      (a) => a.id === f.video.id,
    )?.missing,
  ).toBe(true);
  expect(p.readProject(f.project.directory).shots[0].actionDialogue).toBe(
    '原始对白',
  );
});
test('snapshot records never include the project directory or nested snapshot histories', async () => {
  const f = await rich();
  await createRevision(f.project.directory, f.library, '第一版');
  await createRevision(f.project.directory, f.library, '第二版');
  const db = p.openDatabase(f.project.directory);
  const rows = db.prepare('SELECT payload_json FROM revisions').all() as any[];
  db.close();
  expect(
    rows.every(
      (r) =>
        !r.payload_json.includes(f.root) &&
        !r.payload_json.includes('"revisions"'),
    ),
  ).toBe(true);
  deleteRevision(f.project.directory, listRevisions(f.project.directory)[0].id);
  expect(listRevisions(f.project.directory)).toHaveLength(1);
});
test('project ZIP moves current state and history to an independent project without its library', async () => {
  const f = await rich();
  await createRevision(f.project.directory, f.library, '历史版本');
  const target = path.join(f.root, '项目包.zip');
  const result = await exportPackage(f.project.directory, f.library, target, {
    includeHistory: true,
    includeMedia: true,
  });
  expect(result.complete).toBe(true);
  const imported = await importPackage(target, f.imports),
    again = await importPackage(target, f.imports);
  expect(imported.id).not.toBe(f.project.id);
  expect(again.id).not.toBe(imported.id);
  const hydrated = hydrateProject(
    imported.directory,
    path.join(f.root, '离线总库'),
  );
  expect(
    hydrated.assets.every(
      (a) => a.storageKind === 'local' && !a.sourceLibraryId && !a.missing,
    ),
  ).toBe(true);
  expect(hydrated.ideas[0].media).toHaveLength(1);
  expect(hydrated.shotCandidates).toEqual(f.project.shotCandidates);
  expect(listRevisions(imported.directory)).toHaveLength(1);
  await restoreRevision(
    imported.directory,
    path.join(f.root, '离线总库'),
    listRevisions(imported.directory)[0].id,
  );
  expect(
    hydrateProject(
      imported.directory,
      path.join(f.root, '离线总库'),
    ).assets.every((a) => !a.missing),
  ).toBe(true);
});
test('current-only export excludes history while history export retains deleted media dependencies', async () => {
  const f = await rich();
  await createRevision(f.project.directory, f.library, '有原片');
  p.deleteAsset(f.project.directory, f.video.id);
  const current = await exportPackage(
    f.project.directory,
    f.library,
    path.join(f.root, 'current.zip'),
    {
      includeHistory: false,
      includeMedia: true,
    },
  );
  const history = await exportPackage(
    f.project.directory,
    f.library,
    path.join(f.root, 'history.zip'),
    {
      includeHistory: true,
      includeMedia: true,
    },
  );
  expect(history.fileCount).toBe(current.fileCount + 1);
  const imported = await importPackage(history.file, f.imports);
  const restored = await restoreRevision(
    imported.directory,
    'unavailable',
    listRevisions(imported.directory)[0].id,
  );
  expect(restored.assets.some((a) => a.id === f.video.id && !a.missing)).toBe(
    true,
  );
});
test('incomplete or media-free ZIP is explicitly incomplete and imports placeholders', async () => {
  const f = await rich();
  const result = await exportPackage(
    f.project.directory,
    f.library,
    path.join(f.root, 'no-media.zip'),
    {
      includeHistory: false,
      includeMedia: false,
    },
  );
  expect(result.complete).toBe(false);
  expect(result.missing).toHaveLength(2);
  const project = await importPackage(result.file, f.imports);
  expect(
    hydrateProject(project.directory, 'offline').assets.every((a) => a.missing),
  ).toBe(true);
});
test('export cancellation preserves an existing target and removes only its staging directory', async () => {
  const f = await rich(),
    target = path.join(f.root, 'cancel.zip'),
    controller = new AbortController();
  writeFileSync(target, 'previous-export');
  await expect(
    exportPackage(
      f.project.directory,
      f.library,
      target,
      {
        includeHistory: true,
        includeMedia: true,
      },
      {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      },
    ),
  ).rejects.toThrow();
  expect(readFileSync(target, 'utf8')).toBe('previous-export');
  expect(
    readdirSync(f.root).some((n) => n.startsWith('.watercut-export-')),
  ).toBe(false);
});
test('import cancellation never publishes a half-complete project', async () => {
  const f = await rich(),
    result = await exportPackage(
      f.project.directory,
      f.library,
      path.join(f.root, 'cancel-import.zip'),
      {
        includeHistory: true,
        includeMedia: true,
      },
    ),
    controller = new AbortController();
  await expect(
    importPackage(result.file, f.imports, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }),
  ).rejects.toThrow();
  expect(readdirSync(f.imports)).toEqual([]);
});
async function makeZip(
  file: string,
  entries: Array<{
    name: string;
    data: Buffer;
    mode?: number;
  }>,
) {
  const zip = new yazl.ZipFile(),
    chunks: Buffer[] = [];
  zip.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const ended = new Promise<void>((resolve, reject) => {
    zip.outputStream.once('end', resolve);
    zip.outputStream.once('error', reject);
    zip.once('error', reject);
  });
  for (const e of entries)
    zip.addBuffer(e.data, e.name, {
      mode: e.mode,
    });
  zip.end();
  await ended;
  writeFileSync(file, Buffer.concat(chunks));
}
for (const unsafe of [
  '../escape.txt',
  '/escape.txt',
  'C:/escape.txt',
  'a\\b.txt',
  'assets/CON.txt',
  'assets/a.txt:stream',
  'assets/end.',
  'assets/a/../b',
])
  test(`package rejects Windows path ${JSON.stringify(unsafe)} before writing any destination`, async () => {
    const f = fixture(),
      file = path.join(f.root, 'unsafe.zip'),
      safe = 'x'.repeat(Buffer.byteLength(unsafe));
    await makeZip(file, [
      {
        name: safe,
        data: Buffer.from('test'),
      },
      {
        name: 'manifest.json',
        data: Buffer.from('{}'),
      },
    ]);
    let bytes = readFileSync(file),
      start = 0;
    while ((start = bytes.indexOf(Buffer.from(safe), start)) !== -1) {
      Buffer.from(unsafe).copy(bytes, start);
      start += safe.length;
    }
    writeFileSync(file, bytes);
    await expect(importPackage(file, f.imports)).rejects.toThrow();
    expect(readdirSync(f.imports)).toEqual([]);
  });
test('ZIP rejects case collisions, duplicate entries, symbolic links and excessive totals', async () => {
  const f = fixture();
  for (const entries of [
    [
      {
        name: 'A.bin',
        data: Buffer.from('a'),
      },
      {
        name: 'a.bin',
        data: Buffer.from('b'),
      },
    ],
    [
      {
        name: 'a.bin',
        data: Buffer.from('a'),
      },
      {
        name: 'a.bin',
        data: Buffer.from('b'),
      },
    ],
    [
      {
        name: 'link',
        data: Buffer.from('target'),
        mode: 0o120777,
      },
    ],
  ]) {
    const file = path.join(f.root, 'bad.zip');
    await makeZip(file, entries);
    await expect(importPackage(file, f.imports)).rejects.toThrow();
  }
  const file = path.join(f.root, 'large.zip');
  await makeZip(file, [
    {
      name: 'large',
      data: Buffer.alloc(20),
    },
  ]);
  const original = PACKAGE_LIMITS.totalBytes;
  try {
    PACKAGE_LIMITS.totalBytes = 10;
    await expect(importPackage(file, f.imports)).rejects.toThrow(
      '大小超过限制',
    );
  } finally {
    PACKAGE_LIMITS.totalBytes = original;
  }
  expect(readdirSync(f.imports)).toEqual([]);
});
test('import verifies hashes and never executes the source database write triggers', async () => {
  const f = fixture(),
    project = p.createProject(f.projects, '可信正文'),
    db = p.openDatabase(project.directory);
  db.exec(
    "CREATE TRIGGER untrusted_name AFTER UPDATE OF name ON project BEGIN UPDATE project SET name='恶意触发器'; END;",
  );
  db.close();
  const data = readFileSync(path.join(project.directory, 'project.sqlite')),
    digest = createHash('sha256').update(data).digest('hex');
  const manifest = {
    format: 'WaterCutProject',
    packageVersion: 1,
    projectFormatVersion: p.CURRENT_VERSION,
    projectId: project.id,
    createdAt: new Date().toISOString(),
    includeHistory: false,
    includeMedia: true,
    complete: true,
    missing: [],
    files: [
      {
        path: 'project.sqlite',
        size: data.length,
        sha256: digest,
      },
    ],
  };
  const file = path.join(f.root, 'untrusted.zip');
  await makeZip(file, [
    {
      name: 'manifest.json',
      data: Buffer.from(JSON.stringify(manifest)),
    },
    {
      name: 'project.sqlite',
      data,
    },
  ]);
  const imported = await importPackage(file, f.imports);
  expect(imported.name).toBe('可信正文');
  expect(p.renameProject(imported.directory, '正常新名').name).toBe('正常新名');
  manifest.files[0].sha256 = '0'.repeat(64);
  await makeZip(file, [
    {
      name: 'manifest.json',
      data: Buffer.from(JSON.stringify(manifest)),
    },
    {
      name: 'project.sqlite',
      data,
    },
  ]);
  await expect(importPackage(file, f.imports)).rejects.toThrow('校验失败');
  expect(readdirSync(f.imports)).toHaveLength(1);
});
test('package manifest contains only relative locations and matches the SQLite file size', async () => {
  const f = await rich();
  const result = await exportPackage(
      f.project.directory,
      f.library,
      path.join(f.root, 'privacy.zip'),
      {
        includeHistory: true,
        includeMedia: true,
      },
    ),
    zip = await openPackageZip(result.file);
  try {
    const manifest = await readManifest(
      zip.zip,
      zip.entries.get('manifest.json')!,
    );
    expect(JSON.stringify(manifest)).not.toContain(f.root);
    expect(
      manifest.files.every(
        (file: any) => safePackagePath(file.path) === file.path,
      ),
    ).toBe(true);
    expect(
      manifest.files.find((file: any) => file.path === 'project.sqlite').size,
    ).toBe(zip.entries.get('project.sqlite')!.uncompressedSize);
  } finally {
    zip.zip.close();
  }
});
test('offline metadata preserves VFR, rational rates, explicit timebase and unknown values', () => {
  const metadata = normalizeMediaInfo({
    media: {
      track: [
        {
          '@type': 'General',
          Duration: 2.5,
          Format: 'WebM',
        },
        {
          '@type': 'Video',
          Width: 1920,
          Height: 1080,
          Format: 'VP9',
          FrameRate_Num: 30000,
          FrameRate_Den: 1001,
          FrameRate_Mode: 'VFR',
          TimeBase: '1/1000',
        },
        {
          '@type': 'Audio',
          Format: 'Opus',
          SamplingRate: 48000,
          Channels: 2,
        },
      ],
    },
  });
  expect(metadata.durationMs).toBe(2500);
  expect(metadata.streams[0].frameRate).toEqual({
    numerator: 30000,
    denominator: 1001,
  });
  expect(metadata.streams[0].timeBase).toEqual({
    numerator: 1,
    denominator: 1000,
  });
  expect(metadata.streams[0].variableFrameRate).toBe(true);
  const unknown = normalizeMediaInfo({
    media: {
      track: [],
    },
  });
  expect(unknown.status).toBe('failed');
  expect(unknown.durationMs).toBeNull();
});
test('asset list, details and project references retain the same offline metadata', async () => {
  const f = await rich(),
    asset = l.readLibrary(f.library).assets[0],
    metadata = normalizeMediaInfo({
      media: {
        track: [
          {
            '@type': 'General',
            Format: 'PNG',
          },
          {
            '@type': 'Image',
            Width: 640,
            Height: 360,
            Format: 'PNG',
          },
        ],
      },
    }),
    db = l.openLibrary(f.library);
  db.prepare('INSERT INTO asset_metadata VALUES (?,?)').run(
    asset.id,
    JSON.stringify(metadata),
  );
  db.close();
  expect(l.readLibrary(f.library).assets[0].metadata).toEqual(
    l.getLibraryAsset(f.library, asset.id).metadata,
  );
  const project = p.createProject(f.projects, '元数据引用');
  expect(
    p.attachLibraryAssets(project.directory, [
      l.getLibraryAsset(f.library, asset.id),
    ]).assets[0].metadata,
  ).toEqual(metadata);
});
test('interrupted deletion restores a hashed package original with slash-separated paths', async () => {
  const f = await rich(),
    pack = await exportPackage(
      f.project.directory,
      f.library,
      path.join(f.root, 'recovery.zip'),
      {
        includeHistory: false,
        includeMedia: true,
      },
    ),
    project = await importPackage(pack.file, f.imports),
    asset = project.assets[0],
    file = path.join(project.directory, asset.relativePath);
  renameSync(file, file + '.delete-pending');
  p.cleanupPartialAssets(project.directory);
  expect(existsSync(file)).toBe(true);
  expect(p.readProject(project.directory).assets[0].missing).toBe(false);
});
test('cancelling while ZIP compression is reading closes source handles', async () => {
  const f = fixture(),
    file = path.join(f.root, 'large.bin'),
    target = path.join(f.root, 'incomplete.zip'),
    controller = new AbortController();
  writeFileSync(file, Buffer.alloc(16 * 1024 * 1024, 65));
  const task = writePackageZip(
    [
      {
        path: 'large.bin',
        file,
      },
    ],
    Buffer.from('{}'),
    target,
    {
      signal: controller.signal,
    },
  );
  setTimeout(() => controller.abort(), 5);
  await expect(task).rejects.toThrow();
  expect(() => renameSync(file, file + '.moved')).not.toThrow();
});
test('deduplicated package originals retain historical asset tags independently', async () => {
  const f = await rich();
  await createRevision(f.project.directory, f.library, '原标签');
  p.updateAssetTags(f.project.directory, f.video.id, '当前标签');
  const result = await exportPackage(
    f.project.directory,
    f.library,
    path.join(f.root, 'tags.zip'),
    { includeHistory: true, includeMedia: true },
  );
  const project = await importPackage(result.file, f.imports);
  expect(project.assets.find((a) => a.id === f.video.id)?.tags).toBe(
    '当前标签',
  );
  const restored = await restoreRevision(
    project.directory,
    'offline',
    listRevisions(project.directory)[0].id,
  );
  expect(restored.assets.find((a) => a.id === f.video.id)?.tags).toBe('');
});
test('PDF escapes user HTML, splits long prose without losing characters and reuses shot list rows', async () => {
  const f = await rich(),
    text = '长对白\n'.repeat(300) + '结束标记-END';
  expect(textParts(text).join('')).toBe(text);
  const project = p.readProject(f.project.directory);
  project.name = '<script>unexpected()</script>';
  project.shots[0].actionDialogue = text;
  const html = storyboardHTML(
    project,
    {
      landscape: false,
      checklist: false,
    },
    {},
  );
  expect(html).not.toContain('<script>unexpected()');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('结束标记-END');
  expect(html).toContain('script-src &#39;none&#39;'.replaceAll('&#39;', "'"));
  expect(exportRows(project, true).map((r) => r.id)).toEqual(
    project.shots
      .filter(
        (s) =>
          s.status === 'to_shoot' ||
          !project.shotAssets.some((b) => b.shotId === s.id),
      )
      .map((s) => s.id),
  );
  expect(shotListCSV(project)).toContain('缺口原因');
});
