import { ArrowRight, GitBranch, RotateCcw } from 'lucide-react';
import type { WorkflowEdge, WorkflowNode } from '../types';

interface WorkflowGraphViewProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  activeNodeIds?: string[];
  completedNodeIds?: string[];
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
}

export function computeAutoLayout(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (adj.has(e.from) && inDegree.has(e.to)) {
      adj.get(e.from)!.push(e.to);
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    }
  }

  const level = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0 && !n.isCompensationHandler) {
      level.set(n.id, 0);
      queue.push(n.id);
    }
  }

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currLvl = level.get(curr) ?? 0;
    for (const nxt of adj.get(curr) ?? []) {
      level.set(nxt, Math.max(level.get(nxt) ?? 0, currLvl + 1));
      inDegree.set(nxt, (inDegree.get(nxt) ?? 1) - 1);
      if ((inDegree.get(nxt) ?? 0) <= 0) {
        queue.push(nxt);
      }
    }
  }

  const lanes = new Map<number, WorkflowNode[]>();
  for (const n of nodes) {
    const lvl = n.isCompensationHandler ? 99 : (level.get(n.id) ?? 0);
    const list = lanes.get(lvl) ?? [];
    list.push(n);
    lanes.set(lvl, list);
  }

  const sortedLevels = [...lanes.keys()].sort((a, b) => a - b);
  sortedLevels.forEach((lvl, colIdx) => {
    const colNodes = lanes.get(lvl) ?? [];
    colNodes.forEach((node, rowIdx) => {
      positions[node.id] = {
        x: 36 + colIdx * 265,
        y: 36 + rowIdx * 155,
      };
    });
  });

  return positions;
}

export function WorkflowGraphView({
  nodes,
  edges,
  activeNodeIds = [],
  completedNodeIds = [],
  selectedNodeId = null,
  onSelectNode,
}: WorkflowGraphViewProps) {
  const activeSet = new Set(activeNodeIds);
  const completedSet = new Set(completedNodeIds);
  const autoPos = computeAutoLayout(nodes, edges);

  const getPos = (n: WorkflowNode) => n.position ?? autoPos[n.id] ?? { x: 40, y: 40 };

  const maxX = Math.max(960, ...nodes.map((n) => getPos(n).x + 280));
  const maxY = Math.max(420, ...nodes.map((n) => getPos(n).y + 180));

  return (
    <div className="canvas-board" style={{ minHeight: 420 }}>
      <div className="canvas-inner" style={{ width: maxX, height: maxY }}>
        <svg
          width={maxX}
          height={maxY}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          <defs>
            <marker
              id="nf-arrow"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 Z" fill="#64748b" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const fromNode = nodes.find((n) => n.id === edge.from);
            const toNode = nodes.find((n) => n.id === edge.to);
            if (!fromNode || !toNode) return null;
            const p1 = getPos(fromNode);
            const p2 = getPos(toNode);
            const x1 = p1.x + 224;
            const y1 = p1.y + 52;
            const x2 = p2.x;
            const y2 = p2.y + 52;
            const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
            const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            return (
              <g key={edge.id}>
                <path
                  d={d}
                  fill="none"
                  stroke={edge.branch ? '#06b6d4' : '#64748b'}
                  strokeWidth={2}
                  markerEnd="url(#nf-arrow)"
                />
                {edge.branch && (
                  <text
                    x={mx}
                    y={my - 6}
                    textAnchor="middle"
                    fill="#67e8f9"
                    fontSize={11}
                    fontWeight={700}
                  >
                    {edge.branch}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {nodes.map((node) => {
          const pos = getPos(node);
          const isActive = activeSet.has(node.id);
          const isCompleted = completedSet.has(node.id);
          const outgoing = edges.filter((e) => e.from === node.id);
          return (
            <div
              key={node.id}
              onClick={() => onSelectNode?.(node.id)}
              className={`canvas-node ${selectedNodeId === node.id ? 'selected' : ''} ${
                isActive ? 'active' : ''
              } ${isCompleted ? 'completed' : ''} ${
                node.isCompensationHandler ? 'comp' : ''
              }`}
              style={{ left: pos.x, top: pos.y, cursor: onSelectNode ? 'pointer' : 'default' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
                <span className="badge badge-blue">{node.type}</span>
                {node.stage && <span className="badge">{node.stage}</span>}
              </div>
              <div style={{ fontWeight: 700, fontSize: 13 }}>{node.name}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                id: {node.id}
                {outgoing.length > 1 && ' · Parallel/Branch'}
              </div>
              {node.compensateNodeId && (
                <div style={{ marginTop: 5, fontSize: 11, color: '#fcd34d', display: 'flex', gap: 4 }}>
                  <RotateCcw size={11} /> Saga: {node.compensateNodeId}
                </div>
              )}
              {outgoing.length > 0 && (
                <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted)' }}>
                  {outgoing.map((e) => (
                    <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {e.branch ? <GitBranch size={10} color="#06b6d4" /> : <ArrowRight size={10} />}
                      <span>{e.branch ? `[${e.branch}] → ${e.to}` : `→ ${e.to}`}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
