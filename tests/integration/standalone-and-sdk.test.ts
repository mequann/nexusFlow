import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import crypto from 'node:crypto';
import { createNestApp } from '../../src/interfaces/http/bootstrap.js';
import { NexusFlowClient } from '../../src/sdk/client.js';
import { EventDispatcherService } from '../../src/application/services/event-dispatcher.service.js';
import { WorkflowService } from '../../src/application/services/workflow-service.js';
import type { OutboxEvent } from '../../src/domain/execution/types.js';

describe('Senior Architecture: Standalone Hosting, Resilient SDK, and Event Outbox Dispatcher', () => {
  let app: INestApplication;
  let serverUrl: string;
  let adminToken: string;
  let client: NexusFlowClient;
  let eventDispatcher: EventDispatcherService;
  let workflowService: WorkflowService;

  beforeAll(async () => {
    app = await createNestApp({
      configOverrides: {
        STORAGE_DRIVER: 'memory',
        ENABLE_EMBEDDED_WORKERS: 'true',
        WORKER_POLL_INTERVAL_MS: '20',
        TIMER_POLL_INTERVAL_MS: '50',
      },
      enableWorkers: true,
      enableDefaultMetrics: false,
    });
    await app.listen(0);

    const address = app.getHttpServer().address();
    const port = typeof address === 'string' ? 3000 : address.port;
    serverUrl = `http://127.0.0.1:${port}`;

    eventDispatcher = app.get(EventDispatcherService);
    workflowService = app.get(WorkflowService);

    // Login as bootstrapped admin
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@nexusflow.local', password: 'AdminChangeMe123!' });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.accessToken;

    client = new NexusFlowClient({
      baseUrl: serverUrl,
      bearerToken: adminToken,
      tenantId: 'default',
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('1. Serves the standalone Web Studio frontend bundle directly from NestJS', async () => {
    const res = await request(app.getHttpServer()).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('<!doctype html>');
  });

  it('2. SDK starts a workflow and autonomous remote worker processes external tasks with heartbeating', async () => {
    // Register a workflow with an external worker step
    const wf = await workflowService.createWorkflow({
      key: 'sdk-worker-demo',
      name: 'SDK Remote Worker Pipeline',
      description: 'Tests polyglot remote worker subscription and completion via NexusFlowClient',
      createdBy: null,
      definition: {
        nodes: [
          {
            id: 'start',
            name: 'Start',
            type: 'trigger.webhook',
            config: { path: 'sdk/start' },
          },
          {
            id: 'scoring_step',
            name: 'Calculate Risk Score',
            type: 'external.service_task',
            config: {
              topic: 'risk-assessment-engine',
              heartbeatTimeoutSeconds: 60,
              input: { applicantIncome: '{{ $trigger.body.income }}' },
            },
          },
          {
            id: 'end',
            name: 'End Pipeline',
            type: 'bpmn.end',
            config: {},
          },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'scoring_step' },
          { id: 'e2', from: 'scoring_step', to: 'end' },
        ],
      },
    });
    await workflowService.publishWorkflow(wf.id);

    // Create and start an autonomous SDK worker for topic 'risk-assessment-engine'
    let heartbeatRecorded = false;
    const worker = client.createWorker(
      {
        topic: 'risk-assessment-engine',
        workerId: 'risk-node-worker-01',
        concurrency: 2,
        pollIntervalMs: 50,
      },
      async (task) => {
        // Send activity heartbeat with progress
        await task.heartbeat({ percent: 50, phase: 'credit-bureau-queried' });
        heartbeatRecorded = true;
        return { riskScore: 810, rating: 'EXCELLENT' };
      },
    );

    worker.start();
    expect(worker.isRunning()).toBe(true);

    try {
      // Start workflow via SDK
      const startRes = await client.workflows.start('sdk-worker-demo', {
        variables: { income: 95000 },
        idempotencyKey: `sdk-run-${Date.now()}`,
      });
      expect(startRes.id).toBeDefined();

      // Await terminal completion via SDK polling utility
      const completed = await client.workflows.waitForCompletion(startRes.id, {
        timeoutMs: 10000,
        pollIntervalMs: 100,
      });

      expect(completed.status).toBe('COMPLETED');
      expect(completed.variables.riskScore).toBe(810);
      expect(completed.variables.rating).toBe('EXCELLENT');
      expect(heartbeatRecorded).toBe(true);
    } finally {
      await worker.stop();
      expect(worker.isRunning()).toBe(false);
    }
  });

  it('3. EventDispatcherService relays transactional outbox events with HMAC signatures and in-process pub/sub', async () => {
    let capturedEvent: OutboxEvent | null = null;
    const unsubscribe = eventDispatcher.on('INSTANCE_COMPLETED', (evt) => {
      capturedEvent = evt;
    });

    const testEvent: OutboxEvent = {
      id: crypto.randomUUID(),
      aggregateType: 'WorkflowInstance',
      aggregateId: 'test-inst-123',
      eventType: 'INSTANCE_COMPLETED',
      payload: { testRun: true, status: 'COMPLETED' },
      status: 'PENDING',
      attempts: 0,
      createdAt: new Date(),
      publishedAt: null,
    };

    await eventDispatcher.dispatch(testEvent);

    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent?.aggregateId).toBe('test-inst-123');
    expect(capturedEvent?.eventType).toBe('INSTANCE_COMPLETED');

    unsubscribe();
  });

  it('4. SDK browses universal template catalog and instantiates a banking loan workflow', async () => {
    const catalog = await client.templates.listCatalog();
    expect(catalog.length).toBeGreaterThan(0);

    const bankingTemplate = catalog.find((c) => c.key === 'banking-loan-origination');
    expect(bankingTemplate).toBeDefined();

    const instantiated = await client.templates.instantiate('banking-loan-origination', 'default');
    expect(instantiated.key).toBe('banking-loan-origination');
    expect(instantiated.version).toBeGreaterThanOrEqual(1);
  });
});
