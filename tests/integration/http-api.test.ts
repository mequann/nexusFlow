import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNestApp } from '../../src/interfaces/http/bootstrap.js';

describe('NestJS HTTP API (E2E Integration)', () => {
  let app: INestApplication;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await createNestApp({
      enableWorkers: false,
      enableDefaultMetrics: false,
      configOverrides: {
        STORAGE_DRIVER: 'memory',
        BOOTSTRAP_ADMIN_EMAIL: 'admin@nexusflow.local',
        BOOTSTRAP_ADMIN_PASSWORD: 'AdminChangeMe123!',
      },
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves health, readiness, and Prometheus metrics probes', async () => {
    const server = app.getHttpServer();
    const health = await request(server).get('/healthz').expect(200);
    expect(health.body.status).toBe('ok');
    expect(health.headers['x-correlation-id']).toBeTruthy();

    const ready = await request(server).get('/readyz').expect(200);
    expect(ready.body.status).toBe('ready');

    const metrics = await request(server).get('/metrics').expect(200);
    expect(metrics.text).toContain('nexusflow_http_request_duration_ms');

    const openapi = await request(server).get('/docs-json').expect(200);
    expect(openapi.body.components.schemas).toHaveProperty('LoginRequestDto');
    expect(openapi.body.components.schemas).toHaveProperty('CreateWorkflowDto');
    expect(openapi.body.components.schemas).toHaveProperty('CaseSummaryResponseDto');
    expect(openapi.body.components.schemas).toHaveProperty('ErrorResponseDto');
    expect(openapi.body.paths['/api/v1/workflows'].post.requestBody).toBeDefined();
  });

  it('enforces JWT authentication and RBAC permissions', async () => {
    const server = app.getHttpServer();

    await request(server).get('/api/v1/workflows').expect(401);

    const loginRes = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@nexusflow.local', password: 'AdminChangeMe123!' })
      .expect(200);

    adminToken = loginRes.body.accessToken as string;
    expect(adminToken).toBeTruthy();

    await request(server)
      .post('/api/v1/auth/register')
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        email: 'viewer@nexusflow.local',
        name: 'Read Only Viewer',
        password: 'ViewerPass123!',
        role: 'VIEWER',
      })
      .expect(201);

    const viewerLogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'viewer@nexusflow.local', password: 'ViewerPass123!' })
      .expect(200);
    viewerToken = viewerLogin.body.accessToken as string;

    // VIEWER cannot create workflows
    await request(server)
      .post('/api/v1/workflows')
      .set('authorization', `Bearer ${viewerToken}`)
      .send({
        key: 'blocked',
        name: 'Blocked',
        definition: { nodes: [{ id: 's', name: 'S', type: 'trigger.manual', config: {} }], edges: [] },
      })
      .expect(403);
  });

  it('supports Idempotency-Key deduplication, Credential Vault masking, and Webhook triggering', async () => {
    const server = app.getHttpServer();

    // 1. Credential Vault masks secrets on list
    await request(server)
      .post('/api/v1/credentials')
      .set('authorization', `Bearer ${adminToken}`)
      .send({
        name: 'stripe_prod',
        type: 'bearer',
        secretData: { token: 'sk_live_secret_999' },
      })
      .expect(201);

    const credsList = await request(server)
      .get('/api/v1/credentials')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(JSON.stringify(credsList.body)).not.toContain('sk_live_secret_999');

    // 2. Create workflow with Idempotency-Key
    const workflowPayload = {
      key: 'webhook-ingest',
      name: 'Webhook Ingest Pipeline',
      webhookSecret: 'super-webhook-secret',
      definition: {
        nodes: [
          {
            id: 'hook',
            name: 'Webhook Trigger',
            type: 'trigger.webhook',
            config: { path: 'orders/ingest' },
          },
          {
            id: 'normalize',
            name: 'Normalize Order',
            type: 'action.transform',
            config: { mapping: { normalizedOrderId: '{{ $trigger.body.orderId }}' } },
          },
          { id: 'done', name: 'Done', type: 'bpmn.end', config: {} },
        ],
        edges: [
          { id: 'e1', from: 'hook', to: 'normalize' },
          { id: 'e2', from: 'normalize', to: 'done' },
        ],
      },
    };

    const create1 = await request(server)
      .post('/api/v1/workflows')
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', 'wf-create-001')
      .send(workflowPayload)
      .expect(201);

    const create2 = await request(server)
      .post('/api/v1/workflows')
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', 'wf-create-001')
      .send(workflowPayload)
      .expect(201);
    expect(create2.headers['x-idempotency-replayed']).toBe('true');
    expect(create2.body.id).toBe(create1.body.id);

    // Reusing same Idempotency-Key with different payload yields 409 Conflict
    await request(server)
      .post('/api/v1/workflows')
      .set('authorization', `Bearer ${adminToken}`)
      .set('idempotency-key', 'wf-create-001')
      .send({ ...workflowPayload, name: 'Tampered Name' })
      .expect(409);

    // 3. Publish and trigger via Webhook
    await request(server)
      .post(`/api/v1/workflows/${create1.body.id}/publish`)
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(server)
      .post('/webhooks/orders%2Fingest')
      .set('x-webhook-secret', 'wrong-secret')
      .send({ orderId: 'ORD-1' })
      .expect(401);

    const accepted = await request(server)
      .post('/webhooks/orders%2Fingest')
      .set('x-webhook-secret', 'super-webhook-secret')
      .send({ orderId: 'ORD-555' })
      .expect(202);

    expect(accepted.body.accepted).toBe(true);
    const instanceId = accepted.body.instanceId as string;

    const trace = await request(server)
      .get(`/api/v1/instances/${instanceId}/trace`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(trace.body.instance.id).toBe(instanceId);

    // 4. Kissflow Case Portal & Collaboration Comments
    await request(server)
      .post(`/api/v1/cases/${instanceId}/comments`)
      .set('authorization', `Bearer ${adminToken}`)
      .send({ body: 'Reviewed intake payload and approved for processing' })
      .expect(201);

    const caseSummary = await request(server)
      .get(`/api/v1/cases/${instanceId}`)
      .set('authorization', `Bearer ${viewerToken}`)
      .expect(200);
    expect(caseSummary.body.instance.id).toBe(instanceId);
    expect(caseSummary.body.comments).toHaveLength(1);
  });
});

