import { ValidationError } from '../errors.js';
import type { EdgeDefinition, NodeDefinition, WorkflowGraphDefinition } from './types.js';

export interface ValidationIssue {
  path: string;
  message: string;
}

const TRIGGER_TYPES = new Set(['trigger.manual', 'trigger.webhook', 'trigger.cron']);
const NAMESPACED_TYPE_REGEX = /^[a-z][a-z0-9_]*(\.[a-z0-9_-]+)+$/;

/**
 * Validates structural, topological, and semantic invariants of a hybrid
 * Camunda BPMN + n8n DAG workflow definition before saving or publishing.
 */
export function validateWorkflowGraph(graph: WorkflowGraphDefinition): void {
  const issues: ValidationIssue[] = [];

  if (!graph.nodes || graph.nodes.length === 0) {
    throw new ValidationError('Workflow must contain at least one node');
  }

  const nodeMap = new Map<string, NodeDefinition>();
  for (const [idx, node] of graph.nodes.entries()) {
    if (!node.id || !/^[a-zA-Z0-9_-]+$/.test(node.id)) {
      issues.push({
        path: `nodes[${idx}].id`,
        message: 'Node id must be non-empty alphanumeric/underscore/hyphen',
      });
    }
    if (!node.type || !NAMESPACED_TYPE_REGEX.test(node.type)) {
      issues.push({
        path: `nodes[${idx}].type`,
        message: `Node type '${node.type}' must be a namespaced identifier (e.g. 'action.http', 'connector.sap')`,
      });
    }
    if (nodeMap.has(node.id)) {
      issues.push({
        path: `nodes[${idx}].id`,
        message: `Duplicate node id '${node.id}'`,
      });
    }
    nodeMap.set(node.id, node);
  }

  const triggers = graph.nodes.filter(
    (n) => TRIGGER_TYPES.has(n.type) && !n.isCompensationHandler,
  );
  if (triggers.length !== 1) {
    issues.push({
      path: 'nodes',
      message: `Workflow must have exactly 1 entry trigger node, found ${triggers.length}`,
    });
  }

  const adj = new Map<string, EdgeDefinition[]>();
  const inDegree = new Map<string, number>();
  for (const node of graph.nodes) {
    adj.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  const edgeIds = new Set<string>();
  for (const [idx, edge] of graph.edges.entries()) {
    if (edgeIds.has(edge.id)) {
      issues.push({ path: `edges[${idx}].id`, message: `Duplicate edge id '${edge.id}'` });
    }
    edgeIds.add(edge.id);

    if (!nodeMap.has(edge.from)) {
      issues.push({
        path: `edges[${idx}].from`,
        message: `Source node '${edge.from}' does not exist`,
      });
    }
    if (!nodeMap.has(edge.to)) {
      issues.push({
        path: `edges[${idx}].to`,
        message: `Target node '${edge.to}' does not exist`,
      });
    }
    if (edge.from === edge.to) {
      issues.push({
        path: `edges[${idx}]`,
        message: `Self-loop on node '${edge.from}' is not allowed`,
      });
    }
    if (nodeMap.has(edge.from) && nodeMap.has(edge.to)) {
      adj.get(edge.from)!.push(edge);
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }
  }

  // Validate compensation handler references & branching semantics
  for (const node of graph.nodes) {
    if (node.compensateNodeId) {
      const compNode = nodeMap.get(node.compensateNodeId);
      if (!compNode) {
        issues.push({
          path: `nodes.${node.id}.compensateNodeId`,
          message: `Compensation node '${node.compensateNodeId}' does not exist`,
        });
      } else if (!compNode.isCompensationHandler) {
        issues.push({
          path: `nodes.${node.id}.compensateNodeId`,
          message: `Compensation node '${node.compensateNodeId}' must have isCompensationHandler=true`,
        });
      }
    }

    const outgoing = adj.get(node.id) ?? [];
    if (node.type === 'logic.if') {
      const branches = new Set(outgoing.map((e) => e.branch));
      if (!branches.has('true') && !branches.has('false')) {
        issues.push({
          path: `nodes.${node.id}`,
          message: `logic.if node '${node.id}' must have at least one outgoing edge with branch 'true' or 'false'`,
        });
      }
    }

    if (node.type === 'logic.parallel' && outgoing.length < 2) {
      issues.push({
        path: `nodes.${node.id}`,
        message: `logic.parallel node '${node.id}' must have at least 2 outgoing edges`,
      });
    }

    if (node.type === 'logic.join' && (inDegree.get(node.id) ?? 0) < 2) {
      issues.push({
        path: `nodes.${node.id}`,
        message: `logic.join node '${node.id}' must have at least 2 incoming edges`,
      });
    }
  }

  // Cycle detection via Kahn's / DFS 3-color on forward graph
  const color = new Map<string, 0 | 1 | 2>();
  for (const node of graph.nodes) color.set(node.id, 0);

  const hasCycle = (nodeId: string): boolean => {
    color.set(nodeId, 1);
    for (const edge of adj.get(nodeId) ?? []) {
      const state = color.get(edge.to);
      if (state === 1) return true;
      if (state === 0 && hasCycle(edge.to)) return true;
    }
    color.set(nodeId, 2);
    return false;
  };

  for (const node of graph.nodes) {
    if (color.get(node.id) === 0 && hasCycle(node.id)) {
      issues.push({
        path: 'edges',
        message: 'Workflow graph contains a cycle; DAG workflows must be acyclic',
      });
      break;
    }
  }

  // Reachability check from the trigger (excluding compensation handlers)
  if (triggers.length === 1) {
    const startId = triggers[0]!.id;
    const visited = new Set<string>();
    const queue = [startId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      for (const edge of adj.get(curr) ?? []) {
        queue.push(edge.to);
      }
    }

    for (const node of graph.nodes) {
      if (!node.isCompensationHandler && !visited.has(node.id)) {
        issues.push({
          path: `nodes.${node.id}`,
          message: `Node '${node.id}' is unreachable from trigger '${startId}'`,
        });
      }
    }
  }

  if (issues.length > 0) {
    throw new ValidationError('Workflow graph validation failed', issues);
  }
}
