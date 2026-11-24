import type { ResourceDrag } from '../../shared/models';

export function startResourceDrag(
  event: React.DragEvent,
  resource: ResourceDrag,
) {
  event.dataTransfer.setData(
    'application/x-watercut',
    JSON.stringify(resource),
  );
  event.dataTransfer.effectAllowed = 'copy';
}

export function readResourceDrag(event: React.DragEvent): ResourceDrag | null {
  try {
    const data = JSON.parse(
      event.dataTransfer.getData('application/x-watercut'),
    );
    return ['library', 'project'].includes(data.scope) &&
      ['idea', 'asset', 'select'].includes(data.kind) &&
      typeof data.id === 'string'
      ? data
      : null;
  } catch {
    return null;
  }
}
