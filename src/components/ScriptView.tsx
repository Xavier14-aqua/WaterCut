import { useState } from 'react';
import type { Project, ScriptBlock, Shot } from '../shared/models';
import { scriptSections, moveScriptItems, type ScriptSection } from '../shared/script';
const dragType = 'application/x-watercut-script';
function Grip() {
  return <svg className="drag-grip" viewBox="0 0 16 20" aria-hidden="true"><path d="M5 4h.01M11 4h.01M5 10h.01M11 10h.01M5 16h.01M11 16h.01" /></svg>;
}
export function ScriptView({
  project,
  busy,
  onAdd,
  onPatchBlock,
  onPatchShot,
  onConvert,
  onDelete,
  onSplit,
  onMerge,
  onSection,
  onParagraph,
  onReorder
}: {
  project: Project;
  busy: boolean;
  onAdd: (kind: ScriptBlock['kind']) => void;
  onPatchBlock: (block: ScriptBlock, text: string) => void;
  onPatchShot: (shot: Shot, patch: Partial<Shot>) => void;
  onConvert: (ids: string[]) => void;
  onDelete: (id: string) => void;
  onSplit: (id: string, offset: number) => void;
  onMerge: (first: string, second: string) => void;
  onSection: (beforeId?: string) => void;
  onParagraph: (sectionId: string | null) => void;
  onReorder: (ids: string[]) => void;
}) {
  const [mode, setMode] = useState<'document' | 'columns'>('document'),
    [dragging, setDragging] = useState<string | null>(null),
    sections = scriptSections(project.scriptBlocks);
  function drag(event: React.DragEvent, kind: 'block' | 'section', id: string) {
    if (busy) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(dragType, JSON.stringify({
      kind,
      id
    }));
    event.dataTransfer.effectAllowed = 'move';
    setDragging(id);
  }
  function drop(event: React.DragEvent, target: string, after = false, section?: ScriptSection) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(null);
    if (busy) return;
    try {
      const data = JSON.parse(event.dataTransfer.getData(dragType));
      if (!['block', 'section'].includes(data.kind) || typeof data.id !== 'string') return;
      const source = sections.find(s => s.id === data.id),
        moving = data.kind === 'section' && source?.heading ? [source.id, ...source.blocks.map(b => b.id)] : data.kind === 'block' && project.scriptBlocks.some(b => b.id === data.id && b.kind !== 'heading') ? [data.id] : [];
      if (data.kind === 'section' && section) {
        if (!section.heading) return;
        target = after ? section.blocks.at(-1)?.id ?? section.id : section.id;
      }
      const ids = moveScriptItems(project.scriptBlocks, moving, target, after);
      if (ids.some((id, i) => id !== project.scriptBlocks[i].id)) onReorder(ids);
    } catch {}
  }
  function move(block: ScriptBlock, other: ScriptBlock, after: boolean) {
    onReorder(moveScriptItems(project.scriptBlocks, [block.id], other.id, after));
  }
  return <section className="script-view"><div className="section-heading"><h1>把故事写顺</h1><div className="segmented"><button className={mode === 'document' ? 'active' : ''} onClick={() => setMode('document')}>文档</button><button className={mode === 'columns' ? 'active' : ''} onClick={() => setMode('columns')}>画面 / 声音</button></div></div><p className="muted">用标题组织草稿。段落可拖动或用上移、下移调整；关联镜头的顺序会同步更新。</p><div className="toolbar"><button disabled={busy} onClick={() => onAdd('body')}>+ 正文段落</button><button className="secondary" disabled={busy} onClick={() => onSection()}>+ 标题</button><button className="secondary" disabled={busy || !project.scriptBlocks.some(b => !b.shotId && b.kind === 'body' && b.text.trim())} onClick={() => onConvert(project.scriptBlocks.filter(b => !b.shotId && b.kind === 'body' && b.text.trim()).map(b => b.id))}>正文转为镜头</button></div>
    {!sections.length && <div className="empty-state">创建一个标题，或先写一段旁白，再补充章节。</div>}
    <div className={mode === 'document' ? 'document-editor sectioned-script' : 'av-editor sectioned-script'}>{sections.map((section, sectionIndex) => <section key={section.id} className={`script-section ${dragging === section.id ? 'dragging' : ''}`} data-section-id={section.id} onDragOver={e => e.preventDefault()} onDrop={e => {
        const last = section.blocks.at(-1)?.id ?? section.heading?.id;
        if (last) drop(e, last, true, section);
      }}>
      <header className="script-section-heading" onDragOver={e => e.preventDefault()} onDrop={e => {
          if (section.heading) drop(e, section.id, false, section);
        }}>{section.heading ? <><button className="quiet script-drag-handle" aria-label={`拖动标题分组 ${section.heading.text || '未命名标题'}`} draggable={!busy} disabled={busy} onDragStart={e => drag(e, 'section', section.id)} onDragEnd={() => setDragging(null)}><Grip /></button><input aria-label="章节标题" placeholder="章节标题" value={section.heading.text} disabled={busy} onChange={e => onPatchBlock(section.heading!, e.target.value)} /><div className="script-move-actions"><button className="quiet" aria-label="上移标题分组" disabled={busy || sectionIndex === 0 || !sections[sectionIndex - 1].heading} onClick={() => onReorder(moveScriptItems(project.scriptBlocks, [section.id, ...section.blocks.map(b => b.id)], sections[sectionIndex - 1].id, false))}>上移</button><button className="quiet" aria-label="下移标题分组" disabled={busy || sectionIndex === sections.length - 1} onClick={() => {
                const next = sections[sectionIndex + 1];
                onReorder(moveScriptItems(project.scriptBlocks, [section.id, ...section.blocks.map(b => b.id)], next.blocks.at(-1)?.id ?? next.id, true));
              }}>下移</button><button className="quiet" disabled={busy} onClick={() => {
                if (window.confirm('只移除标题，段落保留并归入前一组？')) onDelete(section.id);
              }}>移除标题</button></div></> : <><h2>未分组正文</h2><button className="quiet" disabled={busy} onClick={() => onSection(section.blocks[0]?.id)}>添加标题</button></>}</header>
      <div className="script-section-body">{section.blocks.map((block, index) => {
            const shot = project.shots.find(s => s.id === block.shotId),
              next = section.blocks[index + 1];
            return <article key={block.id} className={`script-block ${block.kind} ${dragging === block.id ? 'dragging' : ''}`} data-block-id={block.id} onDragOver={e => e.preventDefault()} onDrop={e => {
              const bounds = e.currentTarget.getBoundingClientRect();
              drop(e, block.id, e.clientY > bounds.y + bounds.height / 2);
            }}>
        <div className="script-block-caption"><span>{shot ? `镜头 ${shot.position + 1}` : block.kind === 'note' ? '备注' : '草稿段落'}</span><div className="script-move-actions"><button className="quiet script-drag-handle" aria-label="拖动段落" draggable={!busy} disabled={busy} onDragStart={e => drag(e, 'block', block.id)} onDragEnd={() => setDragging(null)}><Grip /></button><button className="quiet" aria-label="上移段落" disabled={busy || index === 0} onClick={() => move(block, section.blocks[index - 1], false)}>上移</button><button className="quiet" aria-label="下移段落" disabled={busy || index === section.blocks.length - 1} onClick={() => move(block, section.blocks[index + 1], true)}>下移</button>{block.kind === 'body' && <button className="quiet" disabled={busy || (shot?.actionDialogue ?? block.text).length < 2} onClick={e => {
                    const input = e.currentTarget.closest('.script-block')?.querySelector('.av-sound textarea') as HTMLTextAreaElement | null;
                    onSplit(block.id, input?.selectionStart ?? 0);
                  }}>光标处拆分</button>}{block.kind === 'body' && next?.kind === 'body' && !!block.shotId === !!next.shotId && <button className="quiet" disabled={busy} onClick={() => onMerge(block.id, next.id)}>合并下一段</button>}{!shot && block.kind === 'body' && <button className="quiet" disabled={busy || !block.text.trim()} onClick={() => onConvert([block.id])}>转为镜头</button>}<button className="quiet danger-text" disabled={busy} onClick={() => {
                    if (window.confirm(shot ? '删除段落和关联镜头？素材原件会保留。' : '删除此段落？')) onDelete(block.id);
                  }}>删除</button></div></div>
        {mode === 'columns' && <label className="av-picture">画面<textarea disabled={busy || !shot} placeholder={shot ? '填写画面描述' : '转成镜头后可填写画面'} value={shot?.description ?? ''} onChange={e => shot && onPatchShot(shot, {
                  description: e.target.value
                })} /></label>}
        <label className="av-sound">{mode === 'columns' ? '动作 / 对白' : ''}<textarea aria-label={shot ? `镜头${shot.position + 1}脚本` : '脚本文字'} disabled={busy} value={shot?.actionDialogue ?? block.text} placeholder="写下一段话…" onChange={e => shot ? onPatchShot(shot, {
                  actionDialogue: e.target.value
                }) : onPatchBlock(block, e.target.value)} /></label>
      </article>;
          })}{!section.blocks.length && <p className="script-drop-empty">拖入段落，或添加草稿。</p>}</div><button className="quiet add-section-paragraph" disabled={busy} onClick={() => onParagraph(section.heading?.id ?? null)}>+ 草稿段落</button>
    </section>)}</div>
  </section>;
}
