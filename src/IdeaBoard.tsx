import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, ConnectionMode, addEdge, useEdgesState, useNodesState, type Connection, type Edge, type Node, type NodeProps, type OnNodesChange, type OnEdgesChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { BoardHandle, Project } from './project';
import type { ResourceDrag } from './shared/models';
import { kindLabel, readResourceDrag, mediaUrl } from './components/Resources';
import { boardRegions } from './shared/board';
const handlePositions: Array<{
  id: BoardHandle;
  position: Position;
}> = [{
  id: 'top',
  position: Position.Top
}, {
  id: 'right',
  position: Position.Right
}, {
  id: 'bottom',
  position: Position.Bottom
}, {
  id: 'left',
  position: Position.Left
}];
function IdeaNode({
  data
}: NodeProps<Node<{
  label: string;
  kind: string;
  colors: string[];
  image?: string;
}>>) {
  return <div className={`idea-node ${data.kind}`}><div className="palette">{data.colors.map(c => <i key={c} style={{
        background: c
      }} />)}</div><small>{kindLabel[data.kind as keyof typeof kindLabel]}</small>{data.image && <img src={data.image} alt="参考图" />}<span>{data.label}</span>{handlePositions.map(handle => <Handle key={handle.id} id={handle.id} type="source" position={handle.position} />)}</div>;
}
const nodeTypes = {
  idea: IdeaNode,
  region: ({data}:NodeProps<Node<{label:string}>>) => <div className="board-region-label">{data.label}</div>
};
export function IdeaBoard({
  project,
  busy,
  onMove,
  onConnect,
  onDisconnect,
  selectedIds = [],
  onSelection,
  onPick,
  onDropResource,
  onLabel
}: {
  project: Project;
  busy: boolean;
  onMove: (id: string, x: number, y: number) => void;
  onConnect: (source: string, target: string, sourceHandle: BoardHandle, targetHandle: BoardHandle) => void;
  onDisconnect: (id: string) => void;
  selectedIds?: string[];
  onSelection?: (ids: string[]) => void;
  onPick?: (id: string) => void;
  onDropResource?: (resource: ResourceDrag, x: number, y: number) => void;
  onLabel?: (id: string, label: string) => void;
}) {
  const flow = useRef<any>(null);
  const [nodes, setNodes] = useNodesState<Node>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const onEdgesChange = useCallback<OnEdgesChange<Edge>>(changes => setEdges(current => changes.applyTo(current)), [setEdges]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const selectionRef = useRef(selectedIds);
  const selectionCallback = useRef(onSelection);
  const ideaIds = useRef(new Set(project.ideas.map(idea => idea.id)));
  selectionRef.current = selectedIds;
  selectionCallback.current = onSelection;
  ideaIds.current = new Set(project.ideas.map(idea => idea.id));
  // Selection is written back only for user-generated node changes. Mirroring
  // onSelectionChange into the parent and then back into nodes creates a loop
  // when the board mounts with an existing selection or the inspector rerenders.
  const onNodesChange = useCallback<OnNodesChange<Node>>(changes => {
    setNodes(current => changes.applyTo(current));
    const selection = new Set(selectionRef.current);
    for (const change of changes) {
      if (change.type !== 'select' || !ideaIds.current.has(change.id)) continue;
      if (change.selected) selection.add(change.id);
      else selection.delete(change.id);
    }
    const previous = selectionRef.current;
    if (selection.size === previous.length && previous.every(id => selection.has(id))) return;
    const next = [...selection];
    selectionRef.current = next;
    selectionCallback.current?.(next);
  }, [setNodes]);
  useEffect(() => {
    const regions:Node[]=boardRegions(project.ideas).map(region=>({id:`region:${region.name}`,type:'region',position:{x:region.x,y:region.y},data:{label:region.name},style:{width:region.width,height:region.height,pointerEvents:'none'},draggable:false,selectable:false,connectable:false,zIndex:-1}));
    setNodes([...regions,...project.ideas.map(idea => ({
      id: idea.id,
      type: 'idea',
      selected: selectedIds.includes(idea.id),
      position: {
        x: idea.x,
        y: idea.y
      },
      data: {
        label: idea.text.slice(0, 150) || '空白灵感',
        kind: idea.kind,
        colors: idea.payload.colors,
        image: idea.media.find(m => m.role === 'image') ? mediaUrl(project.id, idea.media.find(m => m.role === 'image')!.assetId) : undefined
      }
    }))]);
    setEdges(project.boardEdges.map(edge => ({
      ...edge,
      interactionWidth: 30,
      markerEnd: edge.kind === 'sequence' ? {
        type: 'arrowclosed' as any
      } : undefined,
      labelBgStyle: {
        fill: '#173139'
      },
      labelStyle: {
        fill: '#dcecf0'
      }
    })));
    setSelectedEdgeId(current => current && project.boardEdges.some(edge => edge.id === current) ? current : null);
  }, [project.directory, project.ideas, project.boardEdges, selectedIds, setNodes, setEdges]);
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (busy || !selectedEdgeId || event.key !== 'Delete') return;
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      event.preventDefault();
      onDisconnect(selectedEdgeId);
      setSelectedEdgeId(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, selectedEdgeId, onDisconnect]);
  function connect(connection: Connection) {
    if (!connection.source || !connection.target || connection.source === connection.target || !connection.sourceHandle || !connection.targetHandle) return;
    setEdges(current => addEdge(connection, current));
    onConnect(connection.source, connection.target, connection.sourceHandle as BoardHandle, connection.targetHandle as BoardHandle);
  }
  function deleteEdge(id: string) {
    if (busy) return;
    onDisconnect(id);
    setSelectedEdgeId(null);
  }
  return <div className="board-wrap">
    <div className="idea-board" aria-label="灵感白板" onDragOver={e => e.preventDefault()} onDrop={e => {
      e.preventDefault();
      if (busy) return;
      const resource = readResourceDrag(e);
      const point = flow.current?.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY
      }) ?? {
        x: 0,
        y: 0
      };
      if (resource) onDropResource?.(resource, point.x, point.y);
    }}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} connectionMode={ConnectionMode.Loose} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onInit={instance => {
        flow.current = instance;
      }} onNodeClick={(_event, node) => onPick?.(node.id)} selectionOnDrag onNodeDragStop={(_event, node) => onMove(node.id, node.position.x, node.position.y)} onConnect={connect} onEdgeClick={(_event, edge) => setSelectedEdgeId(project.boardEdges.some(item => item.id === edge.id) ? edge.id : null)} onPaneClick={() => setSelectedEdgeId(null)} fitView deleteKeyCode={null} nodesConnectable={!busy} nodesDraggable={!busy}>
      <Background /><Controls />
    </ReactFlow></div>
    {project.boardEdges.length > 0 && <div className="board-edge-list"><strong>连线 · {project.boardEdges.length}</strong>
      {selectedEdgeId && <button className="danger" disabled={busy} onClick={() => deleteEdge(selectedEdgeId)}>删除选中连线</button>}
      {project.boardEdges.map(edge => <div className={edge.id === selectedEdgeId ? 'board-edge-item selected' : 'board-edge-item'} key={edge.id}>
        <span title={`${project.ideas.find(idea => idea.id === edge.source)?.text || '已删除卡片'} → ${project.ideas.find(idea => idea.id === edge.target)?.text || '已删除卡片'}`}>
          {(project.ideas.find(idea => idea.id === edge.source)?.text || '已删除卡片').slice(0, 18)}（{edge.sourceHandle}）→ {(project.ideas.find(idea => idea.id === edge.target)?.text || '已删除卡片').slice(0, 18)}（{edge.targetHandle}）
        </span><input key={edge.id + edge.label} aria-label="转场或关联说明" placeholder="转场 / 衔接想法…" defaultValue={edge.label} disabled={busy} onBlur={e => {
          if (e.target.value !== edge.label) onLabel?.(edge.id, e.target.value);
        }} /><button className="secondary" disabled={busy} onClick={() => deleteEdge(edge.id)}>删除</button></div>)}
    </div>}
  </div>;
}
