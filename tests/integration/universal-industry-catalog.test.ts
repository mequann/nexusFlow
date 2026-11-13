import { describe, it, expect, beforeAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { NexusFlowModule } from '../../src/app.module.js';
import { TemplateController } from '../../src/interfaces/http/controllers/template.controller.js';
import { WorkflowService } from '../../src/application/services/workflow-service.js';
import { WorkflowEngine } from '../../src/application/engine/workflow-engine.js';
import { UNIT_OF_WORK } from '../../src/application/tokens.js';
import type { IUnitOfWork } from '../../src/domain/ports/repositories.js';
import { UNIVERSAL_INDUSTRY_TEMPLATES } from '../../src/application/templates/universal-industry-catalog.js';
import type { AuthPrincipal } from '../../src/domain/security/types.js';

describe('Universal Multi-Industry Workflow Platform (ሁለንተናዊ የኢንደስትሪ የስራ ፍሰቶች)', () => {
  let module: TestingModule;
  let templateController: TemplateController;
  let workflowService: WorkflowService;
  let engine: WorkflowEngine;
  let uow: IUnitOfWork;

  const mockPrincipal: AuthPrincipal = {
    userId: 'a0000000-0000-0000-0000-000000000001',
    email: 'executive@enterprise.et',
    role: 'ADMIN',
    tenantId: 'commercial-bank-of-ethiopia',
    permissions: new Set(['workflow:read', 'workflow:write', 'workflow:publish', 'instance:start', 'instance:read']),
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        NexusFlowModule.register({
          enableWorkers: false,
          enableDefaultMetrics: false,
          configOverrides: { STORAGE_DRIVER: 'memory' },
        }),
      ],
    }).compile();

    await module.init();

    templateController = module.get(TemplateController);
    workflowService = module.get(WorkflowService);
    engine = module.get(WorkflowEngine);
    uow = module.get<IUnitOfWork>(UNIT_OF_WORK);
  });

  it('1. Serves complete industry catalog spanning Banking, Healthcare, Supply Chain, Telecom, Legal, and DevOps', () => {
    const catalog = templateController.getCatalog();
    expect(catalog.total).toBeGreaterThanOrEqual(6);
    expect(catalog.items.map((i) => i.category)).toEqual(
      expect.arrayContaining(['BANKING', 'HEALTHCARE', 'SUPPLY_CHAIN', 'TELECOM', 'LEGAL', 'IT_DEVOPS']),
    );

    // Filter by BANKING
    const bankingOnly = templateController.getCatalog('BANKING');
    expect(bankingOnly.items).toHaveLength(1);
    expect(bankingOnly.items[0]?.key).toBe('banking-loan-origination');

    // Filter by HEALTHCARE
    const healthOnly = templateController.getCatalog('HEALTHCARE');
    expect(healthOnly.items).toHaveLength(1);
    expect(healthOnly.items[0]?.key).toBe('healthcare-prior-authorization');
  });

  it('2. Instantiates and publishes Banking Loan Origination template into tenant space', async () => {
    const res = await templateController.instantiate('banking-loan-origination', mockPrincipal);
    expect(res.workflow.status).toBe('PUBLISHED');
    expect(res.workflow.tenantId).toBe('commercial-bank-of-ethiopia');
    expect(res.workflow.key).toBe('banking-loan-origination');

    // Start instance from the newly published template
    const instance = await engine.startInstance({
      workflowKey: 'banking-loan-origination',
      tenantId: 'commercial-bank-of-ethiopia',
      initialVariables: {
        applicantName: 'Tadesse Agro Processing PLC',
        requestedAmount: 2500000,
        loanTermMonths: 36,
        creditScore: 780, // High score -> FAST_TRACK
        collateralValue: 4500000,
      },
    });

    await engine.drainQueue();

    // Verify DMN assessed LOW risk tier and advanced to underwriting
    const loaded = await uow.repos.instances.findById(instance.id);
    expect(loaded?.status).toBe('WAITING'); // Waiting on dual underwriting consensus user task
    expect(loaded?.variables.riskTier).toBe('LOW');
    expect(loaded?.variables.approvalPath).toBe('FAST_TRACK');
  });

  it('3. Instantiates and publishes Supply Chain P2P template and evaluates spending tiers', async () => {
    const res = await templateController.instantiate('supply-chain-procure-to-pay', mockPrincipal);
    expect(res.workflow.status).toBe('PUBLISHED');

    const instance = await engine.startInstance({
      workflowKey: 'supply-chain-procure-to-pay',
      tenantId: 'commercial-bank-of-ethiopia',
      initialVariables: {
        requisitionTitle: '100x Cisco Core Network Switches',
        totalEstimateEtb: 750000, // > 500k -> TIER_3 & requiresBoardApproval
        costCenter: 'IT Infrastructure',
        selectedSupplier: 'Cisco Systems East Africa',
      },
    });

    await engine.drainQueue();

    const loaded = await uow.repos.instances.findById(instance.id);
    expect(loaded?.status).toBe('WAITING'); // Paused on CFO/Finance approval
    expect(loaded?.variables.tier).toBe('TIER_3');
    expect(loaded?.variables.requiresBoardApproval).toBe(true);
  });
});
