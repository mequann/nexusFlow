import { ArrowRight, GitBranch, RotateCcw } from 'lucide-react';
import type { WorkflowEdge, WorkflowNode } from '../types';

interface WorkflowGraphViewProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  activeNodeIds?: string[];
}

export function WorkflowGraphView({ nodes, edges, activeNodeIds = [] }: WorkflowGraphViewProps) {
  const activeSet = new Set(activeNodeIds);

  return (
    <div className="dag-canvas">
      {nodes.map((node) => {
        const outgoing = edges.filter((e) => e.from === node.id);
        const isActive = activeSet.has(node.id);
        return (
          <div
            key={node.id}
            className={`dag-node ${isActive ? 'active' : ''} ${node.isCompensationHandler ? 'comp' : ''}`}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
              <span className="badge badge-blue">{node.type}</span>
              {node.stage && <span className="badge">{node.stage}</span>}
            </div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{node.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>id: {node.id}</div>

            {node.compensateNodeId && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  color: '#fcd34d',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <RotateCcw size={11} /> Saga undo: {node.compensateNodeId}
              </div>
            )}

            {outgoing.length > 0 && (
              <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                {outgoing.map((edge) => (
                  <div
                    key={edge.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                      fontSize: 11,
                      color: 'var(--muted)',
                      marginTop: 2,
                    }}
                  >
                    {edge.branch ? <GitBranch size={11} color="#06b6d4" /> : <ArrowRight size={11} />}
                    {edge.branch && <span style={{ color: '#67e8f9' }}>[{edge.branch}]</span>}
                    <span>→ {edge.to}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

