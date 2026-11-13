import { describe, expect, it } from 'vitest';
import { WorkflowService } from '../../src/application/services/workflow-service.js';
import { MemoryUnitOfWork } from '../../src/infrastructure/repositories/memory/memory-uow.js';

describe('Multi-Tenant Enterprise Workflow Isolation', () => {
  it('allows different tenants to have custom workflows with the identical key without conflict', async () => {
    const uow = new MemoryUnitOfWork();
    const service = new WorkflowService(uow);

    // Tenant A: ACME Corp defines their capex approval workflow
    const acmeWorkflow = await service.createWorkflow({
      tenantId: 'acme_corp',
      key: 'capex-approval',
      name: 'ACME 3-Step Capex Approval',
      definition: {
        nodes: [
          { id: 'start', name: 'Start', type: 'trigger.manual', config: {} },
          { id: 'mgr', name: 'Manager Signoff', type: 'bpmn.user_task', config: { title: 'ACME Manager' } },
          { id: 'end', name: 'Done', type: 'bpmn.end', config: {} },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'mgr' },
          { id: 'e2', from: 'mgr', to: 'end' },
        ],
      },
      createdBy: 'acme-admin',
    });

    // Tenant B: Globex Corp defines their DIFFERENT capex approval workflow with the SAME key
    const globexWorkflow = await service.createWorkflow({
      tenantId: 'globex',
      key: 'capex-approval',
      name: 'Globex 5-Step Fast Capex',
      definition: {
        nodes: [
          { id: 'start', name: 'Start', type: 'trigger.manual', config: {} },
          { id: 'finance', name: 'Finance Review', type: 'bpmn.user_task', config: { title: 'Globex Finance' } },
          { id: 'vp', name: 'VP Review', type: 'bpmn.user_task', config: { title: 'Globex VP' } },
          { id: 'end', name: 'Done', type: 'bpmn.end', config: {} },
        ],
        edges: [
          { id: 'e1', from: 'start', to: 'finance' },
          { id: 'e2', from: 'finance', to: 'vp' },
          { id: 'e3', from: 'vp', to: 'end' },
        ],
      },
      createdBy: 'globex-admin',
    });

    expect(acmeWorkflow.id).not.toBe(globexWorkflow.id);
    expect(acmeWorkflow.tenantId).toBe('acme_corp');
    expect(globexWorkflow.tenantId).toBe('globex');
    expect(acmeWorkflow.key).toBe('capex-approval');
    expect(globexWorkflow.key).toBe('capex-approval');

    // Querying workflows for ACME must never return Globex workflows
    const acmeList = await service.list({ tenantId: 'acme_corp' });
    expect(acmeList).toHaveLength(1);
    expect(acmeList[0]?.name).toBe('ACME 3-Step Capex Approval');

    // Querying workflows for Globex must never return ACME workflows
    const globexList = await service.list({ tenantId: 'globex' });
    expect(globexList).toHaveLength(1);
    expect(globexList[0]?.name).toBe('Globex 5-Step Fast Capex');
  });

  it('isolates instances and user tasks across tenants', async () => {
    const uow = new MemoryUnitOfWork();

    // Create an instance for Tenant A
    await uow.repos.instances.create({
      id: 'inst-acme-1',
      tenantId: 'acme_corp',
      workflowId: 'wf-1',
      workflowKey: 'procurement',
      workflowVersion: 1,
      status: 'RUNNING',
      currentStage: null,
      slaStatus: 'ON_TRACK',
      triggerType: 'manual',
      triggerPayload: {},
      variables: {},
      correlationKey: null,
      parentInstanceId: null,
      parentTokenId: null,
      startedBy: 'acme-user-1',
      occVersion: 1,
      startedAt: new Date(),
      completedAt: null,
      updatedAt: new Date(),
    });

    // Create an instance for Tenant B
    await uow.repos.instances.create({
      id: 'inst-globex-1',
      tenantId: 'globex',
      workflowId: 'wf-2',
      workflowKey: 'procurement',
      workflowVersion: 1,
      status: 'RUNNING',
      currentStage: null,
      slaStatus: 'ON_TRACK',
      triggerType: 'manual',
      triggerPayload: {},
      variables: {},
      correlationKey: null,
      parentInstanceId: null,
      parentTokenId: null,
      startedBy: 'globex-user-1',
      occVersion: 1,
      startedAt: new Date(),
      completedAt: null,
      updatedAt: new Date(),
    });

    // Query by tenant
    const acmeInstances = await uow.repos.instances.list({ tenantId: 'acme_corp' });
    expect(acmeInstances).toHaveLength(1);
    expect(acmeInstances[0]?.id).toBe('inst-acme-1');

    const globexInstances = await uow.repos.instances.list({ tenantId: 'globex' });
    expect(globexInstances).toHaveLength(1);
    expect(globexInstances[0]?.id).toBe('inst-globex-1');
  });
});

