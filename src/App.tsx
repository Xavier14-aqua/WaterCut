import { useEffect, useRef, useState } from 'react';
import type { Asset, DraftShot, Idea, Project, Shot, ShotAsset } from './project';
import { IdeaBoard } from './IdeaBoard';

const RECENT_KEY = 'watercut:recentProjects';
function recentPaths(): string[] {
  try {
    const paths = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as string[];
    const legacy = localStorage.getItem('watercut:lastProject');
    return paths.length ? paths : legacy ? [legacy] : [];
  } catch { return []; }
}
function mediaUrl(id: string) { return `watercut-media://asset/${id}`; }
function friendlyError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('ENOSPC')) return '磁盘空间不足，请清理空间后重试';
  if (text.includes('EACCES') || text.includes('EPERM')) return '没有读写权限，请检查项目文件夹权限';
  if (text.includes('ENOENT')) return '文件已移动或删除，请重新定位后重试';
  return text.replace(/^Error invoking remote method '[^']+': Error: /, '');
}

function AssetPreview({ asset }: { asset: Asset }) {
  const element = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => { if (entries[0]?.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: '200px' });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  return <div className="asset-thumb" ref={element}>{asset.missing ? <span>素材缺失</span> : failed ? <span>无法预览</span> : !visible ? <span>加载预览…</span> : asset.thumbnail ? <img loading="lazy" src={mediaUrl(`thumb-${asset.id}`)} onError={() => setFailed(true)} /> : asset.kind === 'image' ? <img loading="lazy" src={mediaUrl(asset.id)} onError={() => setFailed(true)} /> : asset.kind === 'video' ? <video muted preload="metadata" src={mediaUrl(asset.id)} onLoadedData={e => { e.currentTarget.currentTime = Math.min(.1, e.currentTarget.duration || .1); }} onError={() => setFailed(true)} /> : <audio controls src={mediaUrl(asset.id)} onError={() => setFailed(true)} />}</div>;
}

