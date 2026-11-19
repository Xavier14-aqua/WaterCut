import { useEffect, useState } from 'react';
import type { Asset, Idea, IdeaInput, LibraryAsset, LibraryIdea, LibraryPage, Project, RelatedIdea, Shot, Usage } from '../shared/models';
import { IdeaForm, MediaPreview, mediaUrl, kindLabel } from './Resources';
import { statusLabel } from './StoryboardView';
import { MediaSelectPanel } from './MediaSelectPanel';
import { UsageList } from './UsageList';
export type Selection = {
  scope: 'library' | 'project';
  kind: 'idea' | 'asset' | 'shot';
  id: string;
};
export function Inspector({
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
  onNavigateIdea
}: {
  selection: Selection | null;
  project: Project | null;
  library: LibraryPage | null;
  busy: boolean;
  onClose: () => void;
  onNotice: (text: string) => void;
  onRun: (action: () => Promise<unknown>) => Promise<boolean>;
  onPatchShot: (shot: Shot, patch: Partial<Shot>) => void;
  onPatchMeta: (shot: Shot, patch: Partial<Shot>) => void;
  onPatchTrim: (id: string, patch: {
    inMs?: number;
    outMs?: number | null;
  }) => void;
  onPatchIdea: (id: string, input: IdeaInput) => void;
  onRefresh: () => void;
  onDuration: (scope: 'library' | 'project', id: string, duration: number) => void;
  autoSaveIdeas?: boolean;
  onNavigateIdea?: (id: string) => void;
}) {
  const [globalIdea, setGlobalIdea] = useState<LibraryIdea | null>(null),
    [globalAsset, setGlobalAsset] = useState<LibraryAsset | null>(null),
    [related, setRelated] = useState<RelatedIdea[]>([]),
    [usage, setUsage] = useState<Usage[]>([]),
    [source, setSource] = useState<LibraryIdea | null>(null),
    [referenceAssets, setReferenceAssets] = useState<LibraryAsset[]>([]),
    [relationNote, setRelationNote] = useState(''),
    [relationIdeas, setRelationIdeas] = useState<Record<string, LibraryIdea | null>>({});
  useEffect(() => {
    let live = true;
    setRelationIdeas({});
    if (selection?.scope !== 'library' || selection.kind !== 'idea') return;
    const id = selection.id,
      ids = [...new Set((library?.relations ?? []).filter(r => r.source === id || r.target === id).map(r => r.source === id ? r.target : r.source))];
    void Promise.all(ids.map(async id => [id, await window.watercut.getLibraryIdea(id).catch(() => null)] as const)).then(items => {
      if (live) setRelationIdeas(Object.fromEntries(items));
    });
    return () => {
      live = false;
    };
  }, [selection?.scope, selection?.kind, selection?.id, library?.id, library?.relations]);
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
          assets = await Promise.all(idea.media.map(m => window.watercut.getLibraryAsset(m.assetId)));
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
        const idea = project?.ideas.find(i => i.id === selection.id);
        if (idea?.sourceIdeaId) {
          try {
            const original = await window.watercut.getLibraryIdea(idea.sourceIdeaId);
            if (live) setSource(original);
          } catch {}
        }
      }
      if (selection.scope === 'project' && selection.kind === 'asset') {
        const asset = project?.assets.find(a => a.id === selection.id);
        if (asset?.sourceAssetId&&asset.sourceLibraryId===library?.id) {
          const list = await window.watercut.libraryUsage(asset.sourceAssetId);
          if (live) setUsage(list);
        }
      }
    }
    void load().catch(e => onNotice(String(e)));
    return () => {
      live = false;
    };
  }, [selection?.scope, selection?.kind, selection?.id, library?.id, project?.id,project?.revision]);
  if (!selection) return <aside className="inspector"><p className="eyebrow">INSPECTOR</p><h2>细节在这里</h2><p className="muted">选中卡片、素材或镜头，查看来源、编辑内容与裁剪范围。</p></aside>;
  const idea = selection.kind === 'idea' ? selection.scope === 'library' ? globalIdea?.id === selection.id ? globalIdea : null : project?.ideas.find(i => i.id === selection.id) : null;
  const asset = selection.kind === 'asset' ? selection.scope === 'library' ? globalAsset?.id === selection.id ? globalAsset : null : project?.assets.find(a => a.id === selection.id) : null;
  const shot = selection.kind === 'shot' ? project?.shots.find(s => s.id === selection.id) : null;
  const assets = selection.scope === 'library' ? [...new Map([...(library?.assets ?? []), ...referenceAssets].map(a => [a.id, a])).values()] : project?.assets ?? [];
  const binding = shot ? project?.shotAssets.find(b => b.shotId === shot.id) : undefined,
    primary = project?.assets.find(a => a.id === binding?.assetId);
  return <aside className="inspector"><div className="section-heading"><span className="eyebrow">INSPECTOR</span><button className="quiet" onClick={onClose}>关闭</button></div>
    {idea && <><IdeaForm key={selection.scope + idea.id} libraryMode={selection.scope === 'library'} mediaScopeId={selection.scope === 'library' ? library?.id : project?.id} value={idea} assets={assets} busy={busy} onCancel={onClose} onDraft={selection.scope === 'project' && autoSaveIdeas ? input => onPatchIdea(idea.id, input) : undefined} onSave={async input => {
        const ok = await onRun(() => selection.scope === 'library' ? window.watercut.saveLibraryIdea(input) : window.watercut.updateIdea(project!.directory, idea.id, input));
        if (ok) {
          onRefresh();
          onClose();
        }
        return ok;
      }} />
      {source && 'sourceVersion' in idea && <div className="source-panel"><strong>全局来源 v{source.version} · 引用 v{idea.sourceVersion}</strong><p>{source.text}</p>{source.version !== idea.sourceVersion && <><small>来源已更新。应用后会替换本项目卡片的文字、标签和参考素材；位置与镜头来源保留。</small><button disabled={busy} onClick={() => {
            if (window.confirm('使用当前全局内容更新本项目卡片？项目内的文字修改会被替换。')) void onRun(() => window.watercut.refreshLibraryIdea(project!.directory, idea.id));
          }}>使用来源更新</button></>}</div>}
      <div className="inspector-actions">{selection.scope === 'library' ? <button className="secondary" disabled={busy} onClick={() => void onRun(async () => {
          await window.watercut.hideLibraryItem('idea', idea.id, !(idea as LibraryIdea).hidden);
          onRefresh();
          onClose();
        })}>{'hidden' in idea && idea.hidden ? '恢复到总库' : '在总库隐藏'}</button> : <button className="danger" disabled={busy} onClick={() => {
          if (window.confirm('删除本项目卡片和白板连线？总库来源和素材原件保留。')) void onRun(() => window.watercut.deleteIdea(project!.directory, idea.id)).then(ok => {
            if (ok) onClose();
          });
        }}>删除项目卡片</button>}</div>
      {selection.scope === 'library' && library && <div className="related-drawer"><h3>已手动关联</h3>{library.relations.filter(r => r.source === idea.id || r.target === idea.id).map(r => <div className="related-item" key={r.id}><small>{{
              related: '关联',
              sequence: '顺序',
              contrast: '对照'
            }[r.kind]} · {r.note || '未填写关系备注'}</small><button className="related-title quiet" title={relationIdeas[r.source === idea.id ? r.target : r.source]?.text} disabled={busy || !relationIdeas[r.source === idea.id ? r.target : r.source]} onClick={() => onNavigateIdea?.(r.source === idea.id ? r.target : r.source)}>{relationIdeas[r.source === idea.id ? r.target : r.source]?.text ?? (r.source in relationIdeas || r.target in relationIdeas ? "关联卡片暂不可用" : "正在读取卡片标题…")}</button><button className="quiet" disabled={busy} onClick={() => void onRun(async () => {
            await window.watercut.disconnectLibraryIdeas(r.id);
            onRefresh();
          })}>移除关系</button></div>)}<h3>同时间 / 同标签发现</h3><input aria-label="关联备注" placeholder="建立关系时的备注（可选）" value={relationNote} onChange={e => setRelationNote(e.target.value)} /><small className="muted">这些是候选，确认后才建立关系。</small>{related.map(item => <div className="related-item" key={item.idea.id}><strong>{item.idea.text}</strong><small>{item.reasons.join(' · ')}</small><button className="quiet" onClick={() => {
            void onRun(async () => {
              await window.watercut.connectLibraryIdeas(idea.id, item.idea.id, 'related', relationNote);
              onRefresh();
            });
          }}>确认关联</button></div>)}</div>}
    </>}
    {asset && <><h2>{asset.name}</h2><MediaPreview key={asset.id} asset={asset} scope={selection.scope === 'library' ? library!.id : project!.id} onDuration={(id, d) => onDuration(selection.scope, id, d)} />{asset.kind === 'video' && !asset.missing && <video className="inspector-video" controls src={mediaUrl(selection.scope === 'library' ? library!.id : project!.id, asset.id)} />}
      <div className="media-metadata"><strong>媒体参数 · {asset.metadata?.status === 'ready' ? '已探测' : asset.metadata?.status === 'failed' ? '探测失败' : '尚未探测'}</strong>{asset.metadata?.status === 'ready' && <><p>{asset.metadata.format ?? '未知容器'} · {asset.metadata.width && asset.metadata.height ? `${asset.metadata.width} × ${asset.metadata.height}` : '尺寸未知'}{asset.metadata.durationMs ? ` · ${(asset.metadata.durationMs / 1000).toFixed(3)} 秒` : ''}</p>{asset.metadata.streams.map((stream, index) => <small key={index}>{stream.type} · {stream.codec ?? '编码未知'}{stream.frameRate ? ` · ${stream.frameRate.numerator}/${stream.frameRate.denominator} fps` : ''}{stream.variableFrameRate ? ' · 可变帧率' : ''}{stream.sampleRate ? ` · ${stream.sampleRate} Hz` : ''}</small>)}</>}{asset.metadata?.error && <p>{asset.metadata.error}</p>}<button className="quiet" disabled={busy} onClick={() => void onRun(async () => {
          if (selection.scope === 'library') {
            const page = await window.watercut.probeLibraryAsset(asset.id);
            if (page) setGlobalAsset(await window.watercut.getLibraryAsset(asset.id));
            onRefresh();
            return page;
          }
          return window.watercut.probeProject(project!.directory);
        })}>重新探测参数</button></div>
      {selection.scope==='library'&&asset.kind==='video'&&<MediaSelectPanel key={asset.id} asset={asset as LibraryAsset} busy={busy} onRun={onRun} onNotice={onNotice}/>}
      <label>标签<input key={asset.id + asset.tags} defaultValue={asset.tags} onBlur={e => {
          const tags = e.currentTarget.value;
          if (tags !== asset.tags) void onRun(() => selection.scope === 'library' ? window.watercut.updateLibraryAsset(asset.id, {
            tags
          }) : window.watercut.updateAssetTags(project!.directory, asset.id, tags)).then(onRefresh);
        }} /></label>
      {selection.scope === 'library' && asset.missing && <button disabled={busy} onClick={() => void onRun(async () => {
        const restored = await window.watercut.relinkLibraryAsset(asset.id);
        if (restored) setGlobalAsset(restored);
        onRefresh();
        return restored;
      })}>重新定位原件</button>}{selection.scope === 'library' && <div className="toolbar"><button className="secondary" disabled={busy} onClick={() => void onRun(async () => {
          const updated = await window.watercut.updateLibraryAsset(asset.id, {
            starred: !asset.starred
          });
          setGlobalAsset(updated);
          onRefresh();
        })}>{asset.starred ? '取消星标' : '☆ 星标'}</button><button className="secondary" disabled={busy} onClick={() => void onRun(async () => {
          await window.watercut.hideLibraryItem('asset', asset.id, !(asset as LibraryAsset).hidden);
          onRefresh();
          onClose();
        })}>{(asset as LibraryAsset).hidden ? '恢复到总库' : '在总库隐藏'}</button></div>}
      {selection.scope === 'project' && <><small className="muted">{'storageKind' in asset && asset.storageKind === 'library' ? '此素材引用全局原件。移除本项目引用不会删除原件。' : '这是项目独有副本。'}</small>{asset.missing && 'storageKind' in asset && asset.storageKind === 'local' && <button disabled={busy} onClick={() => void onRun(() => window.watercut.relinkAsset(project!.directory, asset.id))}>重新定位</button>}<button className="danger" disabled={busy} onClick={() => {
          if (window.confirm('移除此项目素材及关联？全局原件和导入前文件保留。')) void onRun(() => window.watercut.deleteAsset(project!.directory, asset.id)).then(ok => {
            if (ok) onClose();
          });
        }}>移除项目素材</button></>}
      <h3>已知项目使用足迹</h3><UsageList usage={usage}/>
    </>}
    {shot && project && <><h2>镜头 {shot.position + 1}</h2><label>画面<textarea disabled={busy} value={shot.description} onChange={e => onPatchShot(shot, {
          description: e.target.value
        })} /></label><label>动作 / 对白<textarea disabled={busy} value={shot.actionDialogue} onChange={e => onPatchShot(shot, {
          actionDialogue: e.target.value
        })} /></label><label>预计时长（秒）<input type="number" min=".1" max="600" step=".1" value={shot.durationMs / 1000} onChange={e => onPatchShot(shot, {
          durationMs: Math.round(Number(e.target.value) * 1000)
        })} /></label>
      <div className="form-grid">{([['scene', '场景'], ['timeOfDay', '昼夜'], ['shotSize', '景别'], ['movement', '运镜']] as const).map(([key, label]) => <label key={key}>{label}<input disabled={busy} value={shot[key]} onChange={e => onPatchMeta(shot, {
            [key]: e.target.value
          })} /></label>)}</div><label>创作 / 拍摄状态<select disabled={busy} value={shot.status} onChange={e => onPatchMeta(shot, {
          status: e.target.value as Shot['status']
        })}>{Object.entries(statusLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>关键道具<input aria-label="镜头道具" value={shot.props} maxLength={500} disabled={busy} onChange={e=>onPatchMeta(shot,{props:e.target.value})}/></label><label>拍摄准备<select aria-label="拍摄准备状态" disabled={busy} value={shot.productionState} onChange={e=>onPatchMeta(shot,{productionState:e.target.value as Shot['productionState']})}><option value="planned">计划中</option><option value="filmed">已拍 / 已备齐</option><option value="pickup">需要补拍</option></select></label>
      <label>添加候选画面<select disabled={busy} value="" onChange={e => {
          const id = e.target.value;
          if (id) void onRun(() => window.watercut.addCandidate(project.directory, shot.id, id));
        }}><option value="">选择项目素材</option>{project.assets.filter(a => a.kind !== 'audio' && !project.shotCandidates.some(c => c.shotId === shot.id && c.assetId === a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>主画面<select aria-label="主画面" disabled={busy} value={binding?.assetId ?? ''} onChange={e => {
          const assetId = e.currentTarget.value;
          void onRun(() => assetId ? window.watercut.linkAsset(project.directory, shot.id, assetId) : window.watercut.clearShotPrimary(project.directory, shot.id));
        }}><option value="">尚未选择</option><optgroup label="候选画面">{project.shotCandidates.filter(c => c.shotId === shot.id).map(c => <option key={c.assetId} value={c.assetId}>{project.assets.find(a => a.id === c.assetId)?.name}</option>)}</optgroup><optgroup label="其他项目素材">{project.assets.filter(a => a.kind !== 'audio' && !project.shotCandidates.some(c => c.shotId === shot.id && c.assetId === a.id)).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</optgroup></select></label>
      <div className="candidate-chips">{project.shotCandidates.filter(c => c.shotId === shot.id).map(c => <span key={c.assetId}>{project.assets.find(a => a.id === c.assetId)?.name}<button disabled={busy || c.assetId === binding?.assetId} className="quiet" onClick={() => void onRun(() => window.watercut.removeCandidate(project.directory, shot.id, c.assetId))}>×</button></span>)}</div>
      {binding?.sourceSelectName&&<div className="source-panel"><strong>精华来源：{binding.sourceSelectName}</strong><small>引用版本 v{binding.sourceSelectVersion??'历史'} · 本项目裁剪独立保存</small>{project.availableSelects?.find(s=>s.id===binding.sourceSelectId&&s.version!==binding.sourceSelectVersion)&&<small>总库片段已更新；拖入新版后才会替换本项目区间。</small>}</div>}
      {primary?.kind === 'video' && binding && <div className="form-grid"><label>入点（秒）<input type="number" min="0" step=".1" value={binding.inMs / 1000} onChange={e => onPatchTrim(shot.id, {
            inMs: Math.round(Number(e.target.value) * 1000)
          })} /></label><label>出点（空为片尾）<input type="number" min=".1" step=".1" value={binding.outMs === null ? '' : binding.outMs / 1000} onChange={e => onPatchTrim(shot.id, {
            outMs: e.target.value ? Math.round(Number(e.target.value) * 1000) : null
          })} /></label></div>}
      <label>参考音频<select disabled={busy} value={project.shotAudio.find(a => a.shotId === shot.id)?.assetId ?? ''} onChange={e => {
          const assetId = e.currentTarget.value;
          if (assetId) void onRun(() => window.watercut.linkAudio(project.directory, shot.id, assetId));
        }}><option value="">尚未关联</option>{project.assets.filter(a => a.kind === 'audio').map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label><small className="muted">参考音频可单独听，不参与连续粗剪混音。</small>
      <label className="checkbox-label"><input type="checkbox" checked={shot.needsReview} onChange={e => onPatchMeta(shot, {
          needsReview: e.target.checked
        })} />待优化标记</label><label>优化备注<textarea value={shot.reviewNote} onChange={e => onPatchMeta(shot, {
          reviewNote: e.target.value
        })} /></label><h3>灵感来源</h3><label>添加项目灵感<select aria-label="添加灵感来源" value="" disabled={busy} onChange={e => {
          const ideaId = e.currentTarget.value;
          if (ideaId) void onRun(() => window.watercut.addShotSource(project.directory, shot.id, ideaId));
        }}><option value="">选择灵感卡片…</option>{project.ideas.filter(i => !project.shotSources.some(s => s.shotId === shot.id && s.ideaId === i.id)).map(i => <option key={i.id} value={i.id}>{kindLabel[i.kind]} · {i.text.slice(0, 80)}</option>)}</select></label><small className="muted">从项目灵感中选择；需要时可先从总库引用卡片。</small>{project.shotSources.filter(s => s.shotId === shot.id).map((s, i) => <div className="source-panel" key={s.id ?? i}><p>{s.excerpt}</p>{!s.ideaId && <small>原项目卡片已移除，保留来源摘录</small>}{s.id && <button className="quiet" disabled={busy} onClick={() => void onRun(() => window.watercut.removeShotSource(project.directory, shot.id, s.id!))}>移除来源</button>}</div>)}
    </>}
  </aside>;
}
