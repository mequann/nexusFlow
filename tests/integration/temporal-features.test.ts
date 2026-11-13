import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { NexusFlowModule } from '../../src/app.module.js';
import { WorkflowEngine } from '../../src/application/engine/workflow-engine.js';
import { WorkflowService } from '../../src/application/services/workflow-service.js';
import { ExternalTaskService } from '../../src/application/services/external-task-service.js';
import { UNIT_OF_WORK } from '../../src/application/tokens.js';
import type { IUnitOfWork } from '../../src/domain/ports/repositories.js';
import type { WorkflowGraphDefinition } from '../../src/domain/workflow/types.js';

describe('Temporal-Style Architectural Capabilities in NexusFlow', () => {
  let uow: IUnitOfWork;
  let engine: WorkflowEngine;
  let workflowService: WorkflowService;
  let externalTaskService: ExternalTaskService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        NexusFlowModule.register({
          enableWorkers: false,
          enableDefaultMetrics: false,
          configOverrides: { STORAGE_DRIVER: 'memory' },
        }),
      ],
    }).compile();

    await moduleRef.init();
    uow = moduleRef.get<IUnitOfWork>(UNIT_OF_WORK);
    engine = moduleRef.get(WorkflowEngine);
    workflowService = moduleRef.get(WorkflowService);
    externalTaskService = moduleRef.get(ExternalTaskService);
  });

  afterEach(async () => {
    await uow.close();
  });

  describe('1. Activity Heartbeating & Live Progress Tracking', () => {
    it('records heartbeat progress and extends lock expiration dynamically', async () => {
      // 1. Define workflow with external service task
      const definition: WorkflowGraphDefinition = {
        nodes: [
          { id: 'start', type: 'trigger.manual', name: 'Start', config: {} },
          { id: 'batch_worker', type: 'bpmn.external_task', name: 'Batch ETL', config: { topic: 'etl.batch.process' } },
          { id: 'end', type: 'bpmn.end', name: 'End', config: {} },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'batch_worker' },
          { id: 'e2', from: 'batch_worker', to: 'end' },
        ],
      };

      const wf = await workflowService.createWorkflow({
        key: 'temporal-heartbeat-etl',
        name: 'Heartbeat ETL Workflow',
        definition,
        createdBy: 'admin',
      });
      await workflowService.publishWorkflow(wf.id);

      const inst = await engine.startInstance({
        workflowKey: 'temporal-heartbeat-etl',
        initialVariables: { batchSize: 5000 },
      });
      await engine.drainQueue();

      // 2. Worker fetches and locks task
      const lockedTasks = await externalTaskService.fetchAndLock('worker-gpu-1', ['etl.batch.process'], 1, 10_000);
      expect(lockedTasks).toHaveLength(1);
      const taskId = lockedTasks[0].id;

      const initialLockExpiration = lockedTasks[0].lockExpiresAt!.getTime();

      // 3. Worker sends incremental Heartbeat #1 (e.g., 30% complete)
      const afterHeartbeat1 = await externalTaskService.recordHeartbeat(
        taskId,
        'worker-gpu-1',
        { percent: 30, processedRows: 1500 },
        20_000, // extend lock by 20s
      );

      expect(afterHeartbeat1.progress).toEqual({ percent: 30, processedRows: 1500 });
      expect(afterHeartbeat1.lastHeartbeatAt).toBeDefined();
      expect(afterHeartbeat1.lockExpiresAt!.getTime()).toBeGreaterThan(initialLockExpiration);

      // 4. Query live progress via getTaskProgress
      const progressSnapshot = await externalTaskService.getTaskProgress(taskId);
      expect(progressSnapshot.progress).toEqual({ percent: 30, processedRows: 1500 });

      // 5. Worker completes task
      await externalTaskService.complete(taskId, 'worker-gpu-1', { processedRows: 5000, status: 'DONE' });
      await engine.drainQueue();

      const completedInst = await uow.repos.instances.findById(inst.id);
      expect(completedInst?.status).toBe('COMPLETED');
    });
  });

  describe('2. Point-in-Time Workflow Reset (Time Travel Recovery)', () => {
    it('rewinds a workflow to a past node, clears active tokens, and resumes forward', async () => {
      const definition: WorkflowGraphDefinition = {
        nodes: [
          { id: 'start', type: 'trigger.manual', name: 'Start', config: {} },
          { id: 'step1', type: 'action.transform', name: 'Step 1', config: { code: 'return { val: 10 };' } },
          {
            id: 'step2_task',
            type: 'bpmn.user_task',
            name: 'Step 2 Review',
            config: { candidateGroup: 'approvers' },
          },
          {
            id: 'step3_final',
            type: 'bpmn.user_task',
            name: 'Step 3 Final',
            config: { candidateGroup: 'directors' },
          },
          { id: 'end', type: 'bpmn.end', name: 'End', config: {} },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'step1' },
          { id: 'e2', from: 'step1', to: 'step2_task' },
          { id: 'e3', from: 'step2_task', to: 'step3_final' },
          { id: 'e4', from: 'step3_final', to: 'end' },
        ],
      };

      const wf = await workflowService.createWorkflow({
        key: 'temporal-time-travel',
        name: 'Time Travel Workflow',
        definition,
        createdBy: 'admin',
      });
      await workflowService.publishWorkflow(wf.id);

      const inst = await engine.startInstance({
        workflowKey: 'temporal-time-travel',
        initialVariables: { price: 100 },
      });
      await engine.drainQueue();

      // At step2_task
      const tasks1 = await uow.repos.userTasks.list({ instanceId: inst.id });
      expect(tasks1).toHaveLength(1);
      expect(tasks1[0].title).toBe('Step 2 Review');

      // Operator triggers Point-in-Time Reset: rewinds back to step1 with variable override
      const resetInst = await engine.resetInstance(inst.id, {
        targetNodeId: 'step1',
        reason: 'Operator rewound execution to apply updated discount',
        variablesOverride: { price: 80, discountApplied: true },
      });

      expect(resetInst.status).toBe('RUNNING');
      expect(resetInst.variables.price).toBe(80);
      expect(resetInst.variables.discountApplied).toBe(true);

      // Verify that after reset, draining queue executes forward from step1 to step2_task
      await engine.drainQueue();
      const tokensAfterReset = await uow.repos.tokens.findByInstance(inst.id);
      const activeTokens = tokensAfterReset.filter((t) => t.status === 'ACTIVE' || t.status === 'WAITING');
      expect(activeTokens.some((t) => t.currentNodeId === 'step2_task')).toBe(true);
    });
  });

  describe('3. ParentClosePolicy (Child Workflow Cascade Cancellation)', () => {
    it('automatically cascade cancels child workflows when parent is cancelled', async () => {
      // Child sub-workflow
      const childDef: WorkflowGraphDefinition = {
        nodes: [
          { id: 'c_start', type: 'trigger.manual', name: 'Child Start', config: {} },
          { id: 'c_task', type: 'bpmn.user_task', name: 'Child Waiting Task', config: { candidateGroup: 'ops' } },
          { id: 'c_end', type: 'bpmn.end', name: 'Child End', config: {} },
        ],
        edges: [
          { id: 'ce1', from: 'c_start', to: 'c_task' },
          { id: 'ce2', from: 'c_task', to: 'c_end' },
        ],
      };
      const childWf = await workflowService.createWorkflow({
        key: 'sub-process-worker',
        name: 'Sub Process Worker',
        definition: childDef,
        createdBy: 'admin',
      });
      await workflowService.publishWorkflow(childWf.id);

      // Parent workflow calling child sub-workflow
      const parentDef: WorkflowGraphDefinition = {
        nodes: [
          { id: 'p_start', type: 'trigger.manual', name: 'Parent Start', config: {} },
          {
            id: 'call_sub',
            type: 'bpmn.call_activity',
            name: 'Invoke Child',
            config: { workflowKey: 'sub-process-worker', parentClosePolicy: 'TERMINATE' },
          },
          { id: 'p_end', type: 'bpmn.end', name: 'Parent End', config: {} },
        ],
        edges: [
          { id: 'pe1', from: 'p_start', to: 'call_sub' },
          { id: 'pe2', from: 'call_sub', to: 'p_end' },
        ],
      };
      const parentWf = await workflowService.createWorkflow({
        key: 'parent-process-main',
        name: 'Parent Main Process',
        definition: parentDef,
        createdBy: 'admin',
      });
      await workflowService.publishWorkflow(parentWf.id);

      const parentInst = await engine.startInstance({
        workflowKey: 'parent-process-main',
      });
      await engine.drainQueue();

      // Verify child instance was spawned and is active (waiting on user task)
      const children = await uow.repos.instances.findByParentInstance(parentInst.id);
      expect(children).toHaveLength(1);
      const childInstId = children[0].id;
      expect(['RUNNING', 'WAITING']).toContain(children[0].status);

      // Now cancel parent instance
      await engine.cancelInstance(parentInst.id, 'Parent aborted by executive');

      // Verify parent is CANCELLED
      const parentAfter = await uow.repos.instances.findById(parentInst.id);
      expect(parentAfter?.status).toBe('CANCELLED');

      // Verify child instance was automatically CASCADE CANCELLED per ParentClosePolicy: TERMINATE
      const childAfter = await uow.repos.instances.findById(childInstId);
      expect(childAfter?.status).toBe('CANCELLED');
    });
  });

  describe('4. ContinueAsNew (Compaction for Long-Running Cycles)', () => {
    it('compacts current instance into a fresh generation carrying over state', async () => {
      const definition: WorkflowGraphDefinition = {
        nodes: [
          { id: 'start', type: 'trigger.manual', name: 'Start', config: {} },
          { id: 'task', type: 'bpmn.user_task', name: 'Waiting Task', config: { candidateGroup: 'ops' } },
          { id: 'end', type: 'bpmn.end', name: 'End', config: {} },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'task' },
          { id: 'e2', from: 'task', to: 'end' },
        ],
      };

      const wf = await workflowService.createWorkflow({
        key: 'cyclic-long-runner',
        name: 'Long Running Poller',
        definition,
        createdBy: 'admin',
      });
      await workflowService.publishWorkflow(wf.id);

      const gen1 = await engine.startInstance({
        workflowKey: 'cyclic-long-runner',
        initialVariables: { iterationCount: 1, lastProcessedId: 400 },
      });
      await engine.drainQueue();

      // Trigger ContinueAsNew to compact history for Generation 2
      const gen2 = await engine.continueAsNew(gen1.id, {
        carryoverVariables: { iterationCount: 2, lastProcessedId: 850 },
        reason: 'Compacted after 1000 loop executions',
      });

      // Verify gen1 is marked CONTINUED_AS_NEW
      const gen1After = await uow.repos.instances.findById(gen1.id);
      expect(gen1After?.status).toBe('CONTINUED_AS_NEW');
      expect(gen1After?.completedAt).toBeDefined();

      // Verify gen2 is running with clean generation metadata and carryover state
      expect(gen2.id).not.toBe(gen1.id);
      expect(gen2.generation).toBe(2);
      expect(gen2.continuedFromInstanceId).toBe(gen1.id);
      expect(gen2.status).toBe('RUNNING');
      expect(gen2.variables.iterationCount).toBe(2);
      expect(gen2.variables.lastProcessedId).toBe(850);
    });
  });

  describe('5. Synchronous Live Workflow Queries', () => {
    it('inspects live workflow state and evaluates expressions without mutating state', async () => {
      const definition: WorkflowGraphDefinition = {
        nodes: [
          { id: 'start', type: 'trigger.manual', name: 'Start', config: {} },
          { id: 'task', type: 'bpmn.user_task', name: 'Approval Task', config: { candidateGroup: 'finance' } },
          { id: 'end', type: 'bpmn.end', name: 'End', config: {} },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'task' },
          { id: 'e2', from: 'task', to: 'end' },
        ],
      };

      const wf = await workflowService.createWorkflow({
        key: 'queryable-wf',
        name: 'Queryable Workflow',
        definition,
        createdBy: 'admin',
      });
      await workflowService.publishWorkflow(wf.id);

      const inst = await engine.startInstance({
        workflowKey: 'queryable-wf',
        initialVariables: {
          accountBalanceEtb: 250000,
          customerTier: 'PLATINUM',
          approvedItems: ['Laptop', 'Monitor', 'DockingStation'],
        },
      });

      // Query single variable key
      const keyQuery = await engine.queryInstance(inst.id, { variableKey: 'customerTier' });
      expect(keyQuery.result).toBe('PLATINUM');
      expect(keyQuery.status).toBe('RUNNING');

      // Query dynamic safe expression
      const exprQuery = await engine.queryInstance(inst.id, {
        expression: '{{ $vars.accountBalanceEtb >= 200000 }}',
      });
      expect(exprQuery.result).toBe(true);
    });
  });
});
