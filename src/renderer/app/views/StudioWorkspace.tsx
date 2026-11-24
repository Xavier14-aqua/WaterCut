import { Inspector } from '../Inspector';
import { UIErrorBoundary } from '../../ui/UIErrorBoundary';
import type { AppModel } from '../useAppController';
import { ResourceSidebar } from './ResourceSidebar';
import { WorkflowStage } from './WorkflowStage';

export function StudioWorkspace({ model }: { model: AppModel }) {
  const {
    busy,
    duration,
    library,
    mode,
    patchIdea,
    patchMeta,
    patchShot,
    patchTrim,
    project,
    refreshed,
    run,
    select,
    selection,
    setMessage,
    setSelection,
  } = model;
  const activeProject = mode === 'project' && project;
  return (
    activeProject && (
      <div className="workspace">
        <ResourceSidebar model={model} />
        <WorkflowStage model={model} />
        <UIErrorBoundary
          scope="inspector"
          resetKey={`${selection?.scope}:${selection?.kind}:${selection?.id}`}
          onReset={() => setSelection(null)}
        >
          <Inspector
            selection={selection}
            project={project}
            library={library}
            busy={busy}
            onClose={() => setSelection(null)}
            onNotice={setMessage}
            onRun={run}
            onPatchShot={patchShot}
            onPatchMeta={patchMeta}
            onPatchTrim={patchTrim}
            onPatchIdea={patchIdea}
            onRefresh={refreshed}
            onDuration={duration}
            onNavigateIdea={(id) => select('library', 'idea', id)}
          />
        </UIErrorBoundary>
      </div>
    )
  );
}
