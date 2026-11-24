import { useEffect, useState } from 'react';
import type {
  LibraryIdea,
  LibraryAsset,
  RelatedIdea,
  Usage,
  LibraryPage,
  Project,
} from '../../../shared/models';
import type { Selection } from '../selection';

/** Selection-scoped reads ignore responses after the selection changes. */
export function useInspectorResources({
  selection,
  project,
  library,
  onNotice,
}: {
  selection: Selection | null;
  project: Project | null;
  library: LibraryPage | null;
  onNotice: (text: string) => void;
}) {
  const [globalIdea, setGlobalIdea] = useState<LibraryIdea | null>(null),
    [globalAsset, setGlobalAsset] = useState<LibraryAsset | null>(null),
    [related, setRelated] = useState<RelatedIdea[]>([]),
    [usage, setUsage] = useState<Usage[]>([]),
    [source, setSource] = useState<LibraryIdea | null>(null),
    [referenceAssets, setReferenceAssets] = useState<LibraryAsset[]>([]),
    [relationNote, setRelationNote] = useState(''),
    [relationIdeas, setRelationIdeas] = useState<
      Record<string, LibraryIdea | null>
    >({});
  useEffect(() => {
    let live = true;
    setRelationIdeas({});
    if (selection?.scope !== 'library' || selection.kind !== 'idea') return;
    const id = selection.id,
      ids = [
        ...new Set(
          (library?.relations ?? [])
            .filter((r) => r.source === id || r.target === id)
            .map((r) => (r.source === id ? r.target : r.source)),
        ),
      ];
    void Promise.all(
      ids.map(
        async (id) =>
          [
            id,
            await window.watercut.getLibraryIdea(id).catch(() => null),
          ] as const,
      ),
    ).then((items) => {
      if (live) setRelationIdeas(Object.fromEntries(items));
    });
    return () => {
      live = false;
    };
  }, [
    selection?.scope,
    selection?.kind,
    selection?.id,
    library?.id,
    library?.relations,
  ]);
  useEffect(() => {
    let live = true;
    setGlobalIdea(null);
    setGlobalAsset(null);
    setRelated([]);
    setUsage([]);
    setSource(null);
    setReferenceAssets([]);
    if (!selection) return;
    async function load() {
      if (!selection) return;
      if (selection.scope === 'library' && selection.kind === 'idea') {
        const idea = await window.watercut.getLibraryIdea(selection.id),
          list = await window.watercut.relatedIdeas(selection.id),
          assets = await Promise.all(
            idea.media.map((m) => window.watercut.getLibraryAsset(m.assetId)),
          );
        if (live) {
          setGlobalIdea(idea);
          setRelated(list);
          setReferenceAssets(assets);
        }
      }
      if (selection.scope === 'library' && selection.kind === 'asset') {
        const asset = await window.watercut.getLibraryAsset(selection.id),
          list = await window.watercut.libraryUsage(selection.id);
        if (live) {
          setGlobalAsset(asset);
          setUsage(list);
        }
      }
      if (selection.scope === 'project' && selection.kind === 'idea') {
        const idea = project?.ideas.find((i) => i.id === selection.id);
        if (idea?.sourceIdeaId) {
          try {
            const original = await window.watercut.getLibraryIdea(
              idea.sourceIdeaId,
            );
            if (live) setSource(original);
          } catch {}
        }
      }
      if (selection.scope === 'project' && selection.kind === 'asset') {
        const asset = project?.assets.find((a) => a.id === selection.id);
        if (asset?.sourceAssetId && asset.sourceLibraryId === library?.id) {
          const list = await window.watercut.libraryUsage(asset.sourceAssetId);
          if (live) setUsage(list);
        }
      }
    }
    void load().catch((e) => onNotice(String(e)));
    return () => {
      live = false;
    };
  }, [
    selection?.scope,
    selection?.kind,
    selection?.id,
    library?.id,
    project?.id,
    project?.revision,
  ]);

  return {
    globalIdea,
    globalAsset,
    setGlobalAsset,
    related,
    usage,
    source,
    referenceAssets,
    relationNote,
    setRelationNote,
    relationIdeas,
  };
}
