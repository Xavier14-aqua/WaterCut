import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as projects from '../project/index';
import * as library from '../library/index';
import type { Asset, LibraryAsset, Project } from '../../shared/models';
import { tagsOf } from '../../shared/schemas';
export function resolveProjectAsset(directory: string, asset: Asset, root: string): string | null {
  if (asset.storageKind === 'local') return asset.relativePath ? projects.localAssetPath(directory, asset.relativePath) : null;
  if (!asset.sourceLibraryId || !asset.sourceAssetId) return null;
  return library.resolveLibraryAsset(root, asset.sourceLibraryId, asset.sourceAssetId, asset.sha256);
}
export function hydrateProject(directory: string, root: string): Project {
  const project = projects.readProject(directory);
  project.availableSelects=[];
  project.assets = project.assets.map(asset => {
    const file = resolveProjectAsset(directory, asset, root);
    let duration = asset.durationMs,
      thumbnail = asset.thumbnail,
      metadata = asset.metadata;
    if (asset.storageKind === 'library' && asset.sourceAssetId) {
      try {
        const source = library.getLibraryAsset(root, asset.sourceAssetId);
        if (source.libraryId === asset.sourceLibraryId) {
          project.availableSelects!.push(...library.listAssetSelects(root,source.id).map(s=>({...s,projectAssetId:asset.id})));
          duration ??= source.durationMs;
          thumbnail = source.thumbnail;
          metadata ??= source.metadata;
        }
      } catch {}
    }
    return {
      ...asset,
      durationMs: duration,
      thumbnail,
      metadata,
      missing: !file || !existsSync(file)
    };
  });
  return project;
}
export function projectEnvelope(directory: string, root: string) {
  const project = hydrateProject(directory, root);
  try {
    library.syncProjectCatalog(root, project);
    projects.markCatalogSynced(directory, project.revision);
  } catch (error) {
    if (error instanceof Error && error.message.includes('相同项目 ID')) throw error; /* Project saves remain usable when the global library is offline; the outbox is retained. */
  }
  return {
    project,
    files: project.assets.map(asset => ({
      id: asset.id,
      file: resolveProjectAsset(directory, asset, root),
      thumbnail: asset.storageKind === 'library' && asset.sourceAssetId ? path.join(root, 'thumbnails', `${asset.sourceAssetId}.png`) : path.join(directory, 'thumbnails', `${asset.id}.png`)
    }))
  };
}
export function attachAssets(directory: string, root: string, ids: string[]): Project {
  return projects.attachLibraryAssets(directory, ids.map(id => library.getLibraryAsset(root, id)));
}
export function bindSelect(directory:string,root:string,shotId:string,selectId:string):Project{const select=library.getAssetSelect(root,selectId),asset=library.getLibraryAsset(root,select.assetId);if(asset.missing)throw new Error('精华片段原件离线，请重新定位');return projects.bindLibrarySelect(directory,shotId,asset,select);}
export function attachIdeas(directory: string, root: string, ids: string[], copy = false): Project {
  const ideas = ids.map(id => library.getLibraryIdea(root, id));
  const assets = [...new Set(ideas.flatMap(i => i.media.map(m => m.assetId)))].map(id => library.getLibraryAsset(root, id));
  const edges = library.readLibrary(root, {
    limit: 1
  }).relations.filter(e => ids.includes(e.source) && ids.includes(e.target));
  return projects.attachLibraryIdeas(directory, ideas, assets, edges, copy);
}
export function refreshIdea(directory: string, root: string, id: string): Project {
  const idea = projects.readProject(directory).ideas.find(i => i.id === id);
  if (!idea?.sourceIdeaId) throw new Error('此卡片没有全局来源');
  const source = library.getLibraryIdea(root, idea.sourceIdeaId);
  return projects.refreshLibraryIdea(directory, id, source, source.media.map(m => library.getLibraryAsset(root, m.assetId)));
}
export async function promoteProject(directory: string, root: string, options: {
  signal?: AbortSignal;
  onProgress?: (copied: number, total: number) => void;
} = {}): Promise<Project> {
  const project = projects.readProject(directory),
    lib = library.libraryId(root),
    key = `promote:${project.id}:${lib}`,
    mapping = library.operationMapping(root, key);
  library.saveOperation(root, key, mapping, 'assets');
  const needed = project.assets.filter(a => !mapping[`asset:${a.id}`]);
  let completed = project.assets.length - needed.length;
  for (const asset of needed) {
    if (options.signal?.aborted) throw new Error('加入全局库已取消，可稍后继续');
    const source = resolveProjectAsset(directory, asset, root);
    if (!source || !existsSync(source)) throw new Error(`素材缺失：${asset.name}，已完成的部分保留，可稍后继续`);
    const imported = await library.importLibraryAsset(root, source, {
      signal: options.signal
    });
    mapping[`asset:${asset.id}`] = imported.id;
    library.updateLibraryAsset(root, imported.id, {
      name: imported.name === path.basename(source) ? asset.name : imported.name,
      tags: [...new Set([...tagsOf(imported.tags), ...tagsOf(asset.tags)])].join(', '),
      starred: imported.starred || asset.starred,
      ...(imported.durationMs == null && asset.durationMs != null ? {
        durationMs: asset.durationMs
      } : {})
    });
    library.saveOperation(root, key, mapping, 'assets');
    options.onProgress?.(++completed, project.assets.length);
  }
  for (const idea of project.ideas) {
    if (options.signal?.aborted) throw new Error('加入全局库已取消，可稍后继续');
    const known = mapping[`idea:${idea.id}`];
    if (known) {
      try {
        library.getLibraryIdea(root, known);
        continue;
      } catch {/* Replay the reserved identity after interruption. */}
    }
    const media = [...idea.media];
    if (idea.sourceAssetId && !media.some(m => m.assetId === idea.sourceAssetId)) {
      const source = project.assets.find(a => a.id === idea.sourceAssetId);
      if (source) media.push({
        assetId: source.id,
        role: source.kind,
        position: media.length,
        inMs: 0,
        outMs: null
      });
    }
    const reserved = known ?? randomUUID();
    mapping[`idea:${idea.id}`] = reserved;
    library.saveOperation(root, key, mapping, 'ideas');
    const result = library.saveLibraryIdea(root, {
      ...idea,
      id: undefined,
      media: media.map(m => ({
        ...m,
        assetId: mapping[`asset:${m.assetId}`]
      }))
    }, reserved);
    mapping[`idea:${idea.id}`] = result.id;
    library.saveOperation(root, key, mapping, 'ideas');
  }
  for (const edge of project.boardEdges) {
    const a = mapping[`idea:${edge.source}`],
      b = mapping[`idea:${edge.target}`];
    if (a && b) library.connectLibraryIdeas(root, a, b, edge.kind, edge.label);
  }
  const result = projects.mutateProject(directory, db => {
    for (const asset of project.assets) {
      const source = library.getLibraryAsset(root, mapping[`asset:${asset.id}`]);
      db.prepare('UPDATE assets SET source_library_id=?,source_asset_id=?,sha256=? WHERE id=?').run(lib, source.id, source.sha256, asset.id);
    }
    for (const idea of project.ideas) {
      const source = library.getLibraryIdea(root, mapping[`idea:${idea.id}`]);
      db.prepare('UPDATE ideas SET source_library_id=?,source_idea_id=?,source_version=? WHERE id=?').run(lib, source.id, source.version, idea.id);
    }
  });
  library.saveOperation(root, key, mapping, 'done');
  library.syncProjectCatalog(root, result);
  return result;
}
export function reconcileCatalog(root: string): void {
  const catalog = library.readLibrary(root, {
    limit: 1
  }).projects;
  for (const item of catalog) {
    if (!item.available) continue;
    try {
      const project = projects.readProject(item.directory);
      if (project.id === item.id) {
        library.syncProjectCatalog(root, project);
        projects.markCatalogSynced(item.directory, project.revision);
      }
    } catch {/* Keep last known index; the project can be repaired/opened explicitly. */}
  }
}
function examplePng(seed: number): Buffer {
  const width = 640,
    height = 360,
    pixels = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const offset = y * (width * 4 + 1);
    for (let x = 0; x < width; x++) {
      const p = offset + 1 + x * 4,
        light = Math.max(0, 1 - Math.hypot(x - width * .65, y - height * .3) / width),
        street = y > height * .7;
      pixels[p] = Math.round((seed === 1 ? 120 : 32) + light * 50 + (street ? 20 : 0));
      pixels[p + 1] = Math.round((seed === 2 ? 90 : 65) + light * 55);
      pixels[p + 2] = Math.round((seed === 1 ? 80 : 95) + light * 40);
      pixels[p + 3] = 255;
    }
  }
  function crc32(bytes: Buffer) {
    let crc = 0xffffffff;
    for (const b of bytes) {
      crc ^= b;
      for (let n = 0; n < 8; n++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function chunk(type: string, content: Buffer) {
    const name = Buffer.from(type),
      length = Buffer.alloc(4),
      crc = Buffer.alloc(4);
    length.writeUInt32BE(content.length);
    crc.writeUInt32BE(crc32(Buffer.concat([name, content])));
    return Buffer.concat([length, name, content, crc]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export async function createExample(projectsRoot: string, root: string): Promise<Project> {
  const previous = library.operationMapping(root, 'example:v1');
  if (previous.directory && existsSync(path.join(previous.directory, 'project.sqlite'))) return projects.readProject(previous.directory);
  const project = projects.createProject(projectsRoot, 'WaterCut 示例 · 雨后散步');
  const cardContents = [{
    kind: 'mood' as const,
    text: '雨停之后的松弛与一点孤独',
    tags: '雨后，松弛，分区:开场',
    notes: '给全片定调',
    payload: {
      colors: ['#497b88', '#e7bd84'],
      rhythm: '先静后动',
      timeOfDay: '黄昏',
      weather: '雨后',
      environment: '街道',
      location: '',
      props: ''
    },
    occurredAt: null
  }, {
    kind: 'scene' as const,
    text: '脚步掠过水洼，霓虹在反光中摇动',
    tags: '雨后，街道，分区:开场',
    notes: '用细节过渡到人物',
    payload: {
      colors: [],
      rhythm: '',
      timeOfDay: '黄昏',
      weather: '雨后',
      environment: '街道',
      location: '路口',
      props: '水洼'
    },
    occurredAt: null
  }, {
    kind: 'scene' as const,
    text: '走进便利店买一杯热饮，故事落回日常',
    tags: '街道，温暖，分区:落幕',
    notes: '结尾留两秒空白',
    payload: {
      colors: [],
      rhythm: '',
      timeOfDay: '夜晚',
      weather: '',
      environment: '便利店',
      location: '',
      props: '纸杯'
    },
    occurredAt: null
  }];
  const ids = cardContents.map(data => library.saveLibraryIdea(root, data).id);
  library.connectLibraryIdeas(root, ids[1], ids[2], 'sequence', '声音先入');
  attachIdeas(project.directory, root, ids);
  const p = projects.readProject(project.directory);
  projects.createShotsFromIdeas(project.directory, p.ideas.map(i => i.id), randomUUID(), [{
    description: '雨后街道远景，行人稀疏',
    actionDialogue: '雨终于停了。',
    durationMs: 3500
  }, {
    description: '脚步掠过水洼，霓虹轻晃',
    actionDialogue: '只想慢慢走一会儿。',
    durationMs: 2500
  }, {
    description: '手推开便利店的玻璃门',
    actionDialogue: '（门铃声）',
    durationMs: 2000
  }, {
    description: '热饮杯口的蒸汽，近景',
    actionDialogue: '一杯热的。',
    durationMs: 3000
  }, {
    description: '背影继续走进夜色，渐静',
    actionDialogue: '明天的事，明天再说。',
    durationMs: 4000
  }]);
  const images: LibraryAsset[] = [];
  mkdirSync(path.join(root, 'jobs'), {
    recursive: true
  });
  for (let index = 0; index < 3; index++) {
    const file = path.join(root, 'jobs', `example-${randomUUID()}.png`);
    try {
      writeFileSync(file, examplePng(index));
      images.push(await library.importLibraryAsset(root, file));
    } finally {
      rmSync(file, {
        force: true
      });
    }
  }
  attachAssets(project.directory, root, images.map(a => a.id));
  const completed = projects.readProject(project.directory);
  for (const index of [0, 1, 3]) projects.linkAsset(project.directory, completed.shots[index].id, completed.assets[index === 3 ? 2 : index].id);
  library.saveOperation(root, 'example:v1', {
    directory: project.directory
  }, 'done');
  return projects.readProject(project.directory);
}
