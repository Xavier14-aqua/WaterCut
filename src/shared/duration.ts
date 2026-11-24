import type { Asset, Project, Shot, ShotAsset } from './models';
export type PreviewClip = {
  shot: Shot;
  asset?: Asset;
  binding?: ShotAsset;
  startMs: number;
  durationMs: number;
  sourceStartMs: number;
  playable: boolean;
  warning: string | null;
};
export function effectiveDurationMs(
  shot: Shot,
  asset?: Asset,
  binding?: ShotAsset,
): number {
  if (asset?.kind === 'video' && binding) {
    const end = binding.outMs ?? asset.durationMs;
    if (
      end != null &&
      end > binding.inMs &&
      (asset.durationMs == null || end <= asset.durationMs)
    )
      return end - binding.inMs;
  }
  return shot.durationMs;
}
export function buildPreviewSequence(project: Project): PreviewClip[] {
  let startMs = 0;
  return project.shots.map((shot) => {
    const binding = project.shotAssets.find((b) => b.shotId === shot.id);
    const asset = project.assets.find((a) => a.id === binding?.assetId);
    const end = binding?.outMs ?? asset?.durationMs;
    const invalid =
      asset?.kind === 'video' &&
      (end == null ||
        !binding ||
        end <= binding.inMs ||
        (asset.durationMs != null && end > asset.durationMs));
    const durationMs = effectiveDurationMs(shot, asset, binding);
    const clip: PreviewClip = {
      shot,
      asset,
      binding,
      startMs,
      durationMs,
      sourceStartMs: binding?.inMs ?? 0,
      playable: !!asset && !asset.missing && !invalid,
      warning: invalid
        ? '视频区间未知或无效，按预计时长显示文字'
        : asset?.missing
          ? '素材缺失，显示文字占位'
          : null,
    };
    startMs += durationMs;
    return clip;
  });
}
export function suggestedIdeaOrder(
  project: Project,
  ids: string[],
): {
  ids: string[];
  ambiguous: boolean;
} {
  const set = new Set(ids),
    edges = project.boardEdges.filter(
      (e) => e.kind === 'sequence' && set.has(e.source) && set.has(e.target),
    );
  const starts = ids.filter((id) => !edges.some((e) => e.target === id));
  if (ids.length === 1)
    return {
      ids,
      ambiguous: false,
    };
  if (
    starts.length !== 1 ||
    edges.length !== ids.length - 1 ||
    ids.some(
      (id) =>
        edges.filter((e) => e.source === id).length > 1 ||
        edges.filter((e) => e.target === id).length > 1,
    )
  )
    return {
      ids,
      ambiguous: true,
    };
  const ordered: string[] = [];
  let current: string | undefined = starts[0];
  while (current && !ordered.includes(current)) {
    ordered.push(current);
    current = edges.find((e) => e.source === current)?.target;
  }
  return ordered.length === ids.length
    ? {
        ids: ordered,
        ambiguous: false,
      }
    : {
        ids,
        ambiguous: true,
      };
}
