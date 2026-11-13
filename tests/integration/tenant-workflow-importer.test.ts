import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Test } from '@nestjs/testing';
import { NexusFlowModule } from '../../src/app.module.js';
import { TenantWorkflowImporterService } from '../../src/application/services/tenant-workflow-importer.service.js';
import { WorkflowService } from '../../src/application/services/workflow-service.js';
import { WorkflowEngine } from '../../src/application/engine/workflow-engine.js';
import { UNIT_OF_WORK } from '../../src/application/tokens.js';
import type { IUnitOfWork } from '../../src/domain/ports/repositories.js';
import type { TenantWorkflowImportPayload } from '../../src/domain/workflow/tenant-import-types.js';

describe('Tenant Workflow Importer Subsystem (ቴነንት የስራ ፍሰት ማስመጫ)', () => {
  let uow: IUnitOfWork;
  let workflowService: WorkflowService;
  let importerService: TenantWorkflowImporterService;
  let workflowEngine: WorkflowEngine;

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
    importerService = moduleRef.get(TenantWorkflowImporterService);
    workflowEngine = moduleRef.get(WorkflowEngine);
  });

  afterEach(async () => {
    await uow.close();
  });

  const getTemplatePath = () => {
    const localRepoPath = path.resolve(process.cwd(), 'src/application/templates/tenant-workflow-import-template.json');
    if (fs.existsSync(localRepoPath)) return localRepoPath;
    return path.resolve('C:/Users/mequanint.acham/Downloads/tenant-workflow-import-template (1).json');
  };

  it('validates the official enterprise tenant workflow import template', () => {
    const templatePath = getTemplatePath();
    const rawContent = fs.readFileSync(templatePath, 'utf8');
    const payload: TenantWorkflowImportPayload = JSON.parse(rawContent);

    const validationResult = importerService.validate(payload);

    expect(validationResult.isValid).toBe(true);
    expect(validationResult.errors).toHaveLength(0);
    expect(validationResult.summary.totalWorkflows).toBe(1);
    expect(validationResult.summary.validWorkflows).toBe(1);
  });

  it('imports and converts the tenant template into an executable BPMN/Kissflow workflow', async () => {
    const templatePath = getTemplatePath();
    const rawContent = fs.readFileSync(templatePath, 'utf8');
    const payload: TenantWorkflowImportPayload = JSON.parse(rawContent);

    const tenantId = 'commercial-bank-of-ethiopia';
    const importResult = await importerService.process(payload, tenantId, 'hr-admin-user');

    expect(importResult.importedCount).toBe(1);
    expect(importResult.workflows[0].code).toBe('EmployeeMasterTransfer');
    expect(importResult.workflows[0].name).toBe('Employee Transfer Approval');

    // Verify stored workflow in tenant
    const storedWf = await uow.repos.workflows.findById(importResult.workflows[0].workflowId);
    expect(storedWf).toBeDefined();
    expect(storedWf?.tenantId).toBe(tenantId);
    expect(storedWf?.definition.stages).toEqual([
      'REQUEST_SUBMISSION',
      'MANAGER_REVIEW',
      'HR_FINAL_APPROVAL',
    ]);

    // Verify intake schema was mapped from step 1 UI form
    expect(storedWf?.definition.intakeFormSchema).toBeDefined();
    const intakeFields = (storedWf?.definition.intakeFormSchema as any).fields;
    expect(intakeFields.some((f: any) => f.name === 'reason' && f.required === true)).toBe(true);
    expect(intakeFields.some((f: any) => f.name === 'targetDepartment')).toBe(true);

    // Verify nodes: Start -> Step 1 (Sequential) -> Step 2 (Parallel) -> Step 3 (Consensus) -> End
    const nodes = storedWf!.definition.nodes;
    expect(nodes).toHaveLength(5);
    const step3 = nodes.find((n) => n.id === 'step_hr_final_approval');
    expect(step3).toBeDefined();
    expect((step3?.config as any).requiredApprovals).toBe(3); // Consensus quorum!
    expect((step3?.config as any).collaborationMode).toBe('Consensus');

    // Publish the draft workflow so instances can be started
    await workflowService.publishWorkflow(importResult.workflows[0].workflowId);

    // Now start an instance of this imported workflow
    const instance = await workflowEngine.startInstance({
      tenantId,
      workflowKey: 'EmployeeMasterTransfer',
      startedBy: 'employee-abebe',
      initialVariables: {
        reason: 'Relocating to Hawassa branch for family reasons.',
        requestTitle: 'Transfer to Hawassa Branch',
        targetDepartment: 'Retail Banking',
        expectedSalary: 45000,
        effectiveDate: '2026-12-01',
        transferType: 'Permanent',
      },
    });

    expect(instance.id).toBeDefined();
    expect(instance.tenantId).toBe(tenantId);
    expect(instance.status).toBe('RUNNING');

    // Drain queue to advance tokens to Step 1 user task
    await workflowEngine.drainQueue();

    // Verify user task was spawned for the first step
    const openTasks = await uow.repos.userTasks.list({ instanceId: instance.id });
    expect(openTasks).toHaveLength(1);
    expect(openTasks[0].title).toBe('Request Submission');
    expect(openTasks[0].tenantId).toBe(tenantId);
  });
});
