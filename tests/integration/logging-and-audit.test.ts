import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createNestApp } from '../../src/interfaces/http/bootstrap.js';
import { WorkflowService } from '../../src/application/services/workflow-service.js';
import { AuditLogService } from '../../src/application/services/audit-log.service.js';

describe('Enterprise Logging & Compliance Audit Systems', () => {
  let app: INestApplication;
  let adminToken: string;
  let workflowService: WorkflowService;
  let auditLogService: AuditLogService;

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

    workflowService = app.get(WorkflowService);
    auditLogService = app.get(AuditLogService);

    // Login as admin - this should automatically produce an AUTH_LOGIN audit log
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@nexusflow.local', password: 'AdminChangeMe123!' });

    expect(loginRes.status).toBe(200);
    adminToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('1. Automatically records AUTH_LOGIN audit event upon user authentication', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/logs/audit?action=AUTH_LOGIN')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);

    const loginEvent = res.body.items.find((item: any) => item.action === 'AUTH_LOGIN');
    expect(loginEvent).toBeDefined();
    expect(loginEvent.userEmail).toBe('admin@nexusflow.local');
    expect(loginEvent.resourceType).toBe('User');
    expect(loginEvent.details.role).toBe('ADMIN');
  });

  it('2. Records INSTANCE_STARTED audit event when workflow instance starts', async () => {
    const wf = await workflowService.createWorkflow({
      key: 'audit-logged-flow',
      name: 'Audit Logged Workflow',
      description: 'Workflow testing automatic audit record generation',
      createdBy: null,
      definition: {
        nodes: [
          { id: 'start', name: 'Start', type: 'trigger.webhook', config: { path: 'audit/start' } },
          { id: 'step1', name: 'Transform', type: 'action.transform', config: { mapping: { ok: true } } },
          { id: 'end', name: 'End', type: 'bpmn.end', config: {} },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'step1' },
          { id: 'e2', from: 'step1', to: 'end' },
        ],
      },
    });
    await workflowService.publishWorkflow(wf.id);

    const startRes = await request(app.getHttpServer())
      .post('/api/v1/workflows/audit-logged-flow/instances')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ variables: { customerId: 'CUST-009' } });

    expect(startRes.status).toBe(201);
    const instanceId = startRes.body.id;

    // Check audit logs for INSTANCE_STARTED
    const auditRes = await request(app.getHttpServer())
      .get(`/api/v1/logs/audit?action=INSTANCE_STARTED`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(auditRes.status).toBe(200);
    const startEvent = auditRes.body.items.find((item: any) => item.resourceId === instanceId);
    expect(startEvent).toBeDefined();
    expect(startEvent.action).toBe('INSTANCE_STARTED');
    expect(startEvent.details.workflowKey).toBe('audit-logged-flow');
  });

  it('3. Serves live structured engine logs from in-memory ring buffer with level filtering', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/logs/system?minLevel=info&limit=50')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);

    const firstLog = res.body.items[0];
    expect(firstLog.timestamp).toBeDefined();
    expect(firstLog.level).toBeDefined();
    expect(firstLog.message).toBeDefined();
  });

  it('4. Retrieves granular instance step execution logs and duration metrics', async () => {
    const wf = await workflowService.createWorkflow({
      key: 'step-timing-flow',
      name: 'Step Timing Flow',
      description: 'Verifies granular execution log timings',
      createdBy: null,
      definition: {
        nodes: [
          { id: 'start', name: 'Start', type: 'trigger.webhook', config: { path: 'timing/start' } },
          { id: 'step_compute', name: 'Compute Payload', type: 'action.transform', config: { mapping: { sum: 42 } } },
          { id: 'end', name: 'Done', type: 'bpmn.end', config: {} },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'step_compute' },
          { id: 'e2', from: 'step_compute', to: 'end' },
        ],
      },
    });
    await workflowService.publishWorkflow(wf.id);

    const startRes = await request(app.getHttpServer())
      .post('/api/v1/workflows/step-timing-flow/instances')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    const instanceId = startRes.body.id;

    // Wait a brief moment for embedded worker to execute step
    await new Promise((r) => setTimeout(r, 200));

    const execLogRes = await request(app.getHttpServer())
      .get(`/api/v1/logs/instances/${instanceId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(execLogRes.status).toBe(200);
    expect(execLogRes.body.instanceId).toBe(instanceId);
    expect(execLogRes.body.steps.length).toBeGreaterThanOrEqual(1);
  });
});