export function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [recent, setRecent] = useState(recentPaths);
  const [storageRoot, setStorageRoot] = useState('');
  const [name, setName] = useState('');
  const [renameOpen, setRenameOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'idea' | 'asset' | 'shot'; id: string } | null>(null);
  const [newShot, setNewShot] = useState('');
  const [newIdea, setNewIdea] = useState('');
  const [search, setSearch] = useState('');
  const [selectedIdeas, setSelectedIdeas] = useState<string[]>([]);
  const [aiModel, setAiModel] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [hasAiKey, setHasAiKey] = useState(false);
  const [draft, setDraft] = useState<DraftShot[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('就绪');
  const [progress, setProgress] = useState<{ copied: number; total: number } | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const advanced = useRef(false);
  const saveTimers = useRef(new Map<string, number>());
  const pendingSaves = useRef(new Map<string, () => Promise<Project>>());
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const activeDirectory = useRef<string | null>(null);

  function showProject(value: Project) {
    if (activeDirectory.current !== value.directory) { setSelectedIdeas([]); setDraft(null); activeDirectory.current = value.directory; }
    setProject(value);
    const basename = value.directory.replaceAll('\\', '/').split('/').at(-1);
    const paths = [value.directory, ...recentPaths().filter(item => item !== value.directory && item.replaceAll('\\', '/').split('/').at(-1) !== basename)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(paths));
    setRecent(paths);
    setMessage('已保存');
  }

  useEffect(() => {
    window.watercut.getProjectsRoot().then(setStorageRoot).catch(() => undefined);
    window.watercut.getAISettings().then(settings => { setAiModel(settings.model); setHasAiKey(settings.hasKey); }).catch(() => undefined);
    const first = recentPaths()[0];
    if (first) window.watercut.readProject(first).then(showProject).catch(() => setMessage('上次项目无法打开，请从最近项目选择其他项目'));
    const offProgress = window.watercut.onImportProgress(setProgress);
    const offThumbnail = window.watercut.onThumbnailReady(assetId => setProject(current => current ? { ...current, assets: current.assets.map(asset => asset.id === assetId ? { ...asset, thumbnail: true } : asset) } : current));
    return () => { offProgress(); offThumbnail(); };
  }, []);

  async function run(action: () => Promise<Project | null>): Promise<boolean> {
    setBusy(true); setMessage('处理中…');
    try { await flushPending(); const result = await action(); if (result) { showProject(result); return true; } setMessage('已取消'); return false; }
    catch (error) { setMessage(`操作失败：${friendlyError(error)}`); return false; }
    finally { setBusy(false); setProgress(null); }
  }

  async function deleteCard(kind: 'idea' | 'asset' | 'shot', id: string) {
    if (!project) return;
    if (deleteTarget?.kind !== kind || deleteTarget.id !== id) { setDeleteTarget({ kind, id }); return; }
    const ok = await run(() => kind === 'idea' ? window.watercut.deleteIdea(project.directory, id) : kind === 'asset' ? window.watercut.deleteAsset(project.directory, id) : window.watercut.deleteShot(project.directory, id));
    if (ok) { setDeleteTarget(null); if (kind === 'idea') setSelectedIdeas(current => current.filter(item => item !== id)); }
  }

  function enqueueSave(key: string, save: () => Promise<Project>) {
    saveChain.current = saveChain.current.catch(() => undefined).then(async () => {
      setMessage('保存中…');
      try {
        await save();
        if (pendingSaves.current.get(key) === save) pendingSaves.current.delete(key);
        setMessage('已保存');
      } catch (error) {
        if (!pendingSaves.current.has(key)) pendingSaves.current.set(key, save);
        setMessage(`保存失败，请重试：${friendlyError(error)}`);
        throw error;
      }
    });
    return saveChain.current;
  }

  async function flushPending() {
    await saveChain.current.catch(() => undefined);
    for (const timer of saveTimers.current.values()) clearTimeout(timer);
    saveTimers.current.clear();
    const saves = [...pendingSaves.current.entries()];
    pendingSaves.current.clear();
    for (const [key, save] of saves) await enqueueSave(key, save);
    await saveChain.current;
  }

  useEffect(() => window.watercut.onCloseRequest(async () => {
    try { await flushPending(); return true; }
    catch { setMessage('保存失败，窗口未关闭；请重试保存后再关闭'); return false; }
  }), []);

  function schedule(key: string, save: () => Promise<Project>) {
    const previous = saveTimers.current.get(key);
    if (previous) clearTimeout(previous);
    pendingSaves.current.set(key, save);
    setMessage('未保存');
    const timer = window.setTimeout(() => {
      saveTimers.current.delete(key);
      const latest = pendingSaves.current.get(key);
      pendingSaves.current.delete(key);
      if (latest) void enqueueSave(key, latest).catch(() => undefined);
    }, 500);
    saveTimers.current.set(key, timer);
  }

  function editShot(id: string, patch: Partial<Shot>) {
    if (!project || busy) return;
    const shot = project.shots.find(item => item.id === id);
    if (!shot) return;
    const updated = { ...shot, ...patch };
    setProject({ ...project, shots: project.shots.map(item => item.id === id ? updated : item) });
    schedule(`shot:${id}`, () => window.watercut.updateShot(project.directory, id, updated));
  }

  function editIdea(id: string, patch: Partial<Idea>) {
    if (!project || busy) return;
    const idea = project.ideas.find(item => item.id === id);
    if (!idea) return;
    const updated = { ...idea, ...patch };
    setProject({ ...project, ideas: project.ideas.map(item => item.id === id ? updated : item) });
    schedule(`idea:${id}`, () => window.watercut.updateIdea(project.directory, id, updated));
  }

  function editAsset(id: string, tags: string) {
    if (!project || busy) return;
    setProject({ ...project, assets: project.assets.map(item => item.id === id ? { ...item, tags } : item) });
    schedule(`asset:${id}`, () => window.watercut.updateAssetTags(project.directory, id, tags));
  }

  function editTrim(shotId: string, patch: Partial<ShotAsset>) {
    if (!project || busy) return;
    const link = project.shotAssets.find(item => item.shotId === shotId);
    if (!link) return;
    const updated = { ...link, ...patch };
    setProject({ ...project, shotAssets: project.shotAssets.map(item => item.shotId === shotId ? updated : item) });
    if (updated.inMs >= 0 && (updated.outMs === null || updated.outMs > updated.inMs))
      schedule(`trim:${shotId}`, () => window.watercut.updateTrim(project.directory, shotId, updated.inMs, updated.outMs));
    else setMessage('出点必须晚于入点');
  }

  async function changeProject() {
    try { await flushPending(); setRenameOpen(false); setDeleteTarget(null); setSelectedIdeas([]); setDraft(null); setProject(null); }
    catch { setMessage('保存失败，未切换项目；请重试或保留当前窗口'); }
  }

  const previewShot = previewIndex === null ? null : project?.shots[previewIndex];
  const previewLink = previewShot ? project?.shotAssets.find(link => link.shotId === previewShot.id) : undefined;
  const previewAsset = project?.assets.find(asset => asset.id === previewLink?.assetId);
  useEffect(() => { advanced.current = false; setPreviewFailed(false); }, [previewShot?.id]);
  function nextPreview() {
    if (advanced.current) return;
    advanced.current = true;
    setPreviewIndex(index => index === null || !project || index + 1 >= project.shots.length ? null : index + 1);
  }
  useEffect(() => {
    if (previewIndex === null || !previewShot || (previewAsset?.kind === 'video' && !previewAsset.missing && !previewFailed)) return;
    const timer = window.setTimeout(nextPreview, previewShot.durationMs);
    return () => clearTimeout(timer);
  }, [previewIndex, previewShot?.id, previewShot?.durationMs, previewAsset?.id, previewAsset?.missing, previewFailed]);

  const filteredAssets = project?.assets.filter(asset => `${asset.name} ${asset.tags}`.toLowerCase().includes(search.toLowerCase())) || [];
  return <main className="app">
    <header><span className="brand">WaterCut</span><span className="badge">v0.1 离线创作</span></header>
    {!project ? <section className="hero">
      <p className="eyebrow">本地优先的创作工作台</p><h1>开始一个项目</h1>
      {storageRoot && <p className="path">新项目与导入素材默认保存在：{storageRoot}</p>}
      <div className="row"><input aria-label="项目名称" placeholder="项目名称" value={name} onChange={e => setName(e.target.value)} maxLength={100} /><button disabled={busy || !name.trim()} onClick={() => run(() => window.watercut.createProject(name))}>新建项目</button><button className="secondary" disabled={busy} onClick={() => run(window.watercut.openProject)}>打开项目文件夹</button></div>
      <h2>最近项目</h2><div className="recent-list">{recent.map(directory => <button className="secondary" key={directory} onClick={() => run(() => window.watercut.readProject(directory))}>{directory}</button>)}</div>
    </section> : <>
      <section className="project-head"><div><p className="eyebrow">当前项目</p>{renameOpen ? <div className="row"><input aria-label="项目新名称" value={draftName} maxLength={100} autoFocus onChange={e => setDraftName(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setRenameOpen(false); }} /><button disabled={busy || !draftName.trim()} onClick={async () => { if (await run(() => window.watercut.renameProject(project.directory, draftName))) setRenameOpen(false); }}>保存名称</button><button className="secondary" onClick={() => setRenameOpen(false)}>取消</button></div> : <h1>{project.name}</h1>}<p className="path">{project.directory}</p><p className="path">已导入素材约 {(project.assets.reduce((sum, asset) => sum + asset.size, 0) / 1048576).toFixed(1)} MB</p></div><div className="row"><button className="secondary" disabled={busy || renameOpen} onClick={() => { setDraftName(project.name); setRenameOpen(true); }}>重命名</button><button className="secondary" onClick={() => void changeProject()}>切换项目</button></div></section>

      <section className="editor"><h2>灵感箱</h2><div className="row"><input aria-label="新灵感" placeholder="随手记下一句想法" value={newIdea} onChange={e => setNewIdea(e.target.value)} /><button disabled={busy || !newIdea.trim()} onClick={() => run(async () => { const value = await window.watercut.addIdea(project.directory, newIdea); setNewIdea(''); return value; })}>添加</button></div>
        <div className="cards">{project.ideas.map(idea => <article className="card" key={idea.id}><textarea aria-label="灵感文字" value={idea.text} onChange={e => editIdea(idea.id, { text: e.target.value })} /><input aria-label="灵感标签" placeholder="标签，逗号分隔" value={idea.tags} onChange={e => editIdea(idea.id, { tags: e.target.value })} /><textarea aria-label="灵感备注" placeholder="备注" value={idea.notes} onChange={e => editIdea(idea.id, { notes: e.target.value })} />{idea.sourceAssetId && <span>来源素材：{project.assets.find(asset => asset.id === idea.sourceAssetId)?.name || '已缺失'}</span>}<div className="card-actions"><button className={deleteTarget?.kind === 'idea' && deleteTarget.id === idea.id ? 'danger' : 'secondary'} disabled={busy} onClick={() => void deleteCard('idea', idea.id)}>{deleteTarget?.kind === 'idea' && deleteTarget.id === idea.id ? '确认删除灵感' : '删除卡片'}</button>{deleteTarget?.kind === 'idea' && deleteTarget.id === idea.id && <button className="secondary" onClick={() => setDeleteTarget(null)}>取消</button>}</div></article>)}</div>
      </section>

      <section className="editor"><h2>灵感白板</h2><p>拖动卡片整理思路；从任意一边的连接点拖到另一张卡片的任意连接点。可在白板下方的连线列表删除，也可点选连线后按 Delete。</p>
        <IdeaBoard project={project} busy={busy} onMove={(id, x, y) => void run(() => window.watercut.moveIdea(project.directory, id, x, y))} onConnect={(source, target, sourceHandle, targetHandle) => void run(() => window.watercut.connectIdeas(project.directory, source, target, sourceHandle, targetHandle))} onDisconnect={id => void run(() => window.watercut.disconnectIdeas(project.directory, id))} />
      </section>

      <section className="editor"><h2>AI 分镜草案</h2><p>选中灵感后生成 5～10 个可编辑镜头。只有点击“加入分镜”才会写入项目。发送内容仅包含选中灵感的文字、标签和备注。</p>
        <div className="ai-settings"><label>模型名称<input aria-label="AI 模型名称" value={aiModel} onChange={e => setAiModel(e.target.value)} placeholder="填写 OpenAI 模型 ID" /></label><label>API Key<input aria-label="AI API Key" type="password" autoComplete="off" value={aiKey} onChange={e => setAiKey(e.target.value)} placeholder={hasAiKey ? '已保存在本机，留空保持不变' : '输入 OpenAI API Key'} /></label><button disabled={busy || !aiModel.trim()} onClick={async () => { setBusy(true); try { const settings = await window.watercut.saveAISettings(aiModel, aiKey); setHasAiKey(settings.hasKey); setAiKey(''); setMessage('AI 设置已保存在本机'); } catch (error) { setMessage(`设置失败：${friendlyError(error)}`); } finally { setBusy(false); } }}>保存 AI 设置</button><button className="secondary" disabled={busy || !hasAiKey} onClick={async () => { try { await window.watercut.clearAIKey(); setHasAiKey(false); setAiKey(''); setMessage('本机 AI 密钥已清除'); } catch (error) { setMessage(`清除失败：${friendlyError(error)}`); } }}>清除密钥</button></div>
        <div className="idea-picker">{project.ideas.map(idea => <label key={idea.id}><input type="checkbox" checked={selectedIdeas.includes(idea.id)} onChange={e => setSelectedIdeas(current => e.target.checked ? [...current, idea.id] : current.filter(id => id !== idea.id))} />{idea.text.slice(0, 100)}</label>)}</div>
        <button disabled={busy || !hasAiKey || !selectedIdeas.length} onClick={async () => { setBusy(true); setMessage('正在生成草案…'); try { await flushPending(); const result = await window.watercut.generateDraft(project.directory, selectedIdeas); setDraft(result); setMessage('草案已生成，请检查和编辑后加入分镜'); } catch (error) { setMessage(`生成失败：${friendlyError(error)}`); } finally { setBusy(false); } }}>根据选中灵感生成草案</button>
        {draft && <div className="draft-review"><h3>草案预览 · {draft.length} 个镜头</h3>{draft.map((shot, index) => <div className="draft-card" key={index}><strong>镜头 {index + 1}</strong><label>画面<textarea value={shot.description} onChange={e => setDraft(current => current!.map((item, i) => i === index ? { ...item, description: e.target.value } : item))} /></label><label>动作 / 对白<textarea value={shot.actionDialogue} onChange={e => setDraft(current => current!.map((item, i) => i === index ? { ...item, actionDialogue: e.target.value } : item))} /></label><label>预计时长（秒）<input type="number" min="0.1" max="600" step="0.1" value={shot.durationMs / 1000} onChange={e => setDraft(current => current!.map((item, i) => i === index ? { ...item, durationMs: Math.round(Number(e.target.value) * 1000) } : item))} /></label><button className="secondary" onClick={() => setDraft(current => current!.filter((_, i) => i !== index))}>移除</button></div>)}<div className="row"><button disabled={busy || !draft.length || draft.some(shot => !shot.description.trim() || !Number.isInteger(shot.durationMs) || shot.durationMs < 100 || shot.durationMs > 600000)} onClick={async () => { if (await run(() => window.watercut.appendDraft(project.directory, draft))) setDraft(null); }}>确认加入分镜</button><button className="secondary" onClick={() => setDraft(null)}>放弃草案</button></div></div>}
      </section>

      <section className="editor"><div className="row section-title"><h2>素材库</h2><div className="row"><button disabled={busy} onClick={() => { setProgress(null); void run(() => window.watercut.importAsset(project.directory)); }}>导入素材</button><input aria-label="搜索素材" placeholder="按文件名或标签搜索" value={search} onChange={e => setSearch(e.target.value)} /></div></div>
        {progress && <div className="import-progress"><progress value={progress.copied} max={progress.total} /><span>{Math.floor(progress.copied / progress.total * 100)}% · {(progress.copied / 1048576).toFixed(1)} / {(progress.total / 1048576).toFixed(1)} MB</span><button className="secondary" onClick={() => void window.watercut.cancelImport()}>取消导入</button></div>}
        <div className="cards">{filteredAssets.map(asset => <article className="card asset-card" key={asset.id}>
          <AssetPreview asset={asset} />
          <strong title={asset.name}>{asset.name}</strong><small>{asset.kind} · {(asset.size / 1048576).toFixed(1)} MB</small>
          <input aria-label={`${asset.name} 标签`} placeholder="素材标签" value={asset.tags} onChange={e => editAsset(asset.id, e.target.value)} />
          <button className="secondary" onClick={() => run(() => window.watercut.attachIdeaAsset(project.directory, asset.id))}>作为灵感卡片</button>
          {asset.missing && <button onClick={() => run(() => window.watercut.relinkAsset(project.directory, asset.id))}>重新定位</button>}
          <div className="card-actions"><button className={deleteTarget?.kind === 'asset' && deleteTarget.id === asset.id ? 'danger' : 'secondary'} disabled={busy} onClick={() => void deleteCard('asset', asset.id)}>{deleteTarget?.kind === 'asset' && deleteTarget.id === asset.id ? '确认删除项目副本' : '删除素材卡片'}</button>{deleteTarget?.kind === 'asset' && deleteTarget.id === asset.id && <button className="secondary" onClick={() => setDeleteTarget(null)}>取消</button>}</div>
          {deleteTarget?.kind === 'asset' && deleteTarget.id === asset.id && <small>将删除项目内副本及镜头关联；不会删除导入前的原始文件。</small>}
        </article>)}</div>
      </section>

      <section className="editor"><div className="row section-title"><h2>分镜列表</h2><button className="secondary" disabled={!project.shots.length} onClick={() => setPreviewIndex(0)}>从头预览</button></div>
        <div className="row"><input aria-label="新镜头画面" placeholder="新镜头画面" value={newShot} onChange={e => setNewShot(e.target.value)} /><button disabled={busy || !newShot.trim()} onClick={() => run(async () => { const value = await window.watercut.addShot(project.directory, { description: newShot, durationMs: 3000 }); setNewShot(''); return value; })}>添加镜头</button></div>
        <ol className="shot-list">{project.shots.map((shot, index) => {
          const link = project.shotAssets.find(item => item.shotId === shot.id);
          const linkedAsset = project.assets.find(asset => asset.id === link?.assetId);
          return <li className="shot-card" key={shot.id}>
            <div className="shot-toolbar"><strong>镜头 {index + 1}</strong><button className="secondary" disabled={busy || index === 0} onClick={() => run(() => window.watercut.moveShot(project.directory, shot.id, -1))}>↑</button><button className="secondary" disabled={busy || index === project.shots.length - 1} onClick={() => run(() => window.watercut.moveShot(project.directory, shot.id, 1))}>↓</button><button className={deleteTarget?.kind === 'shot' && deleteTarget.id === shot.id ? 'danger' : 'secondary'} disabled={busy} onClick={() => void deleteCard('shot', shot.id)}>{deleteTarget?.kind === 'shot' && deleteTarget.id === shot.id ? '确认删除镜头' : '删除'}</button>{deleteTarget?.kind === 'shot' && deleteTarget.id === shot.id && <button className="secondary" onClick={() => setDeleteTarget(null)}>取消</button>}</div>
            <label>画面<textarea value={shot.description} onChange={e => editShot(shot.id, { description: e.target.value })} /></label>
            <label>动作 / 对白<textarea value={shot.actionDialogue} onChange={e => editShot(shot.id, { actionDialogue: e.target.value })} /></label>
            <label>预计时长（秒）<input type="number" min="0.1" max="600" step="0.1" value={shot.durationMs / 1000} onChange={e => editShot(shot.id, { durationMs: Math.round(Number(e.target.value) * 1000) })} /></label>
            <div className="candidate-box"><label>添加候选画面<select value="" onChange={e => { const assetId = e.currentTarget.value; if (assetId) void run(() => window.watercut.addCandidate(project.directory, shot.id, assetId)); }}><option value="">选择素材</option>{project.assets.filter(asset => asset.kind !== 'audio' && !project.shotCandidates.some(candidate => candidate.shotId === shot.id && candidate.assetId === asset.id)).map(asset => <option key={asset.id} value={asset.id}>{asset.name}{asset.missing ? '（缺失）' : ''}</option>)}</select></label><div className="candidate-chips">{project.shotCandidates.filter(candidate => candidate.shotId === shot.id).map(candidate => <span key={candidate.assetId}>{project.assets.find(asset => asset.id === candidate.assetId)?.name}<button className="secondary" title="移除候选" onClick={() => run(() => window.watercut.removeCandidate(project.directory, shot.id, candidate.assetId))}>×</button></span>)}</div></div>
            <label>主画面<select value={link?.assetId || ''} onChange={e => { const assetId = e.currentTarget.value; if (assetId) void run(() => window.watercut.linkAsset(project.directory, shot.id, assetId)); }}><option value="">选择主画面</option>{project.shotCandidates.filter(candidate => candidate.shotId === shot.id).map(candidate => { const asset = project.assets.find(item => item.id === candidate.assetId); return asset ? <option key={asset.id} value={asset.id}>{asset.name}{asset.missing ? '（缺失）' : ''}</option> : null; })}</select></label>
            <label>参考音频<select value={project.shotAudio.find(item => item.shotId === shot.id)?.assetId || ''} onChange={e => { const assetId = e.currentTarget.value; if (assetId) void run(() => window.watercut.linkAudio(project.directory, shot.id, assetId)); }}><option value="">选择音频</option>{project.assets.filter(asset => asset.kind === 'audio').map(asset => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>
            {linkedAsset?.kind === 'video' && link && <div className="trim-controls"><label>入点（秒）<input type="number" min="0" step="0.1" value={link.inMs / 1000} onChange={e => editTrim(shot.id, { inMs: Math.round(Number(e.target.value) * 1000) })} /></label><label>出点（秒，留空为片尾）<input type="number" min="0.1" step="0.1" value={link.outMs === null ? '' : link.outMs / 1000} onChange={e => editTrim(shot.id, { outMs: e.target.value === '' ? null : Math.round(Number(e.target.value) * 1000) })} /></label></div>}
            <button className="secondary retry" disabled={busy || !shot.description.trim()} onClick={() => run(() => window.watercut.updateShot(project.directory, shot.id, shot))}>立即保存 / 重试</button>
          </li>;
        })}</ol>
      </section>
    </>}
    {previewShot && <div className="preview-overlay" role="dialog" aria-label="粗剪预览"><div className="preview-top"><span>镜头 {previewIndex! + 1} / {project!.shots.length}</span><button onClick={() => setPreviewIndex(null)}>关闭预览</button></div><div className="preview-stage" key={previewShot.id}>{previewAsset?.kind === 'video' && !previewAsset.missing && !previewFailed ? <video autoPlay controls src={mediaUrl(previewAsset.id)} onLoadedMetadata={e => { const player = e.currentTarget; const start = (previewLink?.inMs || 0) / 1000; if (start >= player.duration) { setMessage('入点超过视频时长，已跳过镜头'); nextPreview(); } else player.currentTime = start; }} onTimeUpdate={e => { if (previewLink?.outMs != null && e.currentTarget.currentTime * 1000 >= previewLink.outMs) nextPreview(); }} onEnded={nextPreview} onError={() => { setPreviewFailed(true); setMessage('视频无法播放；请检查素材文件或换用可播放格式'); }} /> : previewAsset?.kind === 'image' && !previewAsset.missing && !previewFailed ? <img src={mediaUrl(previewAsset.id)} onError={() => { setPreviewFailed(true); setMessage('图片无法打开；请重新定位或导入图片'); }} /> : <p>暂无可播放主画面</p>}</div><p>{previewShot.description}</p></div>}
    <div className="status" role="status">{message}{message.startsWith('保存失败') && <button className="secondary" onClick={() => void flushPending().catch(() => undefined)}>重试保存</button>}</div>
  </main>;
}
