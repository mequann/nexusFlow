import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NexusFlowModule } from '../src/app.module.js';
import { AuthService } from '../src/application/services/auth-service.js';
import { WorkflowService } from '../src/application/services/workflow-service.js';

async function seed(): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(
    NexusFlowModule.register({ enableWorkers: false }),
    { logger: ['error', 'warn'] },
  );

  try {
    const authService = ctx.get(AuthService);
    const workflowService = ctx.get(WorkflowService);

    await authService.bootstrapAdminIfEmpty();

    const existing = await workflowService.list({ key: 'order-fulfillment-hybrid' });
    if (existing.length === 0) {
      const wf = await workflowService.createWorkflow({
        key: 'order-fulfillment-hybrid',
        name: 'Enterprise Order Fulfillment (Camunda BPMN + n8n Hybrid)',
        description:
          'Demonstrates DMN Decision Table risk scoring, parallel fork/join, human approval user task, message correlation, and Saga compensation.',
        webhookSecret: 'demo-webhook-secret',
        createdBy: null,
        definition: {
          sagaEnabled: true,
          nodes: [
            {
              id: 'webhook_in',
              name: 'Order Webhook Trigger',
              type: 'trigger.webhook',
              config: { path: 'orders/submit' },
            },
            {
              id: 'risk_dmn',
              name: 'Credit & Risk DMN Table',
              type: 'bpmn.decision_table',
              config: {
                input: {
                  amount: '{{ $trigger.body.amount }}',
                  tier: '{{ $trigger.body.tier }}',
                },
                table: {
                  hitPolicy: 'FIRST',
                  rules: [
                    {
                      id: 'high-value',
                      when: [{ field: 'amount', op: '>=', value: 1000 }],
                      outputs: { requiresApproval: true, priority: 'HIGH' },
                    },
                  ],
                  defaultOutputs: { requiresApproval: false, priority: 'NORMAL' },
                },
              },
            },
            {
              id: 'approval_gate',
              name: 'Needs Human Approval?',
              type: 'logic.if',
              config: { condition: '$vars.requiresApproval == true' },
            },
            {
              id: 'manager_approval',
              name: 'Finance Manager Approval',
              type: 'bpmn.user_task',
              config: {
                title: 'Approve Order {{ $trigger.body.orderId }}',
                candidateGroup: 'finance',
              },
            },
            {
              id: 'complete_order',
              name: 'Finalize Order',
              type: 'action.transform',
              config: {
                mapping: {
                  fulfilledAt: '{{ $now() }}',
                  orderId: '{{ $trigger.body.orderId }}',
                },
              },
            },
            { id: 'end', name: 'Order Completed', type: 'bpmn.end', config: {} },
          ],
          edges: [
            { id: 'e1', from: 'webhook_in', to: 'risk_dmn' },
            { id: 'e2', from: 'risk_dmn', to: 'approval_gate' },
            { id: 'e3', from: 'approval_gate', to: 'manager_approval', branch: 'true' },
            { id: 'e4', from: 'approval_gate', to: 'complete_order', branch: 'false' },
            { id: 'e5', from: 'manager_approval', to: 'complete_order' },
            { id: 'e6', from: 'complete_order', to: 'end' },
          ],
        },
      });

      await workflowService.publishWorkflow(wf.id);
      console.log(`Seeded and published workflow '${wf.key}' (id=${wf.id})`);
    } else {
      console.log('Seed workflow already exists; skipping.');
    }
  } finally {
    await ctx.close();
  }
}

void seed();

