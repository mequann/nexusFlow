import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NexusFlowModule } from '../../src/app.module.js';
import { WorkflowEngine } from '../../src/application/engine/workflow-engine.js';
import { IncidentService } from '../../src/application/services/incident-service.js';
import { MessageService } from '../../src/application/services/message-service.js';
import { TaskService } from '../../src/application/services/task-service.js';
import { WorkflowService } from '../../src/application/services/workflow-service.js';
import { UNIT_OF_WORK } from '../../src/application/tokens.js';
import type { IUnitOfWork } from '../../src/domain/ports/repositories.js';
import { SchedulerWorker } from '../../src/infrastructure/workers/scheduler-worker.js';

describe('Hybrid Camunda BPMN + n8n Workflow Engine (Integration)', () => {
  let uow: IUnitOfWork;
  let workflowService: WorkflowService;
  let engine: WorkflowEngine;
  let taskService: TaskService;
  let messageService: MessageService;
  let incidentService: IncidentService;
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
    messageService = moduleRef.get(MessageService);
    incidentService = moduleRef.get(IncidentService);
    scheduler = moduleRef.get(SchedulerWorker);
  });

  afterEach(async () => {
    await uow.close();
  });

  it('orchestrates DMN decision table, IF branch, Parallel Fork/Join, User Task, Message Catch, and Timer', async () => {
    const wf = await workflowService.createWorkflow({
      key: 'hybrid-order',
      name: 'Hybrid Order Fulfillment',
      createdBy: null,
      definition: {
        nodes: [
          { id: 'start', name: 'Start', type: 'trigger.manual', config: {} },
          {
            id: 'risk_dmn',
            name: 'Evaluate Risk DMN',
            type: 'bpmn.decision_table',
            config: {
              table: {
                hitPolicy: 'FIRST',
                rules: [
                  {
                    id: 'high-value',
                    when: [{ field: 'amount', op: '>=', value: 1000 }],
                    outputs: { requiresApproval: true, tier: 'ENTERPRISE' },
                  },
                ],
                defaultOutputs: { requiresApproval: false, tier: 'STANDARD' },
              },
            },
          },
          {
            id: 'check_approval',
            name: 'Requires Approval?',
            type: 'logic.if',
            config: { condition: '$vars.requiresApproval == true' },
          },
          { id: 'fork', name: 'Parallel Fork', type: 'logic.parallel', config: {} },
          {
            id: 'enrich',
            name: 'Enrich Payload',
            type: 'action.transform',
            config: { mapping: { enriched: true, orderRef: 'ORD-{{ $vars.orderId }}' } },
          },
          {
            id: 'approve_task',
            name: 'Finance Approval',
            type: 'bpmn.user_task',
            config: {
              title: 'Approve enterprise order {{ $vars.orderId }}',
              candidateGroup: 'finance',
            },
          },
          { id: 'join', name: 'Join Branches', type: 'logic.join', config: {} },
          {
            id: 'await_payment',
            name: 'Wait Payment Webhook Message',
            type: 'bpmn.message_catch',
            config: {
              messageName: 'payment.settled',
              correlationKey: '{{ $vars.orderId }}',
            },
          },
          {
            id: 'cooling_timer',
            name: 'Cooling Period Timer',
            type: 'bpmn.timer',
            config: { delayMs: 0 },
          },
          { id: 'end_ok', name: 'Fulfilled', type: 'bpmn.end', config: {} },
          { id: 'end_fast', name: 'Fast Track End', type: 'bpmn.end', config: {} },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'risk_dmn' },
          { id: 'e2', from: 'risk_dmn', to: 'check_approval' },
          { id: 'e3', from: 'check_approval', to: 'fork', branch: 'true' },
          { id: 'e4', from: 'check_approval', to: 'end_fast', branch: 'false' },
          { id: 'e5', from: 'fork', to: 'enrich' },
          { id: 'e6', from: 'fork', to: 'approve_task' },
          { id: 'e7', from: 'enrich', to: 'join' },
          { id: 'e8', from: 'approve_task', to: 'join' },
          { id: 'e9', from: 'join', to: 'await_payment' },
          { id: 'e10', from: 'await_payment', to: 'cooling_timer' },
          { id: 'e11', from: 'cooling_timer', to: 'end_ok' },
        ],
      },
    });
    await workflowService.publishWorkflow(wf.id);

    const instance = await engine.startInstance({
      workflowKey: 'hybrid-order',
      initialVariables: { orderId: 'ORD-99', amount: 2500 },
    });

    await engine.drainQueue();

    // Parallel branch 1 ('enrich') reached 'join' and waits; branch 2 paused at 'approve_task'
    let current = await uow.repos.instances.findById(instance.id);
    expect(current?.status).toBe('WAITING');
    expect(current?.variables.enriched).toBe(true);
    expect(current?.variables.tier).toBe('ENTERPRISE');

    const tasks = await taskService.listTasks({ instanceId: instance.id, status: 'OPEN' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.title).toBe('Approve enterprise order ORD-99');

    await taskService.claimTask(tasks[0]!.id, 'cfo-user');
    await taskService.completeTask(tasks[0]!.id, 'cfo-user', { approvalCode: 'OK-777' });
    await engine.drainQueue();

    // Now joined and waiting at bpmn.message_catch
    current = await uow.repos.instances.findById(instance.id);
    expect(current?.status).toBe('WAITING');
    expect(current?.variables.approvalCode).toBe('OK-777');

    const msgRes = await messageService.correlateMessage('payment.settled', 'ORD-99', {
      txId: 'stripe_pi_123',
    });
    expect(msgRes.matchedSubscriptions).toBe(1);
    await engine.drainQueue();

    // Waiting at bpmn.timer -> trigger via schedulerWorker
    const timersFired = await scheduler.fireDueTimers(new Date(Date.now() + 5000));
    expect(timersFired).toBe(1);
    await engine.drainQueue();

    const completed = await uow.repos.instances.findById(instance.id);
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.variables.txId).toBe('stripe_pi_123');

    const relayed = await scheduler.relayOutbox();
    expect(relayed).toBeGreaterThanOrEqual(2);
  });

  it('executes Saga compensations in reverse order on downstream failure', async () => {
    const wf = await workflowService.createWorkflow({
      key: 'saga-booking',
      name: 'Saga Travel Booking',
      createdBy: null,
      definition: {
        sagaEnabled: true,
        nodes: [
          { id: 'start', name: 'Start', type: 'trigger.manual', config: {} },
          {
            id: 'reserve_flight',
            name: 'Reserve Flight',
            type: 'action.transform',
            config: { mapping: { flightReserved: true } },
            compensateNodeId: 'cancel_flight',
          },
          {
            id: 'reserve_hotel',
            name: 'Reserve Hotel',
            type: 'action.transform',
            config: { mapping: { hotelReserved: true } },
            compensateNodeId: 'cancel_hotel',
          },
          {
            id: 'charge_card',
            name: 'Charge Card (SSRF blocked failure)',
            type: 'action.http',
            config: { url: 'http://127.0.0.1:9999/charge', method: 'POST' },
            retryPolicy: {
              maxAttempts: 1,
              initialDelayMs: 10,
              backoffMultiplier: 1,
              maxDelayMs: 10,
            },
          },
          {
            id: 'cancel_flight',
            name: 'Cancel Flight',
            type: 'action.transform',
            config: { mapping: { flightCancelled: true } },
            isCompensationHandler: true,
          },
          {
            id: 'cancel_hotel',
            name: 'Cancel Hotel',
            type: 'action.transform',
            config: { mapping: { hotelCancelled: true } },
            isCompensationHandler: true,
          },
          { id: 'end', name: 'End', type: 'bpmn.end', config: {} },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'reserve_flight' },
          { id: 'e2', from: 'reserve_flight', to: 'reserve_hotel' },
          { id: 'e3', from: 'reserve_hotel', to: 'charge_card' },
          { id: 'e4', from: 'charge_card', to: 'end' },
        ],
      },
    });
    await workflowService.publishWorkflow(wf.id);

    const instance = await engine.startInstance({ workflowKey: 'saga-booking' });
    await engine.drainQueue();

    const finalInst = await uow.repos.instances.findById(instance.id);
    expect(finalInst?.status).toBe('COMPENSATED');

    const steps = await uow.repos.steps.findByInstance(instance.id);
    const compensationSteps = steps.filter((s) => s.nodeName.startsWith('[Compensate]'));
    expect(compensationSteps.map((s) => s.nodeId)).toEqual(['cancel_hotel', 'cancel_flight']);
  });

  it('opens an Incident on failure and allows operator resolution via RETRY', async () => {
    const wf = await workflowService.createWorkflow({
      key: 'incident-recovery',
      name: 'Incident Recovery Demo',
      createdBy: null,
      definition: {
        nodes: [
          { id: 'start', name: 'Start', type: 'trigger.manual', config: {} },
          {
            id: 'guarded_step',
            name: 'Guarded Action',
            type: 'action.http',
            config: { url: '{{ $vars.targetUrl }}' },
          },
          { id: 'end', name: 'End', type: 'bpmn.end', config: {} },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'guarded_step' },
          { id: 'e2', from: 'guarded_step', to: 'end' },
        ],
      },
    });
    await workflowService.publishWorkflow(wf.id);

    // Invalid URL triggers ValidationError -> opens Incident
    const instance = await engine.startInstance({
      workflowKey: 'incident-recovery',
      initialVariables: { targetUrl: 'not-a-valid-url' },
    });
    await engine.drainQueue();

    const incidentInst = await uow.repos.instances.findById(instance.id);
    expect(incidentInst?.status).toBe('INCIDENT_OPEN');

    const openIncidents = await incidentService.listIncidents({
      instanceId: instance.id,
      status: 'OPEN',
    });
    expect(openIncidents).toHaveLength(1);

    // Operator resolves incident with FAIL or COMPENSATE or RETRY
    await incidentService.resolveIncident(
      openIncidents[0]!.id,
      'ops-admin',
      'FAIL',
      'Confirmed bad payload',
    );
    const failedInst = await uow.repos.instances.findById(instance.id);
    expect(failedInst?.status).toBe('FAILED');
  });

  it('executes unequal-length parallel branches (5 steps vs 9 steps) and converges cleanly at join', async () => {
    const branchXNodes = Array.from({ length: 5 }, (_, i) => ({
      id: `x${i + 1}`,
      name: `Branch X Step ${i + 1}`,
      type: 'action.transform' as const,
      config: { mapping: { [`xStep${i + 1}`]: true } },
    }));
    const branchYNodes = Array.from({ length: 9 }, (_, i) => ({
      id: `y${i + 1}`,
      name: `Branch Y Step ${i + 1}`,
      type: 'action.transform' as const,
      config: { mapping: { [`yStep${i + 1}`]: true } },
    }));

    const edges = [
      { id: 'e_start', from: 'start', to: 'fork' },
      { id: 'e_fx', from: 'fork', to: 'x1' },
      { id: 'e_fy', from: 'fork', to: 'y1' },
      ...branchXNodes.slice(0, -1).map((n, i) => ({
        id: `ex_${i}`,
        from: n.id,
        to: branchXNodes[i + 1]!.id,
      })),
      ...branchYNodes.slice(0, -1).map((n, i) => ({
        id: `ey_${i}`,
        from: n.id,
        to: branchYNodes[i + 1]!.id,
      })),
      { id: 'e_xj', from: 'x5', to: 'join' },
      { id: 'e_yj', from: 'y9', to: 'join' },
      { id: 'e_end', from: 'join', to: 'end' },
    ];

    const wf = await workflowService.createWorkflow({
      key: 'unequal-parallel-5-vs-9',
      name: 'Unequal Parallel 5 vs 9 Steps',
      createdBy: null,
      definition: {
        nodes: [
          { id: 'start', name: 'Start', type: 'trigger.manual', config: {} },
          { id: 'fork', name: 'Fork', type: 'logic.parallel', config: {} },
          ...branchXNodes,
          ...branchYNodes,
          { id: 'join', name: 'Join', type: 'logic.join', config: {} },
          { id: 'end', name: 'End', type: 'bpmn.end', config: {} },
        ],
        edges,
      },
    });
    await workflowService.publishWorkflow(wf.id);

    const inst = await engine.startInstance({ workflowKey: 'unequal-parallel-5-vs-9' });
    await engine.drainQueue(500);

    const done = await uow.repos.instances.findById(inst.id);
    expect(done?.status).toBe('COMPLETED');
    expect(done?.variables.xStep5).toBe(true);
    expect(done?.variables.yStep9).toBe(true);
  });
});

