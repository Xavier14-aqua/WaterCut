import { existsSync } from 'node:fs';

import * as projects from '../project/index';

import * as library from '../library/index';

import type { Asset, Project } from '../../shared/models';

export function resolveProjectAsset(
  directory: string,
  asset: Asset,
  root: string,
): string | null {
  if (asset.storageKind === 'local')
    return asset.relativePath
      ? projects.localAssetPath(directory, asset.relativePath)
      : null;
  if (!asset.sourceLibraryId || !asset.sourceAssetId) return null;
  return library.resolveLibraryAsset(
    root,
    asset.sourceLibraryId,
    asset.sourceAssetId,
    asset.sha256,
  );
}

export function hydrateProject(directory: string, root: string): Project {
  const project = projects.readProject(directory);
  project.availableSelects = [];
  project.assets = project.assets.map((asset) => {
    const file = resolveProjectAsset(directory, asset, root);
    let duration = asset.durationMs,
      thumbnail = asset.thumbnail,
      metadata = asset.metadata;
    if (asset.storageKind === 'library' && asset.sourceAssetId) {
      try {
        const source = library.getLibraryAsset(root, asset.sourceAssetId);
        if (source.libraryId === asset.sourceLibraryId) {
          project.availableSelects!.push(
            ...library
              .listAssetSelects(root, source.id)
              .map((s) => ({ ...s, projectAssetId: asset.id })),
          );
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
      missing: !file || !existsSync(file),
    };
  });
  return project;
}
