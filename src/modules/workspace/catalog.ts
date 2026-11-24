import * as projects from '../project/index';

import * as library from '../library/index';

export function reconcileCatalog(root: string): void {
  const catalog = library.readLibrary(root, {
    limit: 1,
  }).projects;
  for (const item of catalog) {
    if (!item.available) continue;
    try {
      const project = projects.readProject(item.directory);
      if (project.id === item.id) {
        library.syncProjectCatalog(root, project);
        projects.markCatalogSynced(item.directory, project.revision);
      }
    } catch {
      /* Keep last known index; the project can be repaired/opened explicitly. */
    }
  }
}
