import type { IdeaInput, ScriptBlock, Shot } from '../../../shared/models';
import type { Project } from '../../../shared/models';

interface EditorContext {
  projectRef: { current: Project | null };
  busyRef: { current: boolean };
  optimistic: (next: Project) => void;
  schedule: (key: string, action: () => Promise<Project>) => void;
}

export function createProjectEditors({
  projectRef,
  busyRef,
  optimistic,
  schedule,
}: EditorContext) {
  function patchShot(_shot: Shot, patch: Partial<Shot>) {
    const p = projectRef.current;
    if (!p || busyRef.current) return;
    const old = p.shots.find((s) => s.id === _shot.id);
    if (!old) return;
    const next = {
      ...old,
      ...patch,
    };
    optimistic({
      ...p,
      shots: p.shots.map((s) => (s.id === next.id ? next : s)),
    });
    schedule(`shot:${next.id}`, () =>
      window.watercut.updateShot(p.directory, next.id, next),
    );
  }

  function patchMeta(_shot: Shot, patch: Partial<Shot>) {
    const p = projectRef.current;
    if (!p || busyRef.current) return;
    const old = p.shots.find((s) => s.id === _shot.id);
    if (!old) return;
    const next = {
      ...old,
      ...patch,
    };
    optimistic({
      ...p,
      shots: p.shots.map((s) => (s.id === next.id ? next : s)),
    });
    schedule(`meta:${next.id}`, () =>
      window.watercut.updateShotMetadata(p.directory, next.id, next),
    );
  }

  function patchIdea(id: string, input: IdeaInput) {
    const p = projectRef.current;
    if (!p || busyRef.current) return;
    optimistic({
      ...p,
      ideas: p.ideas.map((i) =>
        i.id === id
          ? {
              ...i,
              ...input,
              id,
            }
          : i,
      ),
    });
    schedule(`idea:${id}`, () =>
      window.watercut.updateIdea(p.directory, id, input),
    );
  }

  function patchTrim(
    id: string,
    patch: {
      inMs?: number;
      outMs?: number | null;
    },
  ) {
    const p = projectRef.current;
    if (!p || busyRef.current) return;
    const old = p.shotAssets.find((b) => b.shotId === id);
    if (!old) return;
    const value = {
      ...old,
      ...patch,
    };
    optimistic({
      ...p,
      shotAssets: p.shotAssets.map((b) => (b.shotId === id ? value : b)),
    });
    schedule(`trim:${id}`, () =>
      window.watercut.updateTrim(p.directory, id, value.inMs, value.outMs),
    );
  }

  function patchBlock(block: ScriptBlock, text: string) {
    const p = projectRef.current;
    if (!p || busyRef.current) return;
    optimistic({
      ...p,
      scriptBlocks: p.scriptBlocks.map((b) =>
        b.id === block.id
          ? {
              ...b,
              text,
            }
          : b,
      ),
    });
    schedule(`block:${block.id}`, () =>
      window.watercut.saveScriptBlock(p.directory, {
        id: block.id,
        kind: block.kind,
        text,
      }),
    );
  }
  return { patchShot, patchMeta, patchIdea, patchTrim, patchBlock };
}
