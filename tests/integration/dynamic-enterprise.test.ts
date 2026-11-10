import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NexusFlowModule } from '../../src/app.module.js';
import { NodeExecutorRegistry } from '../../src/application/engine/node-executors.js';
import { WorkflowEngine } from '../../src/application/engine/workflow-engine.js';
import { CaseService } from '../../src/application/services/case-service.js';
import { ExternalTaskService } from '../../src/application/services/external-task-service.js';
import { TaskService } from '../../src/application/services/task-service.js';
import { WorkflowService } from '../../src/application/services/workflow-service.js';
import { UNIT_OF_WORK } from '../../src/application/tokens.js';
import type { IUnitOfWork } from '../../src/domain/ports/repositories.js';

describe('Enterprise Dynamic Steps, Sub-Workflows, External Tasks & Loops', () => {
  let uow: IUnitOfWork;
  let workflowService: WorkflowService;
  let engine: WorkflowEngine;
  let externalTaskService: ExternalTaskService;
  let taskService: TaskService;
  let caseService: CaseService;
  let registry: NodeExecutorRegistry;

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
    workflowService = moduleRef.get(WorkflowService);
    engine = moduleRef.get(WorkflowEngine);
    externalTaskService = moduleRef.get(ExternalTaskService);
    taskService = moduleRef.get(TaskService);
    caseService = moduleRef.get(CaseService);
    registry = moduleRef.get(NodeExecutorRegistry);
  });

  afterEach(async () => {
    await uow.close();
  });

  it('runs dynamic for_each, kissflow.approval_matrix, bpmn.call_activity, and arbitrary external.* topics', async () => {
    // 1. Publish a dynamic child sub-workflow (invoked via runtime expression)
    const childWf = await workflowService.createWorkflow({
      key: 'regional-tax-check',
      name: 'Regional Tax Verification Sub-Workflow',
      createdBy: null,
      definition: {
        nodes: [
          { id: 'c_start', name: 'Start', type: 'trigger.manual', config: {} },
          {
            id: 'c_calc',
            name: 'Compute Tax',
            type: 'action.script',
            config: {
              assignments: {
                taxRate: '0.15',
                taxCleared: 'true',
              },
            },
          },
          { id: 'c_end', name: 'Done', type: 'bpmn.end', config: {} },
        ],
        edges: [
          { id: 'ce1', from: 'c_start', to: 'c_calc' },
          { id: 'ce2', from: 'c_calc', to: 'c_end' },
        ],
      },
    });
    await workflowService.publishWorkflow(childWf.id);

    // 2. Publish parent workflow using zero hardcoded stages and dynamic step types
    const parentWf = await workflowService.createWorkflow({
      key: 'dynamic-enterprise-order',
      name: 'Dynamic Enterprise Order Pipeline',
      createdBy: null,
      definition: {
        nodes: [
          { id: 'start', name: 'Start', type: 'trigger.manual', stage: 'Intake', config: {} },
          {
            id: 'line_mapper',
            name: 'ForEach Line Item',
            type: 'logic.for_each',
            stage: 'Line Enrichment',
            outputKey: 'enrichedLines',
            config: {
              items: '{{ $vars.lineItems }}',
              itemVar: 'line',
              map: {
                sku: '{{ $vars.line.sku }}',
                total: '{{ $vars.line.qty * $vars.line.unitPrice }}',
              },
            },
          },
          {
            id: 'dynamic_approval',
            name: 'Dynamic Approval Matrix',
            type: 'kissflow.approval_matrix',
            stage: 'Dynamic Approval',
            config: {
              rules: [
                {
                  when: '$vars.orderTotal >= 10000',
                  title: 'VP Approval for {{ $vars.orderId }}',
                  candidateGroup: 'vp-board',
                  requiredApprovals: 1,
                  slaMinutes: 30,
                  escalateTo: 'cfo@acme.io',
                },
              ],
              defaultRule: {
                title: 'Manager Approval for {{ $vars.orderId }}',
                candidateGroup: 'managers',
                requiredApprovals: 1,
              },
            },
          },
          {
            id: 'tax_subflow',
            name: 'Invoke Dynamic Sub-Workflow',
            type: 'bpmn.call_activity',
            stage: 'Compliance',
            config: {
              workflowKey: '{{ $vars.subWorkflowKey }}',
              inputVariables: { orderId: '{{ $vars.orderId }}' },
            },
          },
          {
            id: 'sap_sync',
            name: 'Dynamic External SAP Topic',
            type: 'external.sap_create_invoice',
            stage: 'ERP Sync',
            config: { orderId: '{{ $vars.orderId }}' },
          },
          { id: 'end', name: 'Completed', type: 'bpmn.end', stage: 'Done', config: {} },
        ],
        edges: [
          { id: 'pe1', from: 'start', to: 'line_mapper' },
          { id: 'pe2', from: 'line_mapper', to: 'dynamic_approval' },
          { id: 'pe3', from: 'dynamic_approval', to: 'tax_subflow' },
          { id: 'pe4', from: 'tax_subflow', to: 'sap_sync' },
          { id: 'pe5', from: 'sap_sync', to: 'end' },
        ],
      },
    });
    await workflowService.publishWorkflow(parentWf.id);

    const instance = await engine.startInstance({
      workflowKey: 'dynamic-enterprise-order',
      initialVariables: {
        orderId: 'ORD-DYN-1',
        orderTotal: 15000,
        subWorkflowKey: 'regional-tax-check',
        lineItems: [
          { sku: 'SRV-1', qty: 2, unitPrice: 5000 },
          { sku: 'NET-2', qty: 5, unitPrice: 1000 },
        ],
      },
    });
    await engine.drainQueue();

    // Auto-derived Kissflow stages (not hardcoded in definition.stages)
    const caseSummary = await caseService.getCaseSummary(instance.id);
    expect(caseSummary.stages).toEqual([
      'Intake',
      'Line Enrichment',
      'Dynamic Approval',
      'Compliance',
      'ERP Sync',
      'Done',
    ]);
    expect(caseSummary.instance.variables.enrichedLines).toEqual({
      count: 2,
      results: [
        { sku: 'SRV-1', total: 10000 },
        { sku: 'NET-2', total: 5000 },
      ],
    });

    // Approval Matrix dynamically picked VP Board rule
    expect(caseSummary.openTasks).toHaveLength(1);
    expect(caseSummary.openTasks[0]!.candidateGroup).toBe('vp-board');
    expect(caseSummary.openTasks[0]!.title).toBe('VP Approval for ORD-DYN-1');

    await taskService.completeTask(caseSummary.openTasks[0]!.id, 'vp-1', { approved: true });
    await engine.drainQueue(); // Executes dynamic sub-workflow AND reaches external.sap_create_invoice

    // External polyglot worker locks & completes the unregistered `external.sap_create_invoice` topic
    const locked = await externalTaskService.fetchAndLock('sap-worker-1', [
      'external.sap_create_invoice',
    ]);
    expect(locked).toHaveLength(1);
    expect(locked[0]!.variables.taxCleared).toBe('true');

    await externalTaskService.complete(locked[0]!.id, 'sap-worker-1', {
      sapDocNumber: 'SAP-9988',
    });
    await engine.drainQueue();

    const completed = await uow.repos.instances.findById(instance.id);
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.variables.sapDocNumber).toBe('SAP-9988');
  });

  it('supports runtime connector registration and dynamic token jump modification', async () => {
    const custom = registry.registerHttpConnector({
      type: 'connector.custom_audit',
      title: 'Custom Audit Sink',
      description: 'Dynamic HTTP connector',
      endpointUrl: 'https://audit.example.com/events',
    });
    expect(custom.builtin).toBe(false);
    expect(registry.listConnectors().some((c) => c.type === 'connector.custom_audit')).toBe(true);

    // Dynamic token modification skips a waiting timer straight to the end node
    const wf = await workflowService.createWorkflow({
      key: 'dynamic-jump',
      name: 'Dynamic Token Jump',
      createdBy: null,
      definition: {
        nodes: [
          { id: 'start', name: 'Start', type: 'trigger.manual', config: {} },
          { id: 'wait_long', name: 'Long Wait', type: 'bpmn.timer', config: { delayMs: 999_999 } },
          { id: 'end', name: 'End', type: 'bpmn.end', config: {} },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'wait_long' },
          { id: 'e2', from: 'wait_long', to: 'end' },
        ],
      },
    });
    await workflowService.publishWorkflow(wf.id);

    const inst = await engine.startInstance({ workflowKey: 'dynamic-jump' });
    await engine.drainQueue();

    await engine.patchVariables(inst.id, { overriddenBy: 'ops-director' });
    const tokens = await uow.repos.tokens.findByInstance(inst.id);
    await engine.moveTokenToNode(inst.id, tokens[0]!.id, 'end', 'Skip timer');
    await engine.drainQueue();

    const done = await uow.repos.instances.findById(inst.id);
    expect(done?.status).toBe('COMPLETED');
    expect(done?.variables.overriddenBy).toBe('ops-director');
  });
});
