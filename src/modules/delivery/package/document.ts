import { validateDocument } from '../../../shared/document';

import { safePackagePath } from '../../../infrastructure/files/package-zip';

import { Missing } from './manifest';

export function independentDocument(
  input: unknown,
  listed: Set<string>,
  missing: Missing[],
) {
  const doc = validateDocument(input);
  for (const a of doc.assets) {
    const relative = safePackagePath(a.relativePath);
    if (
      a.storageKind !== 'local' ||
      a.sourceAssetId ||
      a.sourceLibraryId ||
      !relative.startsWith('assets/')
    )
      throw new Error('项目包仍包含外部素材引用');
    if (
      !listed.has(relative) &&
      !missing.some((m) => m.assetId === a.id && m.path === relative)
    )
      throw new Error('项目包缺少未声明的素材依赖');
  }
  for (const i of doc.ideas) {
    i.sourceLibraryId = null;
    i.sourceIdeaId = null;
    i.sourceVersion = null;
  }
  for (const b of doc.shotAssets) {
    b.sourceSelectId = null;
    b.sourceSelectVersion = null;
  }
  return doc;
}
