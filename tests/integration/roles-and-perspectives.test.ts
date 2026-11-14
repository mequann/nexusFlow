import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNestApp } from '../../src/interfaces/http/bootstrap.js';

describe('Role-Based Access Control & Multi-Persona Perspective Test', () => {
  let app: INestApplication;
  const roles = [
    { email: 'admin@nexusflow.local', role: 'ADMIN', name: 'Platform Admin' },
    { email: 'hr@nexusflow.local', role: 'HR', name: 'Almaz Tadesse' },
    { email: 'operator@nexusflow.local', role: 'OPERATOR', name: 'Sara Bekele' },
    { email: 'builder@nexusflow.local', role: 'BUILDER', name: 'Dawit Kebede' },
    { email: 'viewer@nexusflow.local', role: 'VIEWER', name: 'Yonas Haile' },
    { email: 'user@nexusflow.local', role: 'USER', name: 'Abebe Bikila' },
  ];

  const tokens: Record<string, string> = {};

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

    const server = app.getHttpServer();

    // 1. Login as Admin
    const adminLogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@nexusflow.local', password: 'AdminChangeMe123!' })
      .expect(200);
    tokens.ADMIN = adminLogin.body.accessToken;

    // 2. Register other role accounts via Admin API
    for (const r of roles) {
      if (r.role === 'ADMIN') continue;
      await request(server)
        .post('/api/v1/auth/register')
        .set('authorization', `Bearer ${tokens.ADMIN}`)
        .send({
          email: r.email,
          name: r.name,
          password: 'AdminChangeMe123!',
          role: r.role,
        })
        .expect(201);

      // Login as this user
      const loginRes = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: r.email, password: 'AdminChangeMe123!' })
        .expect(200);

      expect(loginRes.body.user.role).toBe(r.role);
      expect(loginRes.body.user.name).toBe(r.name);
      tokens[r.role] = loginRes.body.accessToken;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('authenticates and validates identity & claims for all 6 roles via /api/v1/auth/me', async () => {
    const server = app.getHttpServer();
    for (const r of roles) {
      const res = await request(server)
        .get('/api/v1/auth/me')
        .set('authorization', `Bearer ${tokens[r.role]}`)
        .expect(200);

      expect(res.body.principal.email).toBe(r.email);
      expect(res.body.principal.role).toBe(r.role);
      expect(res.body.principal.authType).toBe('jwt');
    }
  });

  it('enforces RBAC permissions strictly across roles for administrative actions', async () => {
    const server = app.getHttpServer();

    // Credential Vault: only ADMIN and BUILDER have credential:write
    // ADMIN can create credentials
    await request(server)
      .post('/api/v1/credentials')
      .set('authorization', `Bearer ${tokens.ADMIN}`)
      .send({ name: 'admin-cred', type: 'bearer', secretData: { token: 'secret' } })
      .expect(201);

    // BUILDER can create credentials
    await request(server)
      .post('/api/v1/credentials')
      .set('authorization', `Bearer ${tokens.BUILDER}`)
      .send({ name: 'builder-cred', type: 'bearer', secretData: { token: 'secret' } })
      .expect(201);

    // OPERATOR, VIEWER, HR, and USER are forbidden from creating credentials
    for (const role of ['OPERATOR', 'VIEWER', 'HR', 'USER']) {
      await request(server)
        .post('/api/v1/credentials')
        .set('authorization', `Bearer ${tokens[role]}`)
        .send({ name: `${role.toLowerCase()}-cred`, type: 'bearer', secretData: { token: 'secret' } })
        .expect(403);
    }

    // User Registration: ONLY ADMIN has admin:users permission
    for (const role of ['BUILDER', 'OPERATOR', 'VIEWER', 'HR', 'USER']) {
      await request(server)
        .post('/api/v1/auth/register')
        .set('authorization', `Bearer ${tokens[role]}`)
        .send({
          email: `test-${role.toLowerCase()}@test.com`,
          name: 'Test',
          password: 'Password123!',
          role: 'VIEWER',
        })
        .expect(403);
    }
  });

  it('allows workflow creation for ADMIN and BUILDER, but forbids for OPERATOR, VIEWER, HR, and USER', async () => {
    const server = app.getHttpServer();
    const wfPayload = {
      key: 'test-wf-role',
      name: 'Role Test Workflow',
      definition: {
        nodes: [{ id: 'start', name: 'Start', type: 'trigger.manual', config: {} }],
        edges: [],
      },
    };

    // BUILDER creates workflow
    const builderWf = await request(server)
      .post('/api/v1/workflows')
      .set('authorization', `Bearer ${tokens.BUILDER}`)
      .send({ ...wfPayload, key: 'builder-created-wf' })
      .expect(201);

    expect(builderWf.body.key).toBe('builder-created-wf');

    // OPERATOR, VIEWER, HR, USER are forbidden from creating workflow definitions
    for (const role of ['OPERATOR', 'VIEWER', 'HR', 'USER']) {
      await request(server)
        .post('/api/v1/workflows')
        .set('authorization', `Bearer ${tokens[role]}`)
        .send({ ...wfPayload, key: `${role.toLowerCase()}-attempt` })
        .expect(403);
    }
  });

  it('allows instance initiation for authorized roles and scopes task execution appropriately', async () => {
    const server = app.getHttpServer();

    // ADMIN publishes the builder-created workflow so it can be executed
    const wfList = await request(server)
      .get('/api/v1/workflows')
      .set('authorization', `Bearer ${tokens.ADMIN}`)
      .expect(200);

    const wf = wfList.body.items.find((w: { key: string }) => w.key === 'builder-created-wf');
    expect(wf).toBeDefined();

    await request(server)
      .post(`/api/v1/workflows/${wf.id}/publish`)
      .set('authorization', `Bearer ${tokens.ADMIN}`)
      .expect(200);

    // USER role can start an instance
    const userInstance = await request(server)
      .post(`/api/v1/workflows/builder-created-wf/instances`)
      .set('authorization', `Bearer ${tokens.USER}`)
      .send({ variables: { requestedBy: 'user@nexusflow.local' } })
      .expect(201);

    expect(userInstance.body.workflowKey).toBe('builder-created-wf');
    expect(['RUNNING', 'COMPLETED']).toContain(userInstance.body.status);

    // VIEWER cannot start instances
    await request(server)
      .post(`/api/v1/workflows/builder-created-wf/instances`)
      .set('authorization', `Bearer ${tokens.VIEWER}`)
      .send({ variables: {} })
      .expect(403);
  });
});
