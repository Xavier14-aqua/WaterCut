import { useEffect, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, ConnectionMode, addEdge, useEdgesState, useNodesState, type Connection, type Edge, type Node, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { BoardHandle, Project } from './project';

const handlePositions: Array<{ id: BoardHandle; position: Position }> = [
  { id: 'top', position: Position.Top }, { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom }, { id: 'left', position: Position.Left },
];
function IdeaNode({ data }: NodeProps<Node<{ label: string }>>) {
  return <div className="idea-node"><span>{data.label}</span>{handlePositions.map(handle =>
    <Handle key={handle.id} id={handle.id} type="source" position={handle.position} />)}</div>;
}
const nodeTypes = { idea: IdeaNode };

export function IdeaBoard({ project, busy, onMove, onConnect, onDisconnect }: {
  project: Project;
  busy: boolean;
  onMove: (id: string, x: number, y: number) => void;
  onConnect: (source: string, target: string, sourceHandle: BoardHandle, targetHandle: BoardHandle) => void;
  onDisconnect: (id: string) => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  useEffect(() => {
    setNodes(project.ideas.map(idea => ({
      id: idea.id,
      type: 'idea',
      position: { x: idea.x, y: idea.y },
      data: { label: idea.text.slice(0, 100) || '空白灵感' },
    })));
    setEdges(project.boardEdges.map(edge => ({ ...edge, interactionWidth: 30 })));
    setSelectedEdgeId(current => current && project.boardEdges.some(edge => edge.id === current) ? current : null);
  }, [project.directory, project.ideas, project.boardEdges, setNodes, setEdges]);
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
  function deleteEdge(id: string) { if (busy) return; onDisconnect(id); setSelectedEdgeId(null); }
  return <div className="board-wrap">
    <div className="idea-board" aria-label="灵感白板"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} connectionMode={ConnectionMode.Loose} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      onNodeDragStop={(_event, node) => onMove(node.id, node.position.x, node.position.y)}
      onConnect={connect} onEdgeClick={(_event, edge) => setSelectedEdgeId(project.boardEdges.some(item => item.id === edge.id) ? edge.id : null)} onPaneClick={() => setSelectedEdgeId(null)}
      fitView deleteKeyCode={null} nodesConnectable nodesDraggable>
      <Background /><Controls />
    </ReactFlow></div>
    {project.boardEdges.length > 0 && <div className="board-edge-list"><strong>连线 · {project.boardEdges.length}</strong>
      {selectedEdgeId && <button className="danger" disabled={busy} onClick={() => deleteEdge(selectedEdgeId)}>删除选中连线</button>}
      {project.boardEdges.map(edge => <div className={edge.id === selectedEdgeId ? 'board-edge-item selected' : 'board-edge-item'} key={edge.id}>
        <span title={`${project.ideas.find(idea => idea.id === edge.source)?.text || '已删除卡片'} → ${project.ideas.find(idea => idea.id === edge.target)?.text || '已删除卡片'}`}>
          {(project.ideas.find(idea => idea.id === edge.source)?.text || '已删除卡片').slice(0, 18)}（{edge.sourceHandle}）→ {(project.ideas.find(idea => idea.id === edge.target)?.text || '已删除卡片').slice(0, 18)}（{edge.targetHandle}）
        </span><button className="secondary" disabled={busy} onClick={() => deleteEdge(edge.id)}>删除</button></div>)}
    </div>}
  </div>;
}
