import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  GitBranch,
  LayoutGrid,
  Link2,
  Play,
  Plus,
  Save,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import type {
  ConnectorDescriptor,
  MaskedCredential,
  WorkflowEdge,
  WorkflowNode,
  WorkflowRecord,
} from '../types';
import { computeAutoLayout } from './WorkflowGraphView';

interface WorkflowDesignerProps {
  connectors: ConnectorDescriptor[];
  credentials: MaskedCredential[];
  workflows: WorkflowRecord[];
  editingWorkflow: WorkflowRecord | null;
  onSaveDraft: (payload: {
    id?: string;
    key: string;
    name: string;
    description: string;
    definition: WorkflowRecord['definition'];
    webhookSecret?: string;
  }) => Promise<WorkflowRecord>;
  onPublish: (id: string) => Promise<void>;
  onLaunch: (key: string) => void;
}

const DEFAULT_NODES: WorkflowNode[] = [
  {
    id: 'start',
    name: 'Manual Intake',
    type: 'trigger.manual',
    stage: 'Intake',
    position: { x: 40, y: 180 },
    config: {},
  },
  {
    id: 'parallel_fork',
    name: 'Parallel Processing',
    type: 'logic.parallel',
    stage: 'Processing',
    position: { x: 310, y: 180 },
    config: {},
  },
  {
    id: 'branch_api',
    name: 'Enrich Payload',
    type: 'action.transform',
    stage: 'Processing',
    position: { x: 590, y: 80 },
    config: { mapping: { enriched: true, timestamp: '{{ $now() }}' } },
  },
  {
    id: 'branch_approval',
    name: 'Manager Approval',
    type: 'kissflow.approval_matrix',
    stage: 'Approval',
    position: { x: 590, y: 270 },
    config: {
      rules: [
        {
          when: '$vars.amount >= 1000',
          title: 'Approve Request ({{ $vars.amount }})',
          candidateGroup: 'finance',
          requiredApprovals: 1,
          slaMinutes: 60,
        },
      ],
      defaultRule: {
        title: 'Standard Approval',
        candidateGroup: 'ops',
        requiredApprovals: 1,
      },
    },
  },
  {
    id: 'parallel_join',
    name: 'Join Branches',
    type: 'logic.join',
    stage: 'Completion',
    position: { x: 870, y: 180 },
    config: {},
  },
  {
    id: 'end',
    name: 'Workflow Complete',
    type: 'bpmn.end',
    stage: 'Done',
    position: { x: 1130, y: 180 },
    config: {},
  },
];

const DEFAULT_EDGES: WorkflowEdge[] = [
  { id: 'e1', from: 'start', to: 'parallel_fork' },
  { id: 'e2', from: 'parallel_fork', to: 'branch_api' },
  { id: 'e3', from: 'parallel_fork', to: 'branch_approval' },
  { id: 'e4', from: 'branch_api', to: 'parallel_join' },
  { id: 'e5', from: 'branch_approval', to: 'parallel_join' },
  { id: 'e6', from: 'parallel_join', to: 'end' },
];

