import { useEffect, useRef, useState } from 'react';
import { version as appVersion } from '../../../package.json';
import { IdeaBoard } from '../features/board/IdeaBoard';
import type { IdeaInput, ImportProgress, LibraryPage, Project, ResourceDrag, ScriptBlock, Shot,ShotListFilter, StorageSettings } from '../../shared/models';
import { LibraryBrowser, IdeaForm, ResourceCards } from '../features/library/Resources';
import { Inspector, type Selection } from './Inspector';
import { UIErrorBoundary } from '../ui/UIErrorBoundary';
import { ScriptView } from '../features/script/ScriptView';
import { StoryboardView } from '../features/storyboard/StoryboardView';
import { PreviewView } from '../features/preview/PreviewView';
import { AIDrawer } from '../features/ai/AIDrawer';
import { DeliveryPanel } from '../features/delivery/DeliveryPanel';
import { ProjectLibraryBrowser } from '../features/library/ProjectLibraryBrowser';
import { suggestedIdeaOrder } from '../../shared/duration';
type SaveTask = {
  key: string;
  action: () => Promise<Project>;
};
type View = 'board' | 'script' | 'storyboard' | 'preview' | 'checklist';
const views: Record<View, string> = {
  board: '白板',
  script: '脚本',
  storyboard: '分镜',
  preview: '粗剪',
  checklist: '清单'
};
function friendly(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']+': Error: /, '').replace(/ENOSPC.*/, '磁盘空间不足，请清理后重试');
}
export function App() {
  const [mode, setMode] = useState<'home' | 'library' | 'project'>('home'),
    [view, setView] = useState<View>('board'),
    [project, setProject] = useState<Project | null>(null),
    [library, setLibrary] = useState<LibraryPage | null>(null),
    [settings, setSettings] = useState<StorageSettings | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null),
    [selectedIdeas, setSelectedIdeas] = useState<string[]>([]),
    [globalSelection, setGlobalSelection] = useState<string[]>([]),
    [resourceScope, setResourceScope] = useState<'project' | 'library'>('project'),
    [resourceTab, setResourceTab] = useState<'ideas' | 'assets'>('ideas'),
    [resourceSearch, setResourceSearch] = useState('');
  const [libraryView, setLibraryView] = useState<'global' | 'project'>('global'),
    [libraryProject, setLibraryProject] = useState<Project | null>(null);
  const [shotListFilter,setShotListFilter]=useState<ShotListFilter>({onlyGaps:true});
  const libraryProjectRef = useRef<Project | null>(null),
    lastLibraryProjectId = useRef('');
  function applyLibraryProject(next: Project | null) {
    const current = libraryProjectRef.current;
    if (next && current?.id === next.id && next.revision < current.revision) return;
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
    running = useRef<Promise<unknown>>(Promise.resolve()),
    pending = useRef(new Map<string, SaveTask>()),
    timers = useRef(new Map<string, number>()),
    chain = useRef<Promise<unknown>>(Promise.resolve());
  const reported = useRef(new Set<string>());
  const libraryIdRef = useRef('');
  editorRef.current = editor;
  function applyProject(remote: Project) {
    const local = projectRef.current;
    if (local?.id === remote.id && remote.revision < local.revision) return;
    if (local?.id === remote.id) {
      remote = {
        ...remote,
        shots: remote.shots.map(s => pending.current.has(`shot:${s.id}`) || pending.current.has(`meta:${s.id}`) ? local.shots.find(v => v.id === s.id) ?? s : s),
        ideas: remote.ideas.map(i => pending.current.has(`idea:${i.id}`) ? local.ideas.find(v => v.id === i.id) ?? i : i),
        shotAssets: remote.shotAssets.map(b => pending.current.has(`trim:${b.shotId}`) ? local.shotAssets.find(v => v.shotId === b.shotId) ?? b : b),
        scriptBlocks: remote.scriptBlocks.map(b => pending.current.has(`block:${b.id}`) ? local.scriptBlocks.find(v => v.id === b.id) ?? b : b)
      };
    } else {
      setShotListFilter({onlyGaps:true});
      setSelectedIdeas([]);
      setSelection(null);
      setOrder(null);
    }
    projectRef.current = remote;
    setProject(remote);
    const paths = [remote.directory, ...readRecent().filter(p => p !== remote.directory)].slice(0, 8);
    localStorage.setItem('watercut:recentProjects', JSON.stringify(paths));
  }
  function optimistic(next: Project) {
    projectRef.current = next;
    setProject(next);
  }
  async function reloadLibrary() {
    const page = await window.watercut.readLibrary({
      limit: 100
    });
    if (libraryIdRef.current !== page.id) {
      libraryIdRef.current = page.id;
      setGlobalSelection([]);
    }
    setLibrary(page);
    setRefresh(old => old + 1);
    return page;
  }
  function refreshed() {
    void reloadLibrary().catch(e => setMessage(friendly(e)));
  }
  function enqueue(task: SaveTask) {
    chain.current = chain.current.catch(() => undefined).then(async () => {
      setMessage('保存中…');
      try {
        const value = await task.action();
        applyProject(value);
        if (!pending.current.size) setMessage('已保存');
      } catch (error) {
        if (!pending.current.has(task.key)) pending.current.set(task.key, task);
        setMessage(`保存失败，请重试：${friendly(error)}`);
        throw error;
      }
    });
    return chain.current;
  }
  function schedule(key: string, action: () => Promise<Project>) {
    const previous = timers.current.get(key);
    if (previous) clearTimeout(previous);
    pending.current.set(key, {
      key,
      action
    });
    setMessage('未保存');
    timers.current.set(key, window.setTimeout(() => {
      timers.current.delete(key);
      const task = pending.current.get(key);
      pending.current.delete(key);
      if (task) void enqueue(task).catch(() => undefined);
    }, 500));
  }
  async function flush() {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    const tasks = [...pending.current.values()];
    pending.current.clear();
    const outcomes = await Promise.allSettled(tasks.map(enqueue));
    await chain.current.catch(() => undefined);
    if (outcomes.some(v => v.status === 'rejected') || pending.current.size) throw new Error('部分编辑尚未保存，请检查失败提示后重试');
  }
  async function run(action: () => Promise<unknown>, applyResult: (project: Project) => void = applyProject): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setMessage('处理中…');
    const operation = (async () => {
      try {
        await flush();
        const result = await action();
        if (result && typeof result === 'object' && 'shots' in result && 'directory' in result) applyResult(result as Project);
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
    void window.watercut.getStorageSettings().then(setSettings).catch(e => setMessage(friendly(e)));
    void reloadLibrary().catch(e => setMessage(`全局库无法打开：${friendly(e)}，可在存储设置中重新选择`));
    const offProgress = window.watercut.onImportProgress(setProgress);
    const offClose = window.watercut.onCloseRequest(async () => {
      try {
        if (editorRef.current && !window.confirm('新灵感尚在编辑，确认退出？')) return false;
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
      for (const timer of timers.current.values()) clearTimeout(timer);
    };
  }, []);
  function readRecent(): string[] {
    try {
      return JSON.parse(localStorage.getItem('watercut:recentProjects') ?? '[]');
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
  function patchShot(_shot: Shot, patch: Partial<Shot>) {
    const p = projectRef.current;
    if (!p || busyRef.current) return;
    const old = p.shots.find(s => s.id === _shot.id);
    if (!old) return;
    const next = {
      ...old,
      ...patch
    };
    optimistic({
      ...p,
      shots: p.shots.map(s => s.id === next.id ? next : s)
    });
    schedule(`shot:${next.id}`, () => window.watercut.updateShot(p.directory, next.id, next));
  }
  function patchMeta(_shot: Shot, patch: Partial<Shot>) {
    const p = projectRef.current;
    if (!p || busyRef.current) return;
    const old = p.shots.find(s => s.id === _shot.id);
    if (!old) return;
    const next = {
      ...old,
      ...patch
    };
    optimistic({
      ...p,
      shots: p.shots.map(s => s.id === next.id ? next : s)
    });
    schedule(`meta:${next.id}`, () => window.watercut.updateShotMetadata(p.directory, next.id, next));
  }
  function patchIdea(id: string, input: IdeaInput) {
    const p = projectRef.current;
    if (!p || busyRef.current) return;
    optimistic({
      ...p,
      ideas: p.ideas.map(i => i.id === id ? {
        ...i,
        ...input,
        id
      } : i)
    });
    schedule(`idea:${id}`, () => window.watercut.updateIdea(p.directory, id, input));
  }
  function patchTrim(id: string, patch: {
    inMs?: number;
    outMs?: number | null;
  }) {
    const p = projectRef.current;
    if (!p || busyRef.current) return;
    const old = p.shotAssets.find(b => b.shotId === id);
    if (!old) return;
    const value = {
      ...old,
      ...patch
    };
    optimistic({
      ...p,
      shotAssets: p.shotAssets.map(b => b.shotId === id ? value : b)
    });
    schedule(`trim:${id}`, () => window.watercut.updateTrim(p.directory, id, value.inMs, value.outMs));
  }
  function patchBlock(block: ScriptBlock, text: string) {
    const p = projectRef.current;
    if (!p || busyRef.current) return;
    optimistic({
      ...p,
      scriptBlocks: p.scriptBlocks.map(b => b.id === block.id ? {
        ...b,
        text
      } : b)
    });
    schedule(`block:${block.id}`, () => window.watercut.saveScriptBlock(p.directory, {
      id: block.id,
      kind: block.kind,
      text
    }));
  }
  function duration(scope: 'library' | 'project', id: string, ms: number) {
    const known = scope === 'project' ? projectRef.current?.assets.find(a => a.id === id) : library?.assets.find(a => a.id === id);
    if (known?.metadata?.status === 'ready' && known.metadata.durationMs) return;
    const key = `${scope}:${scope === 'project' ? projectRef.current?.id : library?.id}:${id}:${ms}`;
    if (reported.current.has(key)) return;
    reported.current.add(key);
    if (scope === 'library') void window.watercut.updateLibraryAsset(id, {
      durationMs: ms
    }).then(refreshed).catch(e => {
      reported.current.delete(key);
      setMessage(friendly(e));
    });else {
      const p = projectRef.current;
      if (!p) return;
      const asset = p.assets.find(a => a.id === id);
      if (!asset || asset.durationMs === ms) return;
      void window.watercut.updateAssetDuration(p.directory, id, ms).then(result => {
        if (projectRef.current?.id === result.id) applyProject(result);
      }).catch(e => {
        reported.current.delete(key);
        setMessage(friendly(e));
      });
    }
  }
  function select(scope: 'library' | 'project', kind: 'idea' | 'asset' | 'shot', id: string) {
    setSelection({
      scope,
      kind,
      id
    });
  }
  function browseDuration(scope: 'library' | 'project', id: string, ms: number) {
    if (scope === 'library') {
      duration(scope, id, ms);
      return;
    }
    const p = libraryProjectRef.current,
      a = p?.assets.find(a => a.id === id);
    if (!p || !a || a.durationMs === ms || a.metadata?.durationMs) return;
    void run(() => window.watercut.updateAssetDuration(p.directory, id, ms), applyLibraryProject);
  }
  async function attach(kind: 'idea' | 'asset', id: string, copy = false) {
    const p = projectRef.current;
    if (!p) {
      setMessage('先打开项目，或选择灵感后孵化新项目');
      return;
    }
    await run(async () => {
      const next = kind === 'idea' ? await window.watercut.attachLibraryIdeas(p.directory, [id], copy) : await window.watercut.attachLibraryAssets(p.directory, [id]);
      if (kind === 'idea') {
        const instances = next.ideas.filter(idea => idea.sourceIdeaId === id);
        const instance = copy ? instances.at(-1) : instances[0];
        if (instance) {
          setSelectedIdeas([instance.id]);
          setSelection({
            scope: 'project',
            kind: 'idea',
            id: instance.id
          });
        }
      }
      return next;
    });
  }
  async function dropResource(resource: ResourceDrag, shotId?: string, position?: {
    x: number;
    y: number;
  }) {
    const p = projectRef.current;
    if (!p) return;
    await run(async () => {
      let next = p,
        assetId = resource.id,
        ideaId = resource.id;
      if(resource.kind==='select'){if(!shotId)throw new Error('请把精华片段拖到分镜卡片上');return window.watercut.bindSelect(p.directory,shotId,resource.id);}
      if (resource.scope === 'library') {
        next = resource.kind === 'idea' ? await window.watercut.attachLibraryIdeas(p.directory, [resource.id]) : await window.watercut.attachLibraryAssets(p.directory, [resource.id]);
        if (resource.kind === 'idea') ideaId = next.ideas.find(i => i.sourceIdeaId === resource.id)!.id;else assetId = next.assets.find(a => a.sourceAssetId === resource.id)!.id;
      }
      if (resource.kind === 'idea' && position) next = await window.watercut.moveIdea(p.directory, ideaId, position.x, position.y);
      if(resource.kind==='idea'&&shotId)next=await window.watercut.addShotSource(p.directory,shotId,ideaId);
      if (resource.kind === 'asset' && shotId) {
        const asset = next.assets.find(a => a.id === assetId);
        if (!asset) throw new Error('素材不存在');
        next = asset.kind === 'audio' ? await window.watercut.linkAudio(p.directory, shotId, assetId) : await window.watercut.addCandidate(p.directory, shotId, assetId);
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
    setGlobalSelection(old => old.includes(id) ? old.filter(v => v !== id) : [...old, id]);
  }
  const normalizedSearch = resourceSearch.normalize('NFKC').toLowerCase();
  const filteredIdeas = project?.ideas.filter(i => `${i.text} ${i.tags}`.normalize('NFKC').toLowerCase().includes(normalizedSearch)) ?? [],
    filteredAssets = project?.assets.filter(a => `${a.name} ${a.tags}`.normalize('NFKC').toLowerCase().includes(normalizedSearch)) ?? [];
  const activeProject = mode === 'project' && project;
  return <div className="app-shell"><nav className="rail" aria-label="主导航"><strong className="rail-brand">W<span>WaterCut</span></strong><button className={mode === 'home' ? 'active' : ''} onClick={() => void changeMode('home')}>▦<span>项目</span></button><button className={mode === 'library' ? 'active' : ''} onClick={() => void changeMode('library')}>◈<span>总库</span></button>{project && <button className={mode === 'project' ? 'active' : ''} onClick={() => void changeMode('project')}>▤<span>工作室</span></button>}<button className="rail-settings" onClick={() => setShowSettings(true)}>⚙<span>存储</span></button><small>v{appVersion}</small></nav>
    <div className="app-content"><header className="global-header"><div className="header-title">{activeProject ? <input key={project.id + project.name} aria-label="项目名称" defaultValue={project.name} disabled={busy} onBlur={e => {
            if (e.target.value.trim() && e.target.value !== project.name) void run(() => window.watercut.renameProject(project.directory, e.target.value));
          }} /> : <strong>{mode === 'library' ? '你的灵感，总会用得上' : 'WaterCut 创作空间'}</strong>}</div>{activeProject && <nav className="workflow" aria-label="创作流程">{(Object.entries(views) as Array<[View, string]>).map(([key, label]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => void changeView(key)}>{label}</button>)}</nav>}{activeProject && <button className="secondary delivery-toggle" disabled={busy} onClick={() => setShowDelivery(true)}>版本与交付</button>}<span className={`save-state ${message.includes('失败') ? 'error' : ''}`}>{busy ? '处理中…' : message.startsWith('保存失败') ? '保存失败' : message === '未保存' ? '未保存' : message === '保存中…' ? '保存中…' : '本地保存'}</span></header>
    {mode === 'home' && <main className="home-page"><div className="home-intro"><p className="eyebrow">FROM A SPARK TO A STORY</p><h1>给下一个故事，<br />留一个开始。</h1><p>收集零散灵感，整理画面，在拍齐素材之前看见全片。</p><div className="toolbar"><input aria-label="新项目名称" placeholder="项目名称" value={name} onChange={e => setName(e.target.value)} /><button disabled={busy || !name.trim()} onClick={() => void run(async () => {
              const p = await window.watercut.createProject(name);
              setMode('project');
              setView('board');
              setName('');
              return p;
            })}>新建项目</button><button className="secondary" disabled={busy} onClick={() => void run(async () => {
              const p = await window.watercut.openProject();
              if (p) setMode('project');
              return p;
            })}>打开项目文件夹</button><button className="secondary" disabled={busy} onClick={() => void run(async () => {
              const p = await window.watercut.importProjectPackage();
              if (p) {
                setMode("project");
                setView("board");
                setShowDelivery(false);
              }
              return p;
            })}>导入项目包</button></div><button className="text-button" disabled={busy} onClick={() => void run(async () => {
            const p = await window.watercut.createExample();
            setMode('project');
            setView('preview');
            return p;
          })}>用官方示例体验一条故事 →</button></div>
      <div className="section-heading"><h2>项目大厅</h2><div className="toolbar"><label><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />查看归档</label><button className="quiet" disabled={busy} onClick={() => void run(() => window.watercut.reconcileLibrary())}>核对项目索引</button></div></div><div className="project-grid">{library?.projects.filter(p => showArchived ? p.archived : !p.archived).map(item => <article key={item.id} className="project-tile"><span className="project-icon">▤</span><h3>{item.name}</h3><small>{item.available ? '本地项目' : '项目位置离线'} · {new Date(item.lastSeen).toLocaleDateString('zh-CN')}</small><p className="path">{item.directory}</p><button disabled={busy || !item.available} onClick={() => void run(async () => {
              const p = await window.watercut.readProject(item.directory);
              setMode('project');
              return p;
            })}>进入工作室</button><button className="quiet" disabled={busy || !item.available} onClick={() => void run(() => window.watercut.archiveProject(item.directory, !item.archived))}>{item.archived ? '恢复归档' : '归档'}</button></article>)}</div>{!library?.projects.length && <div className="empty-state">还没有已登记项目。可以新建，或打开现有 .watercut 文件夹。</div>}
      <details><summary>旧版最近项目</summary>{readRecent().map(dir => <button key={dir} className="recent-path" onClick={() => void run(async () => {
            const p = await window.watercut.readProject(dir);
            setMode('project');
            return p;
          })}>{dir}</button>)}</details>
    </main>}
    {mode === 'library' && <div className="global-library-layout"><main className="library-main"><div className="section-heading"><div><p className="eyebrow">LIBRARY</p><h1>平时囤下，创作时找到</h1></div></div><div className="library-scope-switch segmented" aria-label="资源库范围"><button className={libraryView === 'global' ? 'active' : ''} disabled={busy} onClick={() => {
              setLibraryView('global');
              setSelection(null);
            }}>全局总库</button><button className={libraryView === 'project' ? 'active' : ''} disabled={busy} onClick={() => {
              setLibraryView('project');
              setSelection(null);
            }}>项目库</button></div>{libraryView === 'global' ? <><div className="incubate-bar"><span>{globalSelection.length} 张卡片已选</span><input aria-label="关系备注" value={relationNote} onChange={e => setRelationNote(e.target.value)} placeholder="两张卡片的关系备注" /><button className="secondary" disabled={busy || globalSelection.length !== 2} onClick={() => void run(async () => {
                await window.watercut.connectLibraryIdeas(globalSelection[0], globalSelection[1], 'related', relationNote);
                return true;
              })}>建立关联</button><input aria-label="孵化项目名称" value={name} onChange={e => setName(e.target.value)} placeholder="新项目名称" /><button disabled={busy || !globalSelection.length} onClick={() => void run(async () => {
                const p = await window.watercut.createProject(name.trim() || '灵感项目');
                const result = await window.watercut.attachLibraryIdeas(p.directory, globalSelection);
                setMode('project');
                setView('board');
                setGlobalSelection([]);
                return result;
              })}>孵化为项目</button></div><LibraryBrowser key={library?.id} refresh={refresh} busy={busy} onRun={run} onPick={(kind, id) => select('library', kind, id)} onAdd={project ? attach : undefined} onCreate={() => setEditor('library')} onImport={() => void run(() => window.watercut.importLibraryAssets())} onToggle={toggleGlobal} selected={globalSelection} onError={setMessage} onDuration={(id, d) => duration('library', id, d)} /></> : <ProjectLibraryBrowser projects={library?.projects ?? []} project={libraryProject} preferredDirectory={libraryProject?.directory ?? project?.directory} refresh={refresh} onRun={action => run(action, applyLibraryProject)} onProject={applyLibraryProject} onPick={(kind, id) => select('project', kind, id)} onOpen={() => void run(async () => {
            const p = libraryProjectRef.current;
            if (!p) return null;
            setMode('project');
            setView('board');
            return window.watercut.readProject(p.directory);
          })} onError={setMessage} busy={busy} />}</main><UIErrorBoundary scope="inspector" resetKey={`${selection?.scope}:${selection?.kind}:${selection?.id}`} onReset={() => setSelection(null)}><Inspector selection={selection} project={libraryView === 'project' ? libraryProject : project} library={library} busy={busy} onClose={() => setSelection(null)} onNotice={setMessage} onRun={action => run(action, libraryView === 'project' ? applyLibraryProject : applyProject)} onPatchShot={patchShot} onPatchMeta={patchMeta} onPatchTrim={patchTrim} onPatchIdea={patchIdea} onRefresh={refreshed} onDuration={libraryView === 'project' ? browseDuration : duration} autoSaveIdeas={libraryView !== 'project'} onNavigateIdea={id => select('library', 'idea', id)} /></UIErrorBoundary></div>}
    {activeProject && <div className="workspace"><aside className="resources-sidebar"><div className="segmented"><button className={resourceScope === 'project' ? 'active' : ''} onClick={() => setResourceScope('project')}>当前项目</button><button className={resourceScope === 'library' ? 'active' : ''} onClick={() => setResourceScope('library')}>全局总库</button></div>{resourceScope === 'library' ? <LibraryBrowser compact refresh={refresh} onPick={(kind, id) => select('library', kind, id)} onAdd={attach} onCreate={() => setEditor('library')} onImport={() => void run(() => window.watercut.importLibraryAssets())} onError={setMessage} onDuration={(id, d) => duration('library', id, d)} /> : <><div className="section-heading"><h2>项目原料</h2><button className="quiet" disabled={busy} onClick={() => setEditor('project')}>+ 灵感</button></div><div className="segmented"><button className={resourceTab === 'ideas' ? 'active' : ''} onClick={() => setResourceTab('ideas')}>灵感 {project.ideas.length}</button><button className={resourceTab === 'assets' ? 'active' : ''} onClick={() => setResourceTab('assets')}>素材 {project.assets.length}</button></div><input className="search" aria-label="搜索项目资源" value={resourceSearch} placeholder="搜索本项目…" onChange={e => setResourceSearch(e.target.value)} />{resourceTab === 'assets' && <button className="secondary full-width" disabled={busy} onClick={() => void run(() => window.watercut.importAsset(project.directory))}>导入项目独有副本</button>}<ResourceCards assetSelects={project.availableSelects} ideas={filteredIdeas} assets={filteredAssets} scope="project" scopeId={project.id} tab={resourceTab} onPick={(kind, id) => select('project', kind, id)} selected={selectedIdeas} onTag={tag => setResourceSearch(tag)} onToggle={id => setSelectedIdeas(old => old.includes(id) ? old.filter(v => v !== id) : [...old, id])} onDuration={(id, d) => duration('project', id, d)} /><button className="text-button" disabled={busy} onClick={() => void run(() => window.watercut.promoteProject(project.directory))}>将项目内容加入全局库 ↗</button><small className="muted">原项目副本会保留；取消后可继续。</small></>}</aside>
      <main className="workspace-main">{view === 'board' && <section className="board-view"><div className="section-heading"><div><p className="eyebrow">IDEA BOARD</p><h1>先让想法连起来</h1></div><button disabled={busy || !selectedIdeas.length} onClick={prepareOrder}>所选 {selectedIdeas.length} 张 → 分镜</button></div><p className="muted">框选或 Ctrl 多选。从资源栏拖入卡片；从连接点拉线，写下衔接想法。</p><IdeaBoard project={project} busy={busy} selectedIds={selectedIdeas} onSelection={ids => setSelectedIdeas(old => old.length === ids.length && old.every(id => ids.includes(id)) ? old : ids)} onPick={id => select('project', 'idea', id)} onMove={(id, x, y) => void run(() => window.watercut.moveIdea(project.directory, id, x, y))} onConnect={(source, target, sourceHandle, targetHandle) => void run(() => window.watercut.connectIdeas(project.directory, source, target, sourceHandle, targetHandle))} onDisconnect={id => void run(() => window.watercut.disconnectIdeas(project.directory, id))} onLabel={(id, label) => void run(() => window.watercut.updateEdgeLabel(project.directory, id, label))} onDropResource={(resource, x, y) => void dropResource(resource, undefined, {
              x,
              y
            })} /></section>}
      {view === 'script' && <ScriptView project={project} busy={busy} onSection={beforeId => void run(() => window.watercut.createScriptSection(project.directory, {
            title: '新标题',
            beforeId
          }))} onParagraph={id => void run(() => window.watercut.addScriptParagraph(project.directory, id))} onReorder={ids => void run(() => window.watercut.reorderScriptBlocks(project.directory, ids))} onAdd={kind => void run(() => window.watercut.saveScriptBlock(project.directory, {
            kind,
            text: ''
          }))} onPatchBlock={patchBlock} onPatchShot={patchShot} onConvert={ids => void run(() => window.watercut.convertScriptBlocks(project.directory, ids, crypto.randomUUID()))} onSplit={(id, offset) => {
            if (!offset) {
              setMessage('请先把光标放在正文中间，再点拆分');
              return;
            }
            if (window.confirm('在光标处拆分正文？已关联镜头会拆成两个：第一镜保留主画面，新镜头留空并标记待检查。')) void run(() => window.watercut.splitScriptBlock(project.directory, id, offset));
          }} onMerge={(first, second) => {
            if (window.confirm('合并相邻段落？若已关联镜头，将保留第一镜的主画面，其他候选和来源合并，第二镜移除。')) void run(() => window.watercut.mergeScriptBlocks(project.directory, first, second));
          }} onDelete={id => void run(() => window.watercut.deleteScriptBlock(project.directory, id))} />}
      {(view === 'storyboard' || view === 'checklist') && <StoryboardView key={view} checklist={view === 'checklist'} project={project} busy={busy} selected={selection?.kind === 'shot' ? selection.id : undefined} onSelect={id => select('project', 'shot', id)} onAdd={() => void run(() => window.watercut.addShot(project.directory, {
            description: '新镜头',
            durationMs: 3000
          }))} onPatch={patchShot} onDrop={(id, resource) => void dropResource(resource, id)} onMove={(id, offset) => void run(() => window.watercut.moveShot(project.directory, id, offset))} onDelete={id => void run(() => window.watercut.deleteShot(project.directory, id))} filter={shotListFilter} onFilter={setShotListFilter} onPDF={()=>void run(()=>window.watercut.exportStoryboardPDF(project.directory,{landscape:true,checklist:true,filter:shotListFilter}))} onExport={() => void run(() => window.watercut.exportShotList(project.directory,shotListFilter))} />}
      {view === 'preview' && <PreviewView project={project} busy={busy} onRun={run} onSelect={id => select('project', 'shot', id)} onReorder={ids => void run(() => window.watercut.reorderShots(project.directory, ids))} onTrim={(id, inMs, outMs) => void run(() => window.watercut.updateTrim(project.directory, id, inMs, outMs))} onPatch={(shot, patch) => 'needsReview' in patch ? patchMeta(shot, patch) : patchShot(shot, patch)} onDuration={(id, d) => duration('project', id, d)} />}
      <AIDrawer key={project.id} project={project} selected={selectedIdeas} busy={busy} onNotice={setMessage} selectedShot={selection?.kind==='shot'?selection.id:undefined} onRun={run} /></main>
      <UIErrorBoundary scope="inspector" resetKey={`${selection?.scope}:${selection?.kind}:${selection?.id}`} onReset={() => setSelection(null)}><Inspector selection={selection} project={project} library={library} busy={busy} onClose={() => setSelection(null)} onNotice={setMessage} onRun={run} onPatchShot={patchShot} onPatchMeta={patchMeta} onPatchTrim={patchTrim} onPatchIdea={patchIdea} onRefresh={refreshed} onDuration={duration} onNavigateIdea={id => select('library', 'idea', id)} /></UIErrorBoundary>
    </div>}
    <footer className="app-status" role="status"><span>{message}</span>{message.includes('保存失败') && <button className="quiet" onClick={() => void flush().catch(e => setMessage(friendly(e)))}>重试保存</button>}{progress && <div className="import-progress"><progress value={progress.copied} max={Math.max(1, progress.total)} /><span>{progress.phase ?? ''} {Math.floor(progress.copied / Math.max(1, progress.total) * 100)}%</span><button className="quiet" onClick={() => void window.watercut.cancelImport()}>取消任务</button></div>}</footer>
    </div>
    {showDelivery && activeProject && <DeliveryPanel key={project.id} project={project} busy={busy} onRun={run} onClose={() => setShowDelivery(false)} onNotice={setMessage} shotListFilter={shotListFilter} />}
    {showSettings && <div className="modal-backdrop"><section className="modal"><div className="section-heading"><h2>本地存储</h2><button className="quiet" onClick={() => setShowSettings(false)}>关闭</button></div><p>项目与总库保存在程序外。修改项目目录只影响以后新建的项目；切换总库会打开另一库，不自动搬移原件。</p>{settings && (['projectsRoot', 'libraryRoot'] as const).map(field => <div className="storage-row" key={field}><strong>{field === 'projectsRoot' ? '新项目保存位置' : '全局库位置'}</strong><p className="path">{settings[field]}</p><button className="secondary" disabled={busy} onClick={() => void run(async () => {
            const next = await window.watercut.chooseStorageRoot(field);
            if (next) {
              setSettings(next);
              setSelection(null);
              if (projectRef.current) return window.watercut.readProject(projectRef.current.directory);
            }
            return next;
          })}>选择位置</button></div>)}</section></div>}
    {editor && <div className="modal-backdrop"><section className="modal"><IdeaForm key={editor} libraryMode={editor === 'library'} mediaScopeId={editor === 'library' ? library?.id : project?.id} assets={editor === 'library' ? library?.assets ?? [] : project?.assets ?? []} heading={editor === 'library' ? '记录到全局灵感库' : '记录到当前项目'} busy={busy} onCancel={() => setEditor(null)} onSave={async input => {
          const ok = await run(() => editor === 'library' ? window.watercut.saveLibraryIdea(input) : window.watercut.createIdea(project!.directory, input));
          if (ok) setEditor(null);
          return ok;
        }} /></section></div>}
    {order && project && <div className="modal-backdrop"><section className="modal"><h2>确认分镜顺序</h2><p>{orderWarning ? '所选连线含分叉、环路或断开，请手动确认顺序。' : '已按单链方向排列，可在写入前调整。'}</p>{order.map((id, index) => <div className="order-row" key={id}><strong>{index + 1}</strong><span>{project.ideas.find(i => i.id === id)?.text}</span><button className="quiet" disabled={!index} onClick={() => setOrder(old => {
            const next = [...old!];
            [next[index - 1], next[index]] = [next[index], next[index - 1]];
            return next;
          })}>↑</button><button className="quiet" disabled={index === order.length - 1} onClick={() => setOrder(old => {
            const next = [...old!];
            [next[index + 1], next[index]] = [next[index], next[index + 1]];
            return next;
          })}>↓</button></div>)}<div className="toolbar"><button disabled={busy} onClick={() => void run(() => window.watercut.createShotsFromIdeas(project.directory, order, crypto.randomUUID())).then(ok => {
            if (ok) {
              setOrder(null);
              setView('storyboard');
            }
          })}>创建镜头骨架</button><button className="secondary" onClick={() => setOrder(null)}>取消</button></div></section></div>}
  </div>;
}
