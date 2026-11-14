import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNestApp } from '../../src/interfaces/http/bootstrap.js';
import { DistributedLockService } from '../../src/application/services/distributed-lock.service.js';
import { BpmnXmlService } from '../../src/application/services/bpmn-xml.service.js';

describe('Tier-1 Enterprise Scalability & Interoperability Test Suite', () => {
  let app: INestApplication;
  let adminToken: string;
  let lockService: DistributedLockService;
  let bpmnService: BpmnXmlService;

  beforeAll(async () => {
    app = await createNestApp({
      enableWorkers: false,
      enableDefaultMetrics: false,
      configOverrides: {
        STORAGE_DRIVER: 'memory',
        FILE_STORAGE_DRIVER: 'memory',
        CLUSTER_LOCK_DRIVER: 'memory',
        BOOTSTRAP_ADMIN_EMAIL: 'admin@nexusflow.local',
        BOOTSTRAP_ADMIN_PASSWORD: 'AdminChangeMe123!',
      },
    });
    await app.init();

    lockService = app.get(DistributedLockService);
    bpmnService = app.get(BpmnXmlService);

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@nexusflow.local', password: 'AdminChangeMe123!' })
      .expect(200);

    adminToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('1. Distributed Concurrency Lock (Multi-Node / Advisory Lock Engine)', () => {
    it('should acquire lock and enforce mutual exclusion', async () => {
      const lockKey = 'resource:capex_batch_9921';

      // Worker 1 acquires lock
      const lock1 = await lockService.tryAcquire(lockKey);
      expect(lock1.acquired).toBe(true);

      // Worker 2 attempts concurrent lock on same resource
      const lock2 = await lockService.tryAcquire(lockKey);
      expect(lock2.acquired).toBe(false);

      // Worker 1 finishes and releases lock
      await lockService.release(lock1);

      // Worker 2 can now acquire lock
      const lock3 = await lockService.tryAcquire(lockKey);
      expect(lock3.acquired).toBe(true);
      await lockService.release(lock3);
    });

    it('should run exclusively with withLock helper', async () => {
      let counter = 0;
      const res = await lockService.withLock('cluster:singleton_job', async () => {
        counter += 42;
        return 'success_payload';
      });

      expect(res.executed).toBe(true);
      expect(res.result).toBe('success_payload');
      expect(counter).toBe(42);
    });
  });

  describe('2. Enterprise Storage Vault (Local / S3 / DB Chunking)', () => {
    let uploadedFileId: string;

    it('should upload a document file to the vault', async () => {
      const payload = {
        filename: 'Capex_Justification_Audit.pdf',
        mimeType: 'application/pdf',
        contentBase64: Buffer.from('%PDF-1.4 Mock Capex Audit Justification File').toString('base64'),
        metadata: {
          department: 'Procurement',
          costCenter: 'CAPEX-2026',
        },
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/storage/upload')
        .set('authorization', `Bearer ${adminToken}`)
        .send(payload)
        .expect(201);

      expect(res.body.file).toBeDefined();
      expect(res.body.file.filename).toBe('Capex_Justification_Audit.pdf');
      expect(res.body.file.mimeType).toBe('application/pdf');
      expect(res.body.file.checksumSha256).toBeDefined();
      uploadedFileId = res.body.file.id;
    });

    it('should list stored files with metadata', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/storage')
        .set('authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(Array.isArray(res.body.files)).toBe(true);
      const found = res.body.files.find((f: any) => f.id === uploadedFileId);
      expect(found).toBeDefined();
      expect(found.filename).toBe('Capex_Justification_Audit.pdf');
    });

    it('should retrieve file metadata and download raw content', async () => {
      const metaRes = await request(app.getHttpServer())
        .get(`/api/v1/storage/${uploadedFileId}`)
        .set('authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(metaRes.body.file.id).toBe(uploadedFileId);

      const downloadRes = await request(app.getHttpServer())
        .get(`/api/v1/storage/${uploadedFileId}/content`)
        .set('authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(downloadRes.headers['content-type']).toContain('application/pdf');
      const bodyText = Buffer.isBuffer(downloadRes.body)
        ? downloadRes.body.toString('utf-8')
        : String(downloadRes.text || downloadRes.body);
      expect(bodyText).toContain('Mock Capex Audit Justification File');
    });

    it('should delete stored file', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/storage/${uploadedFileId}`)
        .set('authorization', `Bearer ${adminToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/v1/storage/${uploadedFileId}`)
        .set('authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('3. Standard BPMN 2.0 XML Engine Interoperability', () => {
    const sampleBpmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  targetNamespace="http://bpmn.io/schema/bpmn" id="Definitions_1">
  <bpmn:process id="VendorOnboardingProcess" name="Vendor Onboarding Flow" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Initiate Onboarding" />
    <bpmn:userTask id="Task_Review_TIN" name="Review TIN &amp; Legal Docs" />
    <bpmn:serviceTask id="Task_Sync_ERP" name="Register in SAP ERP" />
    <bpmn:endEvent id="End_1" name="Onboarding Complete" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_Review_TIN" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Review_TIN" targetRef="Task_Sync_ERP" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_Sync_ERP" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;

    let importedWorkflowId: string;

    it('should parse BPMN 2.0 XML into executable NexusFlow workflow definition', () => {
      const parsed = bpmnService.importBpmn(sampleBpmnXml);
      expect(parsed.name).toBe('Vendor Onboarding Flow');
      expect(parsed.key).toBe('vendoronboardingprocess');
      expect(parsed.definition.nodes.length).toBe(4);
      expect(parsed.definition.edges.length).toBe(3);

      const userTaskNode = parsed.definition.nodes.find((n) => n.id === 'Task_Review_TIN');
      expect(userTaskNode).toBeDefined();
      expect(userTaskNode?.type).toBe('bpmn.user_task');

      const serviceTaskNode = parsed.definition.nodes.find((n) => n.id === 'Task_Sync_ERP');
      expect(serviceTaskNode).toBeDefined();
      expect(serviceTaskNode?.type).toBe('bpmn.service_task');
    });

    it('should import BPMN XML via HTTP API and create workflow', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/workflows/import-bpmn')
        .set('authorization', `Bearer ${adminToken}`)
        .send({ xml: sampleBpmnXml })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.key).toBe('vendoronboardingprocess');
      importedWorkflowId = res.body.id;
    });

    it('should export workflow back into standard BPMN 2.0 XML format', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/workflows/${importedWorkflowId}/export-bpmn`)
        .set('authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.headers['content-type']).toContain('application/xml');
      expect(res.text).toContain('xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"');
      expect(res.text).toContain('<bpmn:process');
      expect(res.text).toContain('vendoronboardingprocess');
      expect(res.text).toContain('Task_Review_TIN');
    });
  });

  describe('4. Enterprise SSO & Identity Federation (OIDC / Keycloak / SAML)', () => {
    it('should list configured SSO identity providers', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/sso/providers')
        .expect(200);

      expect(Array.isArray(res.body.providers)).toBe(true);
      expect(res.body.providers.length).toBeGreaterThan(0);
      expect(res.body.providers[0].type).toBeDefined();
    });

    it('should handle SSO callback, JIT provision user, and issue valid JWT', async () => {
      const ssoUserPayload = {
        providerId: 'keycloak-enterprise',
        email: 'selamawit.mekonnen@enterprise.et',
        name: 'Selamawit Mekonnen',
        department: 'Operations',
        groups: ['FinanceApprovers', 'Auditors'],
        tenantId: 'default',
      };

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/sso/callback')
        .send(ssoUserPayload)
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('selamawit.mekonnen@enterprise.et');
      expect(res.body.user.name).toBe('Selamawit Mekonnen');

      // Verify issued token can authenticate against protected endpoints
      const meRes = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);

      expect(meRes.body.principal.email).toBe('selamawit.mekonnen@enterprise.et');
    });
  });
});
