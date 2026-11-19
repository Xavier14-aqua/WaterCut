import { useEffect, useState } from 'react';
import type { IdeaBox, IdeaBoxInput, ResourceDrag } from '../shared/models';
export type IdeaLayout = 'flat' | 'boxed';
export function IdeaLayoutSwitch({
  layout,
  busy,
  onLayout
}: {
  layout: IdeaLayout;
  busy: boolean;
  onLayout: (layout: IdeaLayout) => void;
}) {
  return <div className="idea-layout-switch segmented" aria-label="灵感显示方式"><button type="button" className={layout === 'flat' ? 'active' : ''} aria-pressed={layout === 'flat'} disabled={busy} onClick={() => onLayout('flat')}>全部平铺</button><button type="button" className={layout === 'boxed' ? 'active' : ''} aria-pressed={layout === 'boxed'} disabled={busy} onClick={() => onLayout('boxed')}>收纳盒与未收纳</button></div>;
}
function savedLayout(scopeKey: string): IdeaLayout {
  try {
    return localStorage.getItem(`watercut:idea-layout:${scopeKey}`) === 'boxed' ? 'boxed' : 'flat';
  } catch {
    return 'flat';
  }
}
export function useIdeaBoxView(scopeKey: string) {
  const [state, setState] = useState(() => ({
    scopeKey,
    layout: savedLayout(scopeKey),
    openedBox: null as string | null
  }));
  const current = state.scopeKey === scopeKey ? state : {
    scopeKey,
    layout: savedLayout(scopeKey),
    openedBox: null
  };
  useEffect(() => {
    setState(old => old.scopeKey === scopeKey ? old : {
      scopeKey,
      layout: savedLayout(scopeKey),
      openedBox: null
    });
  }, [scopeKey]);
  return {
    ...current,
    setLayout: (layout: IdeaLayout) => {
      try {
        localStorage.setItem(`watercut:idea-layout:${scopeKey}`, layout);
      } catch {}
      setState({
        scopeKey,
        layout,
        openedBox: null
      });
    },
    openBox: (id: string | null) => setState({
      ...current,
      layout: 'boxed',
      openedBox: id
    })
  };
}
export function IdeaBoxOrganizer({
  scope,
  scopeId,
  boxes,
  counts,
  layout,
  openedBox,
  selected,
  busy,
  onOpen,
  onSave,
  onDelete,
  onMove,
  onClear
}: {
  scope: 'library' | 'project';
  scopeId: string;
  boxes: IdeaBox[];
  counts: Record<string, number>;
  layout: IdeaLayout;
  openedBox: string | null;
  selected: string[];
  busy: boolean;
  onOpen: (id: string | null) => void;
  onSave: (input: IdeaBoxInput) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onMove: (ids: string[], boxId: string | null) => Promise<boolean>;
  onClear: () => void;
}) {
  const active = boxes.find(b => b.id === openedBox),
    [name, setName] = useState(''),
    [target, setTarget] = useState(''),
    [dragTarget, setDragTarget] = useState<string | null>(null);
  useEffect(() => {
    setName(active?.name ?? '');
  }, [active?.id, active?.name]);
  useEffect(() => {
    if (!boxes.some(b => b.id === target)) setTarget('');
  }, [boxes, target]);
  useEffect(() => {
    const stop = () => setDragTarget(null);
    window.addEventListener('dragend', stop);
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('dragend', stop);
      window.removeEventListener('blur', stop);
    };
  }, []);
  function dragOver(event: React.DragEvent, id: string) {
    if (busy || !event.dataTransfer.types.includes('application/x-watercut')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDragTarget(id);
  }
  function dragLeave(event: React.DragEvent) {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragTarget(null);
  }
  async function drop(event: React.DragEvent, id: string | null) {
    event.preventDefault();
    event.stopPropagation();
    setDragTarget(null);
    if (busy) return;
    let data: ResourceDrag;
    try {
      data = JSON.parse(event.dataTransfer.getData('application/x-watercut'));
    } catch {
      return;
    }
    if (data?.scope !== scope || data.kind !== 'idea' || data.scopeId !== scopeId || typeof data.id !== 'string') return;
    if (await onMove([data.id], id)) onClear();
  }
  async function move(ids: string[], id: string | null) {
    if (await onMove(ids, id)) onClear();
  }
  const unfiledDrop=<div className={`unfiled-heading ${dragTarget === 'unfiled' ? 'drop-active' : ''}`} onDragOver={e => dragOver(e, 'unfiled')} onDragLeave={dragLeave} onDrop={e => void drop(e, null)}><h3>{active?'移回未收纳':'未收纳'}</h3><small>{counts.unfiled ?? 0} 张符合筛选 · 拖到此处移出收纳盒</small></div>;
  return <div className="idea-organization" data-scope-id={scopeId}>
    <div className="idea-box-batch"><span>{selected.length} 张已选</span><select aria-label="所选灵感收纳到" value={target} disabled={busy || !boxes.length} onChange={e => setTarget(e.target.value)}><option value="">选择收纳盒…</option>{boxes.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select><button type="button" className="secondary" disabled={busy || !target || !selected.length} onClick={() => void move(selected, target)}>收纳所选</button><button type="button" className="quiet" disabled={busy || !selected.length} onClick={() => void move(selected, null)}>移出收纳盒</button>{!!selected.length && <button type="button" className="quiet" disabled={busy} onClick={onClear}>取消选择</button>}</div>
    {layout === 'boxed' && <>
      {active && <nav className="idea-box-breadcrumb" aria-label="收纳位置"><button type="button" className="quiet" disabled={busy} onClick={() => onOpen(null)}>全部收纳盒</button><span aria-hidden="true">/</span><strong>{active.name}</strong><small>{counts[active.id] ?? 0} 张符合筛选</small></nav>}
      <form className="idea-box-form" onSubmit={async event => {
        event.preventDefault();
        const ok = await onSave({
          id: active?.id,
          name
        });
        if (ok && !active) setName('');
      }}><label>{active ? '收纳盒名称' : '新收纳盒'}<input aria-label={active ? '收纳盒名称' : '新收纳盒名称'} value={name} maxLength={80} disabled={busy} placeholder="例如：开场备选、旅行片段" onChange={e => setName(e.target.value)} /></label><button type="submit" className="secondary" disabled={busy || !name.trim() || name.trim() === active?.name}>{active ? '重命名' : '新建收纳盒'}</button>{active && <button type="button" className="quiet danger-text" disabled={busy} onClick={async () => {
          if (window.confirm(`删除“${active.name}”收纳盒？里面的灵感会回到未收纳，不会删除卡片。`) && (await onDelete(active.id))) {
            onOpen(null);
            onClear();
          }
        }}>删除收纳盒</button>}</form>
      {!active && <><p className="idea-box-help muted">把卡片拖入收纳盒，或勾选后批量收纳。每张卡片归入一个盒子。</p>{!boxes.length ? <p className="idea-box-empty">还没有收纳盒，先给一组灵感取个名字。</p> : <div className="idea-box-grid">{boxes.map(box => <button type="button" data-box-id={box.id} key={box.id} className={`idea-box ${dragTarget === box.id ? 'drop-active' : ''}`} disabled={busy} onClick={() => onOpen(box.id)} onDragOver={e => dragOver(e, box.id)} onDragLeave={dragLeave} onDrop={e => void drop(e, box.id)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h7l2 2h9v11H3zM3 7V4h7l2 3" /></svg><span>{box.name}</span><small>{counts[box.id] ?? 0} 张</small></button>)}</div>}</>}{unfiledDrop}
    </>}
  </div>;
}
