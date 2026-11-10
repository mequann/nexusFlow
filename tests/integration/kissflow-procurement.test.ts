import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NexusFlowModule } from '../../src/app.module.js';
import { WorkflowEngine } from '../../src/application/engine/workflow-engine.js';
import { CaseService } from '../../src/application/services/case-service.js';
import { MessageService } from '../../src/application/services/message-service.js';
import { TaskService } from '../../src/application/services/task-service.js';
import { WorkflowService } from '../../src/application/services/workflow-service.js';
import { UNIT_OF_WORK } from '../../src/application/tokens.js';
import { ValidationError } from '../../src/domain/errors.js';
import type { IUnitOfWork } from '../../src/domain/ports/repositories.js';
import { SchedulerWorker } from '../../src/infrastructure/workers/scheduler-worker.js';

describe('Real-World Procurement CapEx (Camunda + n8n + Kissflow)', () => {
  let uow: IUnitOfWork;
  let workflowService: WorkflowService;
  let engine: WorkflowEngine;
  let taskService: TaskService;
  let caseService: CaseService;
  let messageService: MessageService;
  let scheduler: SchedulerWorker;

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
    taskService = moduleRef.get(TaskService);
    caseService = moduleRef.get(CaseService);
    messageService = moduleRef.get(MessageService);
    scheduler = moduleRef.get(SchedulerWorker);
  });

  afterEach(async () => {
    await uow.close();
  });

  it('executes intake validation, DMN spend routing, 2-of-N quorum approval, delegation, SLA escalation, and ERP sync', async () => {
    const wf = await workflowService.createWorkflow({
      key: 'procurement-capex',
      name: 'Enterprise Procurement & CapEx Approval',
      createdBy: null,
      definition: {
        sagaEnabled: true,
        stages: ['Intake', 'Spend Policy', 'Executive Approval', 'ERP Fulfillment', 'Completed'],
        intakeFormSchema: {
          fields: [
            { name: 'poNumber', type: 'text', required: true },
            { name: 'vendorName', type: 'text', required: true },
            { name: 'amount', type: 'currency', required: true, min: 1 },
            { name: 'costCenter', type: 'select', required: true, options: ['CC-ENG', 'CC-OPS'] },
          ],
        },
        nodes: [
          {
            id: 'intake',
            name: 'Purchase Request Intake',
            type: 'trigger.manual',
            stage: 'Intake',
            config: {},
          },
          {
            id: 'spend_policy',
            name: 'Camunda Spend Policy DMN',
            type: 'bpmn.decision_table',
            stage: 'Spend Policy',
            config: {
              table: {
                hitPolicy: 'FIRST',
                rules: [
                  {
                    id: 'capex-board',
                    when: [{ field: 'amount', op: '>=', value: 25000 }],
                    outputs: { approvalRequired: true, requiredQuorum: 2, slaMinutes: 30 },
                  },
                ],
                defaultOutputs: { approvalRequired: false, requiredQuorum: 1, slaMinutes: 60 },
              },
            },
          },
          {
            id: 'needs_exec',
            name: 'Requires CapEx Quorum?',
            type: 'logic.if',
            stage: 'Spend Policy',
            config: { condition: '$vars.approvalRequired == true' },
          },
          {
            id: 'exec_approval',
            name: 'VP & CFO Quorum Approval',
            type: 'bpmn.user_task',
            stage: 'Executive Approval',
            config: {
              title: 'Approve CapEx {{ $vars.poNumber }} ({{ $vars.vendorName }})',
              candidateGroup: 'executives',
              requiredApprovals: '{{ $vars.requiredQuorum }}',
              slaMinutes: 1,
              escalateTo: 'cfo-backup@acme.io',
              formSchema: {
                fields: [{ name: 'budgetCode', type: 'text', required: true }],
              },
            },
          },
          {
            id: 'fork_fulfill',
            name: 'Parallel ERP + Notify',
            type: 'logic.parallel',
            stage: 'ERP Fulfillment',
            config: {},
          },
          {
            id: 'create_po',
            name: 'Create ERP Purchase Order',
            type: 'action.transform',
            stage: 'ERP Fulfillment',
            config: { mapping: { erpPoCreated: true, poStatus: 'ISSUED' } },
            compensateNodeId: 'void_po',
          },
          {
            id: 'notify_vendor',
            name: 'Prepare Vendor Dispatch',
            type: 'action.transform',
            stage: 'ERP Fulfillment',
            config: { mapping: { vendorNotified: true } },
          },
          {
            id: 'join_fulfill',
            name: 'Await ERP & Vendor Sync',
            type: 'logic.join',
            stage: 'ERP Fulfillment',
            config: {},
          },
          {
            id: 'await_goods',
            name: 'Await Warehouse Goods Receipt',
            type: 'bpmn.message_catch',
            stage: 'ERP Fulfillment',
            config: {
              messageName: 'goods.received',
              correlationKey: '{{ $vars.poNumber }}',
            },
          },
          {
            id: 'void_po',
            name: 'Void ERP Purchase Order',
            type: 'action.transform',
            config: { mapping: { erpPoVoided: true } },
            isCompensationHandler: true,
          },
          {
            id: 'done',
            name: 'CapEx Closed',
            type: 'bpmn.end',
            stage: 'Completed',
            config: {},
          },
        ],
        edges: [
          { id: 'e1', from: 'intake', to: 'spend_policy' },
          { id: 'e2', from: 'spend_policy', to: 'needs_exec' },
          { id: 'e3', from: 'needs_exec', to: 'exec_approval', branch: 'true' },
          { id: 'e4', from: 'needs_exec', to: 'fork_fulfill', branch: 'false' },
          { id: 'e5', from: 'exec_approval', to: 'fork_fulfill' },
          { id: 'e6', from: 'fork_fulfill', to: 'create_po' },
          { id: 'e7', from: 'fork_fulfill', to: 'notify_vendor' },
          { id: 'e8', from: 'create_po', to: 'join_fulfill' },
          { id: 'e9', from: 'notify_vendor', to: 'join_fulfill' },
          { id: 'e10', from: 'join_fulfill', to: 'await_goods' },
          { id: 'e11', from: 'await_goods', to: 'done' },
        ],
      },
    });
    await workflowService.publishWorkflow(wf.id);

    // 1. Kissflow intake form rejects invalid submission
    await expect(
      engine.startInstance({
        workflowKey: 'procurement-capex',
        initialVariables: { poNumber: 'PO-1', amount: -5, costCenter: 'INVALID' },
      }),
    ).rejects.toThrow(ValidationError);

    // 2. Valid $40,000 CapEx submission
    const instance = await engine.startInstance({
      workflowKey: 'procurement-capex',
      initialVariables: {
        poNumber: 'PO-2026-88',
        vendorName: 'Dell Enterprise',
        amount: 40000,
        costCenter: 'CC-ENG',
      },
    });
    await engine.drainQueue();

    // Verify Kissflow Case Summary stage & progress
    let summary = await caseService.getCaseSummary(instance.id);
    expect(summary.currentStage).toBe('Executive Approval');
    expect(summary.progressPercent).toBe(60);
    expect(summary.openTasks).toHaveLength(1);
    const task = summary.openTasks[0]!;
    expect(task.requiredApprovals).toBe(2);

    // 3. Collaboration comment & OOO delegation
    await caseService.addComment(instance.id, 'u-req', 'alice@acme.io', 'Urgent Q4 server rack');
    const delegated = await taskService.delegateTask(
      task.id,
      'vp-eng',
      'vp-backup',
      'Out of office until Friday',
    );
    expect(delegated.delegatedFrom).toBe('vp-eng');
    expect(delegated.assignee).toBe('vp-backup');

    // 4. Simulate SLA breach & auto-escalation
    const slaCount = await taskService.escalateOverdueTasks(new Date(Date.now() + 120_000));
    expect(slaCount).toBe(1);
    summary = await caseService.getCaseSummary(instance.id);
    expect(summary.instance.slaStatus).toBe('BREACHED');
    expect(summary.openTasks[0]!.assignee).toBe('cfo-backup@acme.io');
    expect(summary.openTasks[0]!.slaBreached).toBe(true);

    // 5. Missing required task form field is rejected
    await expect(
      taskService.completeTask(task.id, 'vp-backup', {}),
    ).rejects.toThrow(ValidationError);

    // 6. Approver 1 votes (1 of 2 -> task stays OPEN)
    const afterVote1 = await taskService.completeTask(task.id, 'vp-backup', {
      budgetCode: 'CAPEX-2026-Q4',
    });
    expect(afterVote1.status).toBe('OPEN');
    expect(afterVote1.approvalsReceived).toHaveLength(1);

    // Approver 2 votes (2 of 2 -> task COMPLETED & workflow advances!)
    const afterVote2 = await taskService.completeTask(task.id, 'cfo-user', {
      budgetCode: 'CAPEX-2026-Q4',
    });
    expect(afterVote2.status).toBe('COMPLETED');
    await engine.drainQueue();

    // 7. Parallel ERP + Vendor Notify ran and now awaits warehouse goods receipt
    const msgRes = await messageService.correlateMessage('goods.received', 'PO-2026-88', {
      receivedBy: 'warehouse-1',
    });
    expect(msgRes.matchedSubscriptions).toBe(1);
    await engine.drainQueue();

    const finalSummary = await caseService.getCaseSummary(instance.id);
    expect(finalSummary.instance.status).toBe('COMPLETED');
    expect(finalSummary.progressPercent).toBe(100);
    expect(finalSummary.instance.variables.erpPoCreated).toBe(true);
    expect(finalSummary.instance.variables.vendorNotified).toBe(true);
    expect(finalSummary.comments).toHaveLength(1);

    const relayed = await scheduler.relayOutbox();
    expect(relayed).toBeGreaterThanOrEqual(3);
  });
});
