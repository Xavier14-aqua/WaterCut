import { SaveCoordinator } from './save/SaveCoordinator';
import { createProjectEditors } from './editing/project-editors';
import { useEffect, useRef, useState } from 'react';
import type {
  ImportProgress,
  LibraryPage,
  Project,
  ResourceDrag,
  ShotListFilter,
  StorageSettings,
} from '../../shared/models';
import { type Selection } from './selection';
import { suggestedIdeaOrder } from '../../shared/duration';
import { View } from './navigation';

import { friendly } from './errors';

// Coordinates navigation and shared project/library state. Saving and editors have separate owners.
export function useAppController() {
  const [mode, setMode] = useState<'home' | 'library' | 'project'>('home'),
    [view, setView] = useState<View>('board'),
    [project, setProject] = useState<Project | null>(null),
    [library, setLibrary] = useState<LibraryPage | null>(null),
    [settings, setSettings] = useState<StorageSettings | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null),
    [selectedIdeas, setSelectedIdeas] = useState<string[]>([]),
    [globalSelection, setGlobalSelection] = useState<string[]>([]),
    [resourceScope, setResourceScope] = useState<'project' | 'library'>(
      'project',
    ),
    [resourceTab, setResourceTab] = useState<'ideas' | 'assets'>('ideas'),
    [resourceSearch, setResourceSearch] = useState('');
  const [libraryView, setLibraryView] = useState<'global' | 'project'>(
      'global',
    ),
    [libraryProject, setLibraryProject] = useState<Project | null>(null);
  const [shotListFilter, setShotListFilter] = useState<ShotListFilter>({
    onlyGaps: true,
  });
  const libraryProjectRef = useRef<Project | null>(null),
    lastLibraryProjectId = useRef('');
  function applyLibraryProject(next: Project | null) {
    const current = libraryProjectRef.current;
    if (next && current?.id === next.id && next.revision < current.revision)
      return;
    if (next && next.id !== lastLibraryProjectId.current) {
      setSelection(null);
      lastLibraryProjectId.current = next.id;
    }
    libraryProjectRef.current = next;
    setLibraryProject(next);
    if (next && projectRef.current?.id === next.id) applyProject(next);
  }
  const [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('就绪'),
    [progress, setProgress] = useState<ImportProgress | null>(null),
    [name, setName] = useState(''),
    [showSettings, setShowSettings] = useState(false),
    [showDelivery, setShowDelivery] = useState(false),
    [showArchived, setShowArchived] = useState(false),
    [editor, setEditor] = useState<'project' | 'library' | null>(null),
    [order, setOrder] = useState<string[] | null>(null),
    [orderWarning, setOrderWarning] = useState(false),
    [relationNote, setRelationNote] = useState('');
  const projectRef = useRef<Project | null>(null),
    busyRef = useRef(false),
    editorRef = useRef(editor),
    running = useRef<Promise<unknown>>(Promise.resolve());
  const reported = useRef(new Set<string>());
  const libraryIdRef = useRef('');
  const coordinatorRef = useRef<SaveCoordinator | null>(null);
  const saveHandlers = {
    currentProjectId: () => projectRef.current?.id,
    apply: applyProject,
    notify: setMessage,
    formatError: friendly,
  };
  if (!coordinatorRef.current)
    coordinatorRef.current = new SaveCoordinator(saveHandlers);
  const saveCoordinator = coordinatorRef.current;
  saveCoordinator.updateHandlers(saveHandlers);
  editorRef.current = editor;
  function applyProject(remote: Project) {
    const local = projectRef.current;
    if (local?.id === remote.id && remote.revision < local.revision) return;
    if (local?.id === remote.id) {
      remote = {
        ...remote,
        shots: remote.shots.map((s) =>
          saveCoordinator.hasPending(remote.id, `shot:${s.id}`) ||
          saveCoordinator.hasPending(remote.id, `meta:${s.id}`)
            ? (local.shots.find((v) => v.id === s.id) ?? s)
            : s,
        ),
        ideas: remote.ideas.map((i) =>
          saveCoordinator.hasPending(remote.id, `idea:${i.id}`)
            ? (local.ideas.find((v) => v.id === i.id) ?? i)
            : i,
        ),
        shotAssets: remote.shotAssets.map((b) =>
          saveCoordinator.hasPending(remote.id, `trim:${b.shotId}`)
            ? (local.shotAssets.find((v) => v.shotId === b.shotId) ?? b)
            : b,
        ),
        scriptBlocks: remote.scriptBlocks.map((b) =>
          saveCoordinator.hasPending(remote.id, `block:${b.id}`)
            ? (local.scriptBlocks.find((v) => v.id === b.id) ?? b)
            : b,
        ),
      };
    } else {
      setShotListFilter({ onlyGaps: true });
      setSelectedIdeas([]);
      setSelection(null);
      setOrder(null);
    }
    projectRef.current = remote;
    setProject(remote);
    const paths = [
      remote.directory,
      ...readRecent().filter((p) => p !== remote.directory),
    ].slice(0, 8);
    localStorage.setItem('watercut:recentProjects', JSON.stringify(paths));
  }
  function optimistic(next: Project) {
    projectRef.current = next;
    setProject(next);
  }
  async function reloadLibrary() {
    const page = await window.watercut.readLibrary({
      limit: 100,
    });
    if (libraryIdRef.current !== page.id) {
      libraryIdRef.current = page.id;
      setGlobalSelection([]);
    }
    setLibrary(page);
    setRefresh((old) => old + 1);
    return page;
  }
  function refreshed() {
    void reloadLibrary().catch((e) => setMessage(friendly(e)));
  }

  function schedule(key: string, action: () => Promise<Project>) {
    const id = projectRef.current?.id;
    if (id) saveCoordinator.schedule(id, key, action);
  }
  function flush() {
    return saveCoordinator.flush();
  }
  async function run(
    action: () => Promise<unknown>,
    applyResult: (project: Project) => void = applyProject,
  ): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setMessage('处理中…');
    const operation = (async () => {
      try {
        await flush();
        const result = await action();
        if (
          result &&
          typeof result === 'object' &&
          'shots' in result &&
          'directory' in result
        )
          applyResult(result as Project);
        await reloadLibrary().catch(() => undefined);
        setMessage(result === null ? '已取消' : '已保存');
        return result !== null;
      } catch (error) {
        setMessage(`操作失败：${friendly(error)}`);
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
        setProgress(null);
      }
    })();
    running.current = operation;
    return operation;
  }
  useEffect(() => {
    void window.watercut
      .getStorageSettings()
      .then(setSettings)
      .catch((e) => setMessage(friendly(e)));
    void reloadLibrary().catch((e) =>
      setMessage(`全局库无法打开：${friendly(e)}，可在存储设置中重新选择`),
    );
    const offProgress = window.watercut.onImportProgress(setProgress);
    const offClose = window.watercut.onCloseRequest(async () => {
      try {
        if (editorRef.current && !window.confirm('新灵感尚在编辑，确认退出？'))
          return false;
        if (busyRef.current) {
          await window.watercut.cancelImport();
          await running.current;
        }
        await flush();
        return true;
      } catch (error) {
        setMessage(`退出前保存失败：${friendly(error)}`);
        return false;
      }
    });
    return () => {
      offProgress();
      offClose();
      saveCoordinator.clearTimers();
    };
  }, []);
  function readRecent(): string[] {
    try {
      return JSON.parse(
        localStorage.getItem('watercut:recentProjects') ?? '[]',
      );
    } catch {
      return [];
    }
  }
  async function changeMode(next: 'home' | 'library' | 'project') {
    if (busyRef.current) return;
    try {
      await flush();
      setMode(next);
      setSelection(null);
    } catch (e) {
      setMessage(friendly(e));
    }
  }
  async function changeView(next: View) {
    if (busyRef.current) return;
    try {
      await flush();
      setView(next);
    } catch (e) {
      setMessage(friendly(e));
    }
  }

  const { patchShot, patchMeta, patchIdea, patchTrim, patchBlock } =
    createProjectEditors({ projectRef, busyRef, optimistic, schedule });
  function duration(scope: 'library' | 'project', id: string, ms: number) {
    const known =
      scope === 'project'
        ? projectRef.current?.assets.find((a) => a.id === id)
        : library?.assets.find((a) => a.id === id);
    if (known?.metadata?.status === 'ready' && known.metadata.durationMs)
      return;
    const key = `${scope}:${scope === 'project' ? projectRef.current?.id : library?.id}:${id}:${ms}`;
    if (reported.current.has(key)) return;
    reported.current.add(key);
    if (scope === 'library')
      void window.watercut
        .updateLibraryAsset(id, {
          durationMs: ms,
        })
        .then(refreshed)
        .catch((e) => {
          reported.current.delete(key);
          setMessage(friendly(e));
        });
    else {
      const p = projectRef.current;
      if (!p) return;
      const asset = p.assets.find((a) => a.id === id);
      if (!asset || asset.durationMs === ms) return;
      void window.watercut
        .updateAssetDuration(p.directory, id, ms)
        .then((result) => {
          if (projectRef.current?.id === result.id) applyProject(result);
        })
        .catch((e) => {
          reported.current.delete(key);
          setMessage(friendly(e));
        });
    }
  }
  function select(
    scope: 'library' | 'project',
    kind: 'idea' | 'asset' | 'shot',
    id: string,
  ) {
    setSelection({
      scope,
      kind,
      id,
    });
  }
  function browseDuration(
    scope: 'library' | 'project',
    id: string,
    ms: number,
  ) {
    if (scope === 'library') {
      duration(scope, id, ms);
      return;
    }
    const p = libraryProjectRef.current,
      a = p?.assets.find((a) => a.id === id);
    if (!p || !a || a.durationMs === ms || a.metadata?.durationMs) return;
    void run(
      () => window.watercut.updateAssetDuration(p.directory, id, ms),
      applyLibraryProject,
    );
  }
  async function attach(kind: 'idea' | 'asset', id: string, copy = false) {
    const p = projectRef.current;
    if (!p) {
      setMessage('先打开项目，或选择灵感后孵化新项目');
      return;
    }
    await run(async () => {
      const next =
        kind === 'idea'
          ? await window.watercut.attachLibraryIdeas(p.directory, [id], copy)
          : await window.watercut.attachLibraryAssets(p.directory, [id]);
      if (kind === 'idea') {
        const instances = next.ideas.filter((idea) => idea.sourceIdeaId === id);
        const instance = copy ? instances.at(-1) : instances[0];
        if (instance) {
          setSelectedIdeas([instance.id]);
          setSelection({
            scope: 'project',
            kind: 'idea',
            id: instance.id,
          });
        }
      }
      return next;
    });
  }
  async function dropResource(
    resource: ResourceDrag,
    shotId?: string,
    position?: {
      x: number;
      y: number;
    },
  ) {
    const p = projectRef.current;
    if (!p) return;
    await run(async () => {
      let next = p,
        assetId = resource.id,
        ideaId = resource.id;
      if (resource.kind === 'select') {
        if (!shotId) throw new Error('请把精华片段拖到分镜卡片上');
        return window.watercut.bindSelect(p.directory, shotId, resource.id);
      }
      if (resource.scope === 'library') {
        next =
          resource.kind === 'idea'
            ? await window.watercut.attachLibraryIdeas(p.directory, [
                resource.id,
              ])
            : await window.watercut.attachLibraryAssets(p.directory, [
                resource.id,
              ]);
        if (resource.kind === 'idea')
          ideaId = next.ideas.find((i) => i.sourceIdeaId === resource.id)!.id;
        else
          assetId = next.assets.find(
            (a) => a.sourceAssetId === resource.id,
          )!.id;
      }
      if (resource.kind === 'idea' && position)
        next = await window.watercut.moveIdea(
          p.directory,
          ideaId,
          position.x,
          position.y,
        );
      if (resource.kind === 'idea' && shotId)
        next = await window.watercut.addShotSource(p.directory, shotId, ideaId);
      if (resource.kind === 'asset' && shotId) {
        const asset = next.assets.find((a) => a.id === assetId);
        if (!asset) throw new Error('素材不存在');
        next =
          asset.kind === 'audio'
            ? await window.watercut.linkAudio(p.directory, shotId, assetId)
            : await window.watercut.addCandidate(p.directory, shotId, assetId);
      }
      return next;
    });
  }
  function prepareOrder() {
    const p = projectRef.current;
    if (!p || !selectedIdeas.length) return;
    const suggestion = suggestedIdeaOrder(p, selectedIdeas);
    setOrder(suggestion.ids);
    setOrderWarning(suggestion.ambiguous);
  }
  function toggleGlobal(id: string) {
    setGlobalSelection((old) =>
      old.includes(id) ? old.filter((v) => v !== id) : [...old, id],
    );
  }
  const normalizedSearch = resourceSearch.normalize('NFKC').toLowerCase();
  const filteredIdeas =
      project?.ideas.filter((i) =>
        `${i.text} ${i.tags}`
          .normalize('NFKC')
          .toLowerCase()
          .includes(normalizedSearch),
      ) ?? [],
    filteredAssets =
      project?.assets.filter((a) =>
        `${a.name} ${a.tags}`
          .normalize('NFKC')
          .toLowerCase()
          .includes(normalizedSearch),
      ) ?? [];
  return {
    applyLibraryProject,
    applyProject,
    attach,
    browseDuration,
    busy,
    changeMode,
    changeView,
    dropResource,
    duration,
    editor,
    filteredAssets,
    filteredIdeas,
    flush,
    globalSelection,
    library,
    libraryProject,
    libraryProjectRef,
    libraryView,
    message,
    mode,
    name,
    order,
    orderWarning,
    patchBlock,
    patchIdea,
    patchMeta,
    patchShot,
    patchTrim,
    prepareOrder,
    progress,
    project,
    projectRef,
    readRecent,
    refresh,
    refreshed,
    relationNote,
    resourceScope,
    resourceSearch,
    resourceTab,
    run,
    select,
    selectedIdeas,
    selection,
    setEditor,
    setGlobalSelection,
    setLibraryView,
    setMessage,
    setMode,
    setName,
    setOrder,
    setRelationNote,
    setResourceScope,
    setResourceSearch,
    setResourceTab,
    setSelectedIdeas,
    setSelection,
    setSettings,
    setShotListFilter,
    setShowArchived,
    setShowDelivery,
    setShowSettings,
    setView,
    settings,
    shotListFilter,
    showArchived,
    showDelivery,
    showSettings,
    toggleGlobal,
    view,
  };
}
export type AppModel = ReturnType<typeof useAppController>;