export function WorkflowDesigner({
  connectors,
  credentials,
  workflows,
  editingWorkflow,
  onSaveDraft,
  onPublish,
  onLaunch,
}: WorkflowDesignerProps) {
  const [draftId, setDraftId] = useState<string | undefined>(
    editingWorkflow?.status === 'DRAFT' ? editingWorkflow.id : undefined,
  );
  const [wfKey, setWfKey] = useState(editingWorkflow?.key ?? 'hybrid-parallel-flow');
  const [wfName, setWfName] = useState(editingWorkflow?.name ?? 'Hybrid Sequential & Parallel Flow');
  const [wfDescription, setWfDescription] = useState(
    editingWorkflow?.description ?? 'Designed visually with NexusFlow Drag-and-Drop Studio',
  );
  const [webhookSecret, setWebhookSecret] = useState('');
  const [sagaEnabled, setSagaEnabled] = useState<boolean>(
    editingWorkflow?.definition.sagaEnabled ?? true,
  );

  const initialAuto = useMemo(
    () =>
      editingWorkflow
        ? computeAutoLayout(editingWorkflow.definition.nodes, editingWorkflow.definition.edges)
        : {},
    [editingWorkflow],
  );

  const [nodes, setNodes] = useState<WorkflowNode[]>(() =>
    editingWorkflow
      ? editingWorkflow.definition.nodes.map((n) => ({
          ...n,
          position: n.position ?? initialAuto[n.id] ?? { x: 40, y: 40 },
        }))
      : DEFAULT_NODES,
  );
  const [edges, setEdges] = useState<WorkflowEdge[]>(
    editingWorkflow ? editingWorkflow.definition.edges : DEFAULT_EDGES,
  );

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(nodes[0]?.id ?? null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [insertMenuEdge, setInsertMenuEdge] = useState<{
    edgeId: string;
    x: number;
    y: number;
  } | null>(null);

  const [wiringFromId, setWiringFromId] = useState<string | null>(null);
  const [mouseCanvasPos, setMouseCanvasPos] = useState<{ x: number; y: number } | null>(null);
  const [paletteSearch, setPaletteSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // Non-snapping JSON draft buffer for the right-side Config editor
  const [configText, setConfigText] = useState<string>(() =>
    JSON.stringify(nodes[0]?.config ?? {}, null, 2),
  );
  const [configJsonError, setConfigJsonError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragNodeRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setWiringFromId(null);
        setInsertMenuEdge(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const selectNode = (node: WorkflowNode | null) => {
    setSelectedNodeId(node?.id ?? null);
    setSelectedEdgeId(null);
    setInsertMenuEdge(null);
    setConfigText(JSON.stringify(node?.config ?? {}, null, 2));
    setConfigJsonError(null);
  };

  const filteredConnectors = connectors.filter(
    (c) =>
      c.title.toLowerCase().includes(paletteSearch.toLowerCase()) ||
      c.type.toLowerCase().includes(paletteSearch.toLowerCase()),
  );

  const createDefaultConfig = (type: string): Record<string, unknown> => {
    if (type === 'trigger.webhook') return { path: `${wfKey}/hook` };
    if (type === 'trigger.cron') return { expression: '*/5 * * * *' };
    if (type === 'action.http') return { url: 'https://httpbin.org/post', method: 'POST', body: {} };
    if (type === 'action.transform') return { mapping: { processedAt: '{{ $now() }}' } };
    if (type === 'action.script') return { assignments: { score: '100' } };
    if (type === 'logic.if') return { condition: '$vars.amount >= 1000' };
    if (type === 'logic.switch') return { expression: '$vars.region' };
    if (type === 'logic.for_each') return { items: '{{ $vars.items }}', itemVar: 'item', map: '{{ $vars.item }}' };
    if (type === 'bpmn.user_task') return { title: 'Review Request', candidateGroup: 'ops', requiredApprovals: 1 };
    if (type === 'kissflow.approval_matrix') {
      return {
        rules: [{ when: '$vars.amount >= 1000', candidateGroup: 'finance', requiredApprovals: 1, slaMinutes: 60 }],
        defaultRule: { candidateGroup: 'ops', requiredApprovals: 1 },
      };
    }
    if (type === 'bpmn.timer') return { delayMs: 5000 };
    if (type === 'bpmn.message_catch') return { messageName: 'order.paid', correlationKey: '{{ $vars.orderId }}' };
    if (type === 'bpmn.external_task') return { topic: 'external.erp_sync', retries: 3 };
    if (type === 'bpmn.call_activity') return { workflowKey: 'procurement-capex-approval' };
    if (type.startsWith('external.')) return { topic: type, retries: 3 };
    return {};
  };

  const makeUniqueId = (type: string, currentNodes: WorkflowNode[]): string => {
    const cleanPrefix = type.replace(/[^a-zA-Z0-9]/g, '_');
    let counter = currentNodes.length + 1;
    let id = `${cleanPrefix}_${counter}`;
    while (currentNodes.some((n) => n.id === id)) {
      counter += 1;
      id = `${cleanPrefix}_${counter}`;
    }
    return id;
  };

  const addNodeAt = (connector: ConnectorDescriptor, x: number, y: number, connectFromId?: string) => {
    const newId = makeUniqueId(connector.type, nodes);
    const newConfig = createDefaultConfig(connector.type);
    const newNode: WorkflowNode = {
      id: newId,
      name: connector.title,
      type: connector.type,
      stage: connector.category === 'trigger' ? 'Intake' : 'Execution',
      position: { x: Math.max(16, Math.round(x)), y: Math.max(16, Math.round(y)) },
      config: newConfig,
    };

    setNodes((prev) => [...prev, newNode]);
    selectNode(newNode);

    if (connectFromId) {
      const src = nodes.find((n) => n.id === connectFromId);
      const branch = src?.type === 'logic.if' ? 'true' : undefined;
      setEdges((prev) => [
        ...prev,
        { id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, from: connectFromId, to: newId, branch },
      ]);
    }
  };

  /**
   * Inserts a new node sequentially in the middle of an existing edge (`from -> to` becomes `from -> newNode -> to`).
   */
  const insertNodeOnEdge = (edgeId: string, connector: ConnectorDescriptor) => {
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const fromNode = nodes.find((n) => n.id === edge.from);
    const toNode = nodes.find((n) => n.id === edge.to);
    const p1 = fromNode?.position ?? { x: 40, y: 40 };
    const p2 = toNode?.position ?? { x: p1.x + 280, y: p1.y };

    const newId = makeUniqueId(connector.type, nodes);
    const newNode: WorkflowNode = {
      id: newId,
      name: connector.title,
      type: connector.type,
      stage: fromNode?.stage ?? 'Execution',
      position: { x: Math.round((p1.x + p2.x) / 2), y: Math.round((p1.y + p2.y) / 2) },
      config: createDefaultConfig(connector.type),
    };

    const nextNodes = [...nodes, newNode];
    const nextEdges = [
      ...edges.filter((e) => e.id !== edgeId),
      { id: `e_${Date.now()}_a`, from: edge.from, to: newId, branch: edge.branch, condition: edge.condition },
      { id: `e_${Date.now()}_b`, from: newId, to: edge.to },
    ];

    const autoPos = computeAutoLayout(nextNodes, nextEdges);
    setNodes(nextNodes.map((n) => ({ ...n, position: autoPos[n.id] ?? n.position })));
    setEdges(nextEdges);
    setInsertMenuEdge(null);
    selectNode(newNode);
  };

  /**
   * Inserts a parallel branch alongside an existing edge (`from -> [to, newParallelNode] -> join`).
   */
  const addParallelBranchOnEdge = (edgeId: string) => {
    const edge = edges.find((e) => e.id === edgeId);
    if (!edge) return;
    const ts = Date.now().toString(36).slice(-4);
    const forkId = `parallel_${ts}`;
    const sibId = `parallel_step_${ts}`;
    const joinId = `join_${ts}`;

    const forkNode: WorkflowNode = {
      id: forkId,
      name: 'Parallel Fork',
      type: 'logic.parallel',
      stage: 'Parallel',
      config: {},
    };
    const sibNode: WorkflowNode = {
      id: sibId,
      name: 'Parallel Branch Task',
      type: 'action.transform',
      stage: 'Parallel',
      config: createDefaultConfig('action.transform'),
    };
    const joinNode: WorkflowNode = {
      id: joinId,
      name: 'Parallel Join',
      type: 'logic.join',
      stage: 'Parallel',
      config: {},
    };

    // Wrap target node inside fork -> [target, sibNode] -> join, keeping downstream edges intact
    const downstreamFromTarget = edges.filter((e) => e.from === edge.to);
    const otherEdges = edges.filter((e) => e.id !== edgeId && e.from !== edge.to);

    const nextNodes = [...nodes, forkNode, sibNode, joinNode];
    const nextEdges: WorkflowEdge[] = [
      ...otherEdges,
      { id: `e_${ts}_in`, from: edge.from, to: forkId, branch: edge.branch, condition: edge.condition },
      { id: `e_${ts}_f1`, from: forkId, to: edge.to },
      { id: `e_${ts}_f2`, from: forkId, to: sibId },
      { id: `e_${ts}_j1`, from: edge.to, to: joinId },
      { id: `e_${ts}_j2`, from: sibId, to: joinId },
      ...downstreamFromTarget.map((de, idx) => ({ ...de, id: `e_${ts}_out_${idx}`, from: joinId })),
    ];

    const autoPos = computeAutoLayout(nextNodes, nextEdges);
    setNodes(nextNodes.map((n) => ({ ...n, position: autoPos[n.id] ?? n.position })));
    setEdges(nextEdges);
    setInsertMenuEdge(null);
    selectNode(sibNode);
  };

  const insertParallelBlock = () => {
    const base = selectedNode?.position ?? { x: 260, y: 180 };
    const ts = Date.now().toString(36).slice(-4);
    const forkId = `parallel_${ts}`;
    const b1Id = `branch_a_${ts}`;
    const b2Id = `branch_b_${ts}`;
    const joinId = `join_${ts}`;

    const newNodes: WorkflowNode[] = [
      {
        id: forkId,
        name: 'Parallel Fork',
        type: 'logic.parallel',
        stage: 'Parallel Stage',
        position: { x: base.x + 250, y: base.y },
        config: {},
      },
      {
        id: b1Id,
        name: 'Parallel HTTP Task',
        type: 'action.http',
        stage: 'Parallel Stage',
        position: { x: base.x + 510, y: Math.max(20, base.y - 105) },
        config: createDefaultConfig('action.http'),
      },
      {
        id: b2Id,
        name: 'Parallel Approval',
        type: 'bpmn.user_task',
        stage: 'Parallel Stage',
        position: { x: base.x + 510, y: base.y + 105 },
        config: createDefaultConfig('bpmn.user_task'),
      },
      {
        id: joinId,
        name: 'Parallel Join',
        type: 'logic.join',
        stage: 'Parallel Stage',
        position: { x: base.x + 770, y: base.y },
        config: {},
      },
    ];

    const newEdges: WorkflowEdge[] = [
      ...(selectedNode ? [{ id: `e_${ts}_0`, from: selectedNode.id, to: forkId }] : []),
      { id: `e_${ts}_1`, from: forkId, to: b1Id },
      { id: `e_${ts}_2`, from: forkId, to: b2Id },
      { id: `e_${ts}_3`, from: b1Id, to: joinId },
      { id: `e_${ts}_4`, from: b2Id, to: joinId },
    ];

    setNodes((prev) => [...prev, ...newNodes]);
    setEdges((prev) => [...prev, ...newEdges]);
    selectNode(newNodes[0]!);
  };

  const applyAutoLayout = () => {
    const pos = computeAutoLayout(nodes, edges);
    setNodes((prev) => prev.map((n) => ({ ...n, position: pos[n.id] ?? n.position })));
  };

  const handleCanvasDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const connectorType = e.dataTransfer.getData('application/nexusflow-connector');
    if (!connectorType || !canvasRef.current) return;
    const connector = connectors.find((c) => c.type === connectorType);
    if (!connector) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left + canvasRef.current.scrollLeft - 110;
    const y = e.clientY - rect.top + canvasRef.current.scrollTop - 40;
    addNodeAt(connector, x, y);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left + canvasRef.current.scrollLeft;
    const cy = e.clientY - rect.top + canvasRef.current.scrollTop;

    if (wiringFromId) {
      setMouseCanvasPos({ x: cx, y: cy });
    }

    const drag = dragNodeRef.current;
    if (!drag) return;
    const x = Math.max(10, cx - drag.offsetX);
    const y = Math.max(10, cy - drag.offsetY);
    setNodes((prev) =>
      prev.map((n) => (n.id === drag.id ? { ...n, position: { x: Math.round(x), y: Math.round(y) } } : n)),
    );
  };

  const connectPortClick = (targetId: string) => {
    if (!wiringFromId) {
      setWiringFromId(targetId);
      const src = nodes.find((n) => n.id === targetId);
      if (src?.position) {
        setMouseCanvasPos({ x: src.position.x + 224, y: src.position.y + 56 });
      }
      return;
    }
    if (wiringFromId === targetId) {
      setWiringFromId(null);
      setMouseCanvasPos(null);
      return;
    }
    const alreadyExists = edges.some((e) => e.from === wiringFromId && e.to === targetId);
    if (!alreadyExists) {
      const src = nodes.find((n) => n.id === wiringFromId);
      let branch: string | undefined;
      if (src?.type === 'logic.if') {
        const existingBranches = new Set(edges.filter((e) => e.from === src.id).map((e) => e.branch));
        branch = existingBranches.has('true') ? 'false' : 'true';
      }
      const newEdge: WorkflowEdge = {
        id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        from: wiringFromId,
        to: targetId,
        branch,
      };
      setEdges((prev) => [...prev, newEdge]);
      setSelectedEdgeId(newEdge.id);
      setSelectedNodeId(null);
    }
    setWiringFromId(null);
    setMouseCanvasPos(null);
  };

  const updateSelectedNode = (patch: Partial<WorkflowNode>, syncConfigText = false) => {
    if (!selectedNode) return;
    const updated = { ...selectedNode, ...patch };
    setNodes((prev) => prev.map((n) => (n.id === selectedNode.id ? updated : n)));
    if (syncConfigText && patch.config !== undefined) {
      setConfigText(JSON.stringify(patch.config, null, 2));
      setConfigJsonError(null);
    }
  };

  const deleteSelectedNode = () => {
    if (!selectedNode) return;
    const targetId = selectedNode.id;
    setNodes((prev) => prev.filter((n) => n.id !== targetId));
    setEdges((prev) => prev.filter((e) => e.from !== targetId && e.to !== targetId));
    setSelectedNodeId(null);
  };

  const removeEdge = (edgeId: string) => {
    setEdges((prev) => prev.filter((e) => e.id !== edgeId));
    if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
    if (insertMenuEdge?.edgeId === edgeId) setInsertMenuEdge(null);
  };

  const handleSave = async (andPublish: boolean) => {
    setBusy(true);
    try {
      const saved = await onSaveDraft({
        id: draftId,
        key: wfKey,
        name: wfName,
        description: wfDescription,
        webhookSecret: webhookSecret.trim() || undefined,
        definition: {
          nodes,
          edges,
          sagaEnabled,
        },
      });
      setDraftId(saved.id);
      if (andPublish) {
        await onPublish(saved.id);
        setDraftId(undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  const wiringFromNode = wiringFromId ? nodes.find((n) => n.id === wiringFromId) : null;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {/* Top Toolbar */}
      <div
        className="card"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input
            className="input"
            style={{ width: 190 }}
            value={wfKey}
            onChange={(e) => setWfKey(e.target.value)}
            placeholder="workflow-key"
          />
          <input
            className="input"
            style={{ width: 210 }}
            value={wfName}
            onChange={(e) => setWfName(e.target.value)}
            placeholder="Workflow Name"
          />
          <input
            className="input"
            style={{ width: 220 }}
            value={wfDescription}
            onChange={(e) => setWfDescription(e.target.value)}
            placeholder="Description"
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              checked={sagaEnabled}
              onChange={(e) => setSagaEnabled(e.target.checked)}
            />
            Saga Rollback
          </label>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button className="btn" type="button" onClick={insertParallelBlock}>
            <GitBranch size={14} /> + Parallel Fork/Join
          </button>
          <button className="btn" type="button" onClick={applyAutoLayout}>
            <LayoutGrid size={14} /> Auto-Layout
          </button>
          <button className="btn" type="button" disabled={busy} onClick={() => void handleSave(false)}>
            <Save size={14} /> {draftId ? 'Update Draft' : 'Save Draft'}
          </button>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void handleSave(true)}>
            <UploadCloud size={14} /> Save & Publish
          </button>
          <button className="btn btn-success" type="button" onClick={() => onLaunch(wfKey)}>
            <Play size={14} /> Run Instance
          </button>
        </div>
      </div>

      {/* 3-Pane Drag-and-Drop Studio */}
      <div className="studio-grid">
        {/* Left: Live Connector Palette */}
        <div className="card" style={{ maxHeight: 640, overflowY: 'auto' }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Drag Steps to Canvas</div>
          <input
            className="input"
            placeholder="Search connectors..."
            value={paletteSearch}
            onChange={(e) => setPaletteSearch(e.target.value)}
            style={{ marginBottom: 10 }}
          />
          {filteredConnectors.map((c) => (
            <div
              key={c.type}
              className="palette-item"
              draggable
              onDragStart={(e) => e.dataTransfer.setData('application/nexusflow-connector', c.type)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 12 }}>{c.title}</strong>
                <button
                  type="button"
                  className="port-btn"
                  title="Append sequentially from selected node"
                  onClick={() => {
                    const base = selectedNode?.position ?? { x: 40, y: 120 };
                    addNodeAt(c, base.x + 255, base.y, selectedNode?.id);
                  }}
                >
                  <Plus size={11} />
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#67e8f9', marginTop: 2 }}>
                <code>{c.type}</code>
              </div>
            </div>
          ))}
        </div>

        {/* Center: Interactive 2D Canvas with + / Cancel on every connecting line */}
        <div
          ref={canvasRef}
          className="canvas-board"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleCanvasDrop}
          onMouseMove={handleMouseMove}
          onMouseUp={() => {
            dragNodeRef.current = null;
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              fontSize: 12,
              color: 'var(--muted)',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>
              {wiringFromId
                ? `Connecting from '${wiringFromId}' → click target node's Connect port (or Esc to cancel)`
                : 'Drag nodes to move · Use + / × on any connecting line to insert steps or disconnect'}
            </span>
            {wiringFromId && (
              <button
                type="button"
                className="btn btn-danger"
                style={{ padding: '4px 10px', fontSize: 11 }}
                onClick={() => {
                  setWiringFromId(null);
                  setMouseCanvasPos(null);
                }}
              >
                <X size={12} /> Cancel Line
              </button>
            )}
          </div>

          <div className="canvas-inner">
            <svg width={1400} height={760} style={{ position: 'absolute', inset: 0 }}>
              <defs>
                <marker id="studio-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="#818cf8" />
                </marker>
              </defs>

              {edges.map((edge) => {
                const from = nodes.find((n) => n.id === edge.from);
                const to = nodes.find((n) => n.id === edge.to);
                if (!from || !to) return null;
                const p1 = from.position ?? { x: 40, y: 40 };
                const p2 = to.position ?? { x: 300, y: 40 };
                const x1 = p1.x + 224;
                const y1 = p1.y + 56;
                const x2 = p2.x;
                const y2 = p2.y + 56;
                const dx = Math.max(48, Math.abs(x2 - x1) * 0.45);
                const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
                const mx = (x1 + x2) / 2;
                const my = (y1 + y2) / 2;
                const isSel = selectedEdgeId === edge.id;
                return (
                  <g
                    key={edge.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setSelectedEdgeId(edge.id);
                      setSelectedNodeId(null);
                    }}
                  >
                    <path
                      d={d}
                      fill="none"
                      stroke={isSel ? '#06b6d4' : edge.branch ? '#22d3ee' : '#818cf8'}
                      strokeWidth={isSel ? 3.5 : 2.2}
                      markerEnd="url(#studio-arrow)"
                    />
                    {edge.branch && (
                      <text x={mx} y={my - 20} textAnchor="middle" fill="#67e8f9" fontSize={11} fontWeight={700}>
                        {edge.branch}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Live preview line while wiring */}
              {wiringFromNode && mouseCanvasPos && (
                <path
                  d={`M ${(wiringFromNode.position?.x ?? 40) + 224} ${(wiringFromNode.position?.y ?? 40) + 56} L ${mouseCanvasPos.x} ${mouseCanvasPos.y}`}
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
              )}
            </svg>

            {/* Edge Midpoint + and Cancel (×) Controls */}
            {edges.map((edge) => {
              const from = nodes.find((n) => n.id === edge.from);
              const to = nodes.find((n) => n.id === edge.to);
              if (!from || !to) return null;
              const p1 = from.position ?? { x: 40, y: 40 };
              const p2 = to.position ?? { x: 300, y: 40 };
              const mx = (p1.x + 224 + p2.x) / 2;
              const my = (p1.y + 56 + (p2.y + 56)) / 2;
              return (
                <div key={`ctrl-${edge.id}`} className="edge-controls" style={{ left: mx, top: my }}>
                  <button
                    type="button"
                    className="edge-btn add"
                    title="Insert step or parallel branch on this line"
                    onClick={(e) => {
                      e.stopPropagation();
                      setInsertMenuEdge(
                        insertMenuEdge?.edgeId === edge.id ? null : { edgeId: edge.id, x: mx, y: my + 18 },
                      );
                    }}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="edge-btn del"
                    title="Cancel / remove this connection"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeEdge(edge.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}

            {/* Inline Insert-on-Edge Menu */}
            {insertMenuEdge && (
              <div
                className="edge-insert-menu"
                style={{ left: Math.max(12, insertMenuEdge.x - 120), top: insertMenuEdge.y }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong style={{ fontSize: 12 }}>Insert on Line</strong>
                  <button type="button" className="edge-btn del" onClick={() => setInsertMenuEdge(null)}>
                    ×
                  </button>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', marginBottom: 8, fontSize: 12 }}
                  onClick={() => addParallelBranchOnEdge(insertMenuEdge.edgeId)}
                >
                  <GitBranch size={13} /> + Add Parallel Branch
                </button>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>
                  Or insert sequential step:
                </div>
                {connectors
                  .filter((c) => c.category !== 'trigger')
                  .map((c) => (
                    <div
                      key={c.type}
                      className="palette-item"
                      style={{ padding: '6px 8px', cursor: 'pointer' }}
                      onClick={() => insertNodeOnEdge(insertMenuEdge.edgeId, c)}
                    >
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{c.title}</div>
                      <div style={{ fontSize: 10, color: '#67e8f9' }}>{c.type}</div>
                    </div>
                  ))}
              </div>
            )}

            {/* Nodes */}
            {nodes.map((node) => {
              const pos = node.position ?? { x: 40, y: 40 };
              const isSelected = selectedNodeId === node.id;
              const isWiringSrc = wiringFromId === node.id;
              return (
                <div
                  key={node.id}
                  className={`canvas-node ${isSelected ? 'selected' : ''} ${
                    node.isCompensationHandler ? 'comp' : ''
                  }`}
                  style={{ left: pos.x, top: pos.y }}
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).closest('button')) return;
                    selectNode(node);
                    if (!canvasRef.current) return;
                    const rect = canvasRef.current.getBoundingClientRect();
                    dragNodeRef.current = {
                      id: node.id,
                      offsetX: e.clientX - rect.left + canvasRef.current.scrollLeft - pos.x,
                      offsetY: e.clientY - rect.top + canvasRef.current.scrollTop - pos.y,
                    };
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4, marginBottom: 4 }}>
                    <span className="badge badge-blue">{node.type}</span>
                    {node.stage && <span className="badge">{node.stage}</span>}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{node.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>id: {node.id}</div>

                  <div className="node-port-row">
                    {isWiringSrc ? (
                      <button
                        type="button"
                        className="port-btn wiring"
                        onClick={() => {
                          setWiringFromId(null);
                          setMouseCanvasPos(null);
                        }}
                      >
                        <X size={10} /> Cancel
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`port-btn ${wiringFromId ? 'wiring' : ''}`}
                        onClick={() => connectPortClick(node.id)}
                      >
                        <Link2 size={10} /> {wiringFromId ? 'Connect Here' : 'Connect'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="port-btn"
                      title="Add sequential next node"
                      onClick={() => {
                        const defaultAction =
                          connectors.find((c) => c.type === 'action.transform') ?? connectors[0];
                        if (defaultAction) {
                          addNodeAt(defaultAction, pos.x + 255, pos.y, node.id);
                        }
                      }}
                    >
                      <ArrowRight size={10} /> +Step
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Working Step / Edge Editor */}
        <div className="card" style={{ maxHeight: 640, overflowY: 'auto' }}>
          {selectedNode && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 14 }}>Step Editor</strong>
                <button className="btn btn-danger" type="button" onClick={deleteSelectedNode}>
                  <Trash2 size={13} />
                </button>
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>Node Name</label>
                <input
                  className="input"
                  value={selectedNode.name}
                  onChange={(e) => updateSelectedNode({ name: e.target.value })}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>Kissflow Stage</label>
                <input
                  className="input"
                  value={selectedNode.stage ?? ''}
                  onChange={(e) => updateSelectedNode({ stage: e.target.value || undefined })}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>Node Type</label>
                <input
                  className="input"
                  value={selectedNode.type}
                  onChange={(e) => updateSelectedNode({ type: e.target.value })}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>Output Variable Key (optional)</label>
                <input
                  className="input"
                  value={selectedNode.outputKey ?? ''}
                  placeholder="e.g. riskScore"
                  onChange={(e) => updateSelectedNode({ outputKey: e.target.value || undefined })}
                />
              </div>

              {selectedNode.type === 'action.http' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)' }}>HTTP URL</label>
                    <input
                      className="input"
                      value={String(selectedNode.config.url ?? '')}
                      onChange={(e) =>
                        updateSelectedNode({ config: { ...selectedNode.config, url: e.target.value } }, true)
                      }
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)' }}>Method</label>
                    <select
                      className="select"
                      value={String(selectedNode.config.method ?? 'POST')}
                      onChange={(e) =>
                        updateSelectedNode({ config: { ...selectedNode.config, method: e.target.value } }, true)
                      }
                    >
                      {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)' }}>Vault Credential</label>
                    <select
                      className="select"
                      value={String(selectedNode.config.credentialName ?? '')}
                      onChange={(e) =>
                        updateSelectedNode(
                          { config: { ...selectedNode.config, credentialName: e.target.value || undefined } },
                          true,
                        )
                      }
                    >
                      <option value="">None</option>
                      {credentials.map((c) => (
                        <option key={c.id} value={c.name}>
                          {c.name} ({c.type})
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {selectedNode.type === 'logic.if' && (
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)' }}>Condition Expression</label>
                  <input
                    className="input"
                    value={String(selectedNode.config.condition ?? '')}
                    onChange={(e) =>
                      updateSelectedNode({ config: { ...selectedNode.config, condition: e.target.value } }, true)
                    }
                  />
                </div>
              )}

              {selectedNode.type === 'bpmn.user_task' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)' }}>Task Title Template</label>
                    <input
                      className="input"
                      value={String(selectedNode.config.title ?? '')}
                      onChange={(e) =>
                        updateSelectedNode({ config: { ...selectedNode.config, title: e.target.value } }, true)
                      }
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)' }}>Candidate Group</label>
                    <input
                      className="input"
                      value={String(selectedNode.config.candidateGroup ?? '')}
                      onChange={(e) =>
                        updateSelectedNode(
                          { config: { ...selectedNode.config, candidateGroup: e.target.value } },
                          true,
                        )
                      }
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)' }}>Required Quorum Approvals</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={Number(selectedNode.config.requiredApprovals ?? 1)}
                      onChange={(e) =>
                        updateSelectedNode(
                          { config: { ...selectedNode.config, requiredApprovals: Number(e.target.value) || 1 } },
                          true,
                        )
                      }
                    />
                  </div>
                </>
              )}

              {selectedNode.type === 'bpmn.external_task' && (
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)' }}>External Worker Topic</label>
                  <input
                    className="input"
                    value={String(selectedNode.config.topic ?? '')}
                    onChange={(e) =>
                      updateSelectedNode({ config: { ...selectedNode.config, topic: e.target.value } }, true)
                    }
                  />
                </div>
              )}

              {selectedNode.type === 'bpmn.timer' && (
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)' }}>Timer Delay (ms)</label>
                  <input
                    className="input"
                    type="number"
                    value={Number(selectedNode.config.delayMs ?? 1000)}
                    onChange={(e) =>
                      updateSelectedNode(
                        { config: { ...selectedNode.config, delayMs: Number(e.target.value) || 0 } },
                        true,
                      )
                    }
                  />
                </div>
              )}

              {selectedNode.type === 'bpmn.message_catch' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)' }}>Message Name</label>
                    <input
                      className="input"
                      value={String(selectedNode.config.messageName ?? '')}
                      onChange={(e) =>
                        updateSelectedNode(
                          { config: { ...selectedNode.config, messageName: e.target.value } },
                          true,
                        )
                      }
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)' }}>Correlation Key</label>
                    <input
                      className="input"
                      value={String(selectedNode.config.correlationKey ?? '')}
                      onChange={(e) =>
                        updateSelectedNode(
                          { config: { ...selectedNode.config, correlationKey: e.target.value } },
                          true,
                        )
                      }
                    />
                  </div>
                </>
              )}

              {selectedNode.type === 'bpmn.call_activity' && (
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)' }}>Target Child Workflow</label>
                  <select
                    className="select"
                    value={String(selectedNode.config.workflowKey ?? '')}
                    onChange={(e) =>
                      updateSelectedNode(
                        { config: { ...selectedNode.config, workflowKey: e.target.value } },
                        true,
                      )
                    }
                  >
                    <option value="">Select published workflow...</option>
                    {workflows
                      .filter((w) => w.status === 'PUBLISHED')
                      .map((w) => (
                        <option key={w.id} value={w.key}>
                          {w.name} ({w.key})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              {selectedNode.type === 'trigger.webhook' && (
                <>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)' }}>Webhook Path</label>
                    <input
                      className="input"
                      value={String(selectedNode.config.path ?? '')}
                      onChange={(e) =>
                        updateSelectedNode({ config: { ...selectedNode.config, path: e.target.value } }, true)
                      }
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)' }}>Webhook Secret (optional)</label>
                    <input
                      className="input"
                      value={webhookSecret}
                      onChange={(e) => setWebhookSecret(e.target.value)}
                      placeholder="min 8 chars"
                    />
                  </div>
                </>
              )}

              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>Saga Compensation Node ID</label>
                <select
                  className="select"
                  value={selectedNode.compensateNodeId ?? ''}
                  onChange={(e) =>
                    updateSelectedNode({ compensateNodeId: e.target.value || undefined })
                  }
                >
                  <option value="">None</option>
                  {nodes
                    .filter((n) => n.id !== selectedNode.id)
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name} ({n.id})
                      </option>
                    ))}
                </select>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={Boolean(selectedNode.isCompensationHandler)}
                  onChange={(e) =>
                    updateSelectedNode({ isCompensationHandler: e.target.checked || undefined })
                  }
                />
                Compensation-Only Handler
              </label>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: 11, color: 'var(--muted)' }}>Node Config (JSON)</label>
                  {configJsonError ? (
                    <span style={{ fontSize: 10, color: '#fca5a5' }}>Invalid JSON</span>
                  ) : (
                    <span style={{ fontSize: 10, color: '#6ee7b7' }}>Synced</span>
                  )}
                </div>
                <textarea
                  className="textarea"
                  rows={8}
                  value={configText}
                  onChange={(e) => {
                    const nextText = e.target.value;
                    setConfigText(nextText);
                    try {
                      const parsed = JSON.parse(nextText) as Record<string, unknown>;
                      setConfigJsonError(null);
                      updateSelectedNode({ config: parsed });
                    } catch (err) {
                      setConfigJsonError(err instanceof Error ? err.message : 'Invalid JSON');
                    }
                  }}
                />
              </div>
            </div>
          )}

          {!selectedNode && selectedEdge && (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: 14 }}>Connection Editor</strong>
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={() => removeEdge(selectedEdge.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {selectedEdge.from} → {selectedEdge.to}
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>
                  Branch Label (for logic.if / logic.switch)
                </label>
                <input
                  className="input"
                  value={selectedEdge.branch ?? ''}
                  placeholder="true / false / default"
                  onChange={(e) =>
                    setEdges((prev) =>
                      prev.map((ed) =>
                        ed.id === selectedEdge.id ? { ...ed, branch: e.target.value || undefined } : ed,
                      ),
                    )
                  }
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--muted)' }}>Guard Condition Expression</label>
                <input
                  className="input"
                  value={selectedEdge.condition ?? ''}
                  placeholder="$vars.amount > 1000"
                  onChange={(e) =>
                    setEdges((prev) =>
                      prev.map((ed) =>
                        ed.id === selectedEdge.id
                          ? { ...ed, condition: e.target.value || undefined }
                          : ed,
                      ),
                    )
                  }
                />
              </div>
            </div>
          )}

          {!selectedNode && !selectedEdge && (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Click any node or connecting line on the canvas to edit its properties, stage, config JSON, or branch rules.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
