import { existsSync } from 'node:fs';

import path from 'node:path';

import { randomUUID } from 'node:crypto';

import * as projects from '../project/index';

import * as library from '../library/index';

import type { Project } from '../../shared/models';

import { tagsOf } from '../../shared/schemas';

import { hydrateProject, resolveProjectAsset } from './assets';

export function projectEnvelope(directory: string, root: string) {
  const project = hydrateProject(directory, root);
  try {
    library.syncProjectCatalog(root, project);
    projects.markCatalogSynced(directory, project.revision);
  } catch (error) {
    if (error instanceof Error && error.message.includes('相同项目 ID'))
      throw error; /* Project saves remain usable when the global library is offline; the outbox is retained. */
  }
  return {
    project,
    files: project.assets.map((asset) => ({
      id: asset.id,
      file: resolveProjectAsset(directory, asset, root),
      thumbnail:
        asset.storageKind === 'library' && asset.sourceAssetId
          ? path.join(root, 'thumbnails', `${asset.sourceAssetId}.png`)
          : path.join(directory, 'thumbnails', `${asset.id}.png`),
    })),
  };
}

export function attachAssets(
  directory: string,
  root: string,
  ids: string[],
): Project {
  return projects.attachLibraryAssets(
    directory,
    ids.map((id) => library.getLibraryAsset(root, id)),
  );
}

export function bindSelect(
  directory: string,
  root: string,
  shotId: string,
  selectId: string,
): Project {
  const select = library.getAssetSelect(root, selectId),
    asset = library.getLibraryAsset(root, select.assetId);
  if (asset.missing) throw new Error('精华片段原件离线，请重新定位');
  return projects.bindLibrarySelect(directory, shotId, asset, select);
}

export function attachIdeas(
  directory: string,
  root: string,
  ids: string[],
  copy = false,
): Project {
  const ideas = ids.map((id) => library.getLibraryIdea(root, id));
  const assets = [
    ...new Set(ideas.flatMap((i) => i.media.map((m) => m.assetId))),
  ].map((id) => library.getLibraryAsset(root, id));
  const edges = library
    .readLibrary(root, {
      limit: 1,
    })
    .relations.filter((e) => ids.includes(e.source) && ids.includes(e.target));
  return projects.attachLibraryIdeas(directory, ideas, assets, edges, copy);
}

export function refreshIdea(
  directory: string,
  root: string,
  id: string,
): Project {
  const idea = projects.readProject(directory).ideas.find((i) => i.id === id);
  if (!idea?.sourceIdeaId) throw new Error('此卡片没有全局来源');
  const source = library.getLibraryIdea(root, idea.sourceIdeaId);
  return projects.refreshLibraryIdea(
    directory,
    id,
    source,
    source.media.map((m) => library.getLibraryAsset(root, m.assetId)),
  );
}

export async function promoteProject(
  directory: string,
  root: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (copied: number, total: number) => void;
  } = {},
): Promise<Project> {
  const project = projects.readProject(directory),
    lib = library.libraryId(root),
    key = `promote:${project.id}:${lib}`,
    mapping = library.operationMapping(root, key);
  library.saveOperation(root, key, mapping, 'assets');
  const needed = project.assets.filter((a) => !mapping[`asset:${a.id}`]);
  let completed = project.assets.length - needed.length;
  for (const asset of needed) {
    if (options.signal?.aborted)
      throw new Error('加入全局库已取消，可稍后继续');
    const source = resolveProjectAsset(directory, asset, root);
    if (!source || !existsSync(source))
      throw new Error(`素材缺失：${asset.name}，已完成的部分保留，可稍后继续`);
    const imported = await library.importLibraryAsset(root, source, {
      signal: options.signal,
    });
    mapping[`asset:${asset.id}`] = imported.id;
    library.updateLibraryAsset(root, imported.id, {
      name:
        imported.name === path.basename(source) ? asset.name : imported.name,
      tags: [
        ...new Set([...tagsOf(imported.tags), ...tagsOf(asset.tags)]),
      ].join(', '),
      starred: imported.starred || asset.starred,
      ...(imported.durationMs == null && asset.durationMs != null
        ? {
            durationMs: asset.durationMs,
          }
        : {}),
    });
    library.saveOperation(root, key, mapping, 'assets');
    options.onProgress?.(++completed, project.assets.length);
  }
  for (const idea of project.ideas) {
    if (options.signal?.aborted)
      throw new Error('加入全局库已取消，可稍后继续');
    const known = mapping[`idea:${idea.id}`];
    if (known) {
      try {
        library.getLibraryIdea(root, known);
        continue;
      } catch {
        /* Replay the reserved identity after interruption. */
      }
    }
    const media = [...idea.media];
    if (
      idea.sourceAssetId &&
      !media.some((m) => m.assetId === idea.sourceAssetId)
    ) {
      const source = project.assets.find((a) => a.id === idea.sourceAssetId);
      if (source)
        media.push({
          assetId: source.id,
          role: source.kind,
          position: media.length,
          inMs: 0,
          outMs: null,
        });
    }
    const reserved = known ?? randomUUID();
    mapping[`idea:${idea.id}`] = reserved;
    library.saveOperation(root, key, mapping, 'ideas');
    const result = library.saveLibraryIdea(
      root,
      {
        ...idea,
        id: undefined,
        media: media.map((m) => ({
          ...m,
          assetId: mapping[`asset:${m.assetId}`],
        })),
      },
      reserved,
    );
    mapping[`idea:${idea.id}`] = result.id;
    library.saveOperation(root, key, mapping, 'ideas');
  }
  for (const edge of project.boardEdges) {
    const a = mapping[`idea:${edge.source}`],
      b = mapping[`idea:${edge.target}`];
    if (a && b) library.connectLibraryIdeas(root, a, b, edge.kind, edge.label);
  }
  const result = projects.mutateProject(directory, (db) => {
    for (const asset of project.assets) {
      const source = library.getLibraryAsset(
        root,
        mapping[`asset:${asset.id}`],
      );
      db.prepare(
        'UPDATE assets SET source_library_id=?,source_asset_id=?,sha256=? WHERE id=?',
      ).run(lib, source.id, source.sha256, asset.id);
    }
    for (const idea of project.ideas) {
      const source = library.getLibraryIdea(root, mapping[`idea:${idea.id}`]);
      db.prepare(
        'UPDATE ideas SET source_library_id=?,source_idea_id=?,source_version=? WHERE id=?',
      ).run(lib, source.id, source.version, idea.id);
    }
  });
  library.saveOperation(root, key, mapping, 'done');
  library.syncProjectCatalog(root, result);
  return result;
}
