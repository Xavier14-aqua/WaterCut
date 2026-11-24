import { DeliveryPanel } from '../../features/delivery';
import type { AppModel } from '../useAppController';

export function DeliveryDialog({ model }: { model: AppModel }) {
  const {
    busy,
    mode,
    project,
    run,
    setMessage,
    setShowDelivery,
    shotListFilter,
    showDelivery,
  } = model;
  const activeProject = mode === 'project' && project;
  return (
    showDelivery &&
    activeProject && (
      <DeliveryPanel
        key={project.id}
        project={project}
        busy={busy}
        onRun={run}
        onClose={() => setShowDelivery(false)}
        onNotice={setMessage}
        shotListFilter={shotListFilter}
      />
    )
  );
}
