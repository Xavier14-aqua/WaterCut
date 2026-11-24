import type { Selection } from './selection';
import type {
  IdeaInput,
  LibraryPage,
  Project,
  Shot,
} from '../../shared/models';
import { IdeaInspector } from '../features/inspiration';
import { AssetInspector } from '../features/library';
import { ShotInspector } from '../features/storyboard';
import { useInspectorResources } from './inspector/useInspectorResources';
import { BlueprintArt } from '../ui/BlueprintArt';

type InspectorProps = {
  selection: Selection | null;
  project: Project | null;
  library: LibraryPage | null;
  busy: boolean;
  onClose: () => void;
  onNotice: (text: string) => void;
  onRun: (action: () => Promise<unknown>) => Promise<boolean>;
  onPatchShot: (shot: Shot, patch: Partial<Shot>) => void;
  onPatchMeta: (shot: Shot, patch: Partial<Shot>) => void;
  onPatchTrim: (
    id: string,
    patch: {
      inMs?: number;
      outMs?: number | null;
    },
  ) => void;
  onPatchIdea: (id: string, input: IdeaInput) => void;
  onRefresh: () => void;
  onDuration: (
    scope: 'library' | 'project',
    id: string,
    duration: number,
  ) => void;
  autoSaveIdeas?: boolean;
  onNavigateIdea?: (id: string) => void;
};

/** The app selects a feature inspector; each feature owns its editing form. */
export function Inspector(props: InspectorProps) {
  const {
    selection,
    project,
    library,
    busy,
    onClose,
    onNotice,
    onRun,
    onPatchShot,
    onPatchMeta,
    onPatchTrim,
    onPatchIdea,
    onRefresh,
    onDuration,
    autoSaveIdeas = true,
    onNavigateIdea,
  } = props;
  const {
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
  } = useInspectorResources({ selection, project, library, onNotice });
  if (!selection)
    return (
      <aside className="inspector inspector-empty">
        <p className="eyebrow">INSPECTOR</p>
        <h2>细节在这里</h2>
        <p className="muted">
          选中卡片、素材或镜头，查看来源、编辑内容与裁剪范围。
        </p>
        <BlueprintArt variant="target" className="inspector-target" />
      </aside>
    );

  const idea =
    selection.kind === 'idea'
      ? selection.scope === 'library'
        ? globalIdea?.id === selection.id
          ? globalIdea
          : null
        : project?.ideas.find((i) => i.id === selection.id)
      : null;
  const asset =
    selection.kind === 'asset'
      ? selection.scope === 'library'
        ? globalAsset?.id === selection.id
          ? globalAsset
          : null
        : project?.assets.find((a) => a.id === selection.id)
      : null;
  const shot =
    selection.kind === 'shot'
      ? project?.shots.find((s) => s.id === selection.id)
      : null;
  const assets =
    selection.scope === 'library'
      ? [
          ...new Map(
            [...(library?.assets ?? []), ...referenceAssets].map((a) => [
              a.id,
              a,
            ]),
          ).values(),
        ]
      : (project?.assets ?? []);

  return (
    <aside className="inspector">
      <div className="section-heading">
        <span className="eyebrow">INSPECTOR</span>
        <button className="quiet" onClick={onClose}>
          关闭
        </button>
      </div>
      {idea && (
        <IdeaInspector
          scope={selection.scope}
          idea={idea}
          assets={assets}
          project={project}
          library={library}
          source={source}
          related={related}
          relationIdeas={relationIdeas}
          relationNote={relationNote}
          setRelationNote={setRelationNote}
          busy={busy}
          onClose={onClose}
          onRun={onRun}
          onPatchIdea={onPatchIdea}
          onRefresh={onRefresh}
          autoSaveIdeas={autoSaveIdeas}
          onNavigateIdea={onNavigateIdea}
        />
      )}
      {asset && (
        <AssetInspector
          scope={selection.scope}
          scopeId={selection.scope === 'library' ? library!.id : project!.id}
          asset={asset}
          project={project}
          usage={usage}
          busy={busy}
          onClose={onClose}
          onRun={onRun}
          onNotice={onNotice}
          onRefresh={onRefresh}
          onDuration={onDuration}
          setGlobalAsset={setGlobalAsset}
        />
      )}
      {shot && project && (
        <ShotInspector
          shot={shot}
          project={project}
          busy={busy}
          onRun={onRun}
          onPatchShot={onPatchShot}
          onPatchMeta={onPatchMeta}
          onPatchTrim={onPatchTrim}
        />
      )}
    </aside>
  );
}
