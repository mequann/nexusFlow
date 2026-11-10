import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/errors.js';
import type { WorkflowGraphDefinition } from '../../src/domain/workflow/types.js';
import { validateWorkflowGraph } from '../../src/domain/workflow/validator.js';

describe('Workflow Graph Validator', () => {
  it('accepts a valid hybrid Camunda + n8n workflow with saga compensation', () => {
    const graph: WorkflowGraphDefinition = {
      sagaEnabled: true,
      nodes: [
        { id: 'start', name: 'Manual Start', type: 'trigger.manual', config: {} },
        {
          id: 'reserve',
          name: 'Reserve Stock',
          type: 'action.transform',
          config: { mapping: { reserved: true } },
          compensateNodeId: 'release',
        },
        {
          id: 'release',
          name: 'Release Stock',
          type: 'action.transform',
          config: { mapping: { released: true } },
          isCompensationHandler: true,
        },
        { id: 'end', name: 'Done', type: 'bpmn.end', config: {} },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'reserve' },
        { id: 'e2', from: 'reserve', to: 'end' },
      ],
    };

    expect(() => validateWorkflowGraph(graph)).not.toThrow();
  });

  it('rejects cyclic graphs and unreachable nodes', () => {
    const cyclic: WorkflowGraphDefinition = {
      nodes: [
        { id: 'start', name: 'Start', type: 'trigger.manual', config: {} },
        { id: 'a', name: 'A', type: 'action.transform', config: {} },
        { id: 'b', name: 'B', type: 'action.transform', config: {} },
        { id: 'orphan', name: 'Orphan', type: 'bpmn.end', config: {} },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'a' },
        { id: 'e2', from: 'a', to: 'b' },
        { id: 'e3', from: 'b', to: 'a' },
      ],
    };

    expect(() => validateWorkflowGraph(cyclic)).toThrow(ValidationError);
  });

  it('requires logic.parallel to have >= 2 outgoing edges and logic.join >= 2 incoming edges', () => {
    const invalidParallel: WorkflowGraphDefinition = {
      nodes: [
        { id: 'start', name: 'Start', type: 'trigger.manual', config: {} },
        { id: 'fork', name: 'Fork', type: 'logic.parallel', config: {} },
        { id: 'join', name: 'Join', type: 'logic.join', config: {} },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'fork' },
        { id: 'e2', from: 'fork', to: 'join' },
      ],
    };

    expect(() => validateWorkflowGraph(invalidParallel)).toThrow(ValidationError);
  });
});

