import type { CreateWorkflowInput } from '../services/workflow-service.js';

export const PROCUREMENT_CAPEX_TEMPLATE: CreateWorkflowInput = {
  key: 'procurement-capex-approval',
  name: 'Enterprise Procurement & CapEx Approval (Camunda + n8n + Kissflow)',
  description:
    'Solves real-world procurement approvals: Kissflow intake form validation & SLA escalation, Camunda DMN spend policy & 2-of-N quorum approval, n8n parallel ERP + Slack sync, Goods Receipt message correlation, and Saga PO voiding.',
  webhookSecret: 'procurement-webhook-secret',
  createdBy: null,
  definition: {
    sagaEnabled: true,
    stages: [
      'Intake',
      'Spend Policy',
      'Executive Approval',
      'ERP Fulfillment',
      'Completed',
    ],
    intakeFormSchema: {
      title: 'CapEx Purchase Request',
      fields: [
        { name: 'poNumber', label: 'PO Number', type: 'text', required: true },
        { name: 'vendorName', label: 'Vendor', type: 'text', required: true },
        { name: 'amount', label: 'Amount (USD)', type: 'currency', required: true, min: 1 },
        {
          name: 'costCenter',
          type: 'select',
          required: true,
          options: ['CC-ENG', 'CC-OPS', 'CC-FIN'],
        },
      ],
    },
    nodes: [
      {
        id: 'intake_webhook',
        name: 'Procurement Request Intake',
        type: 'trigger.webhook',
        stage: 'Intake',
        config: { path: 'procurement/submit' },
      },
      {
        id: 'spend_policy_dmn',
        name: 'Spend Policy DMN Table',
        type: 'bpmn.decision_table',
        stage: 'Spend Policy',
        config: {
          input: {
            amount: '{{ $trigger.body.amount }}',
            costCenter: '{{ $trigger.body.costCenter }}',
          },
          table: {
            hitPolicy: 'FIRST',
            rules: [
              {
                id: 'capex-executive',
                when: [{ field: 'amount', op: '>=', value: 25000 }],
                outputs: { approvalRequired: true, requiredQuorum: 2, slaMinutes: 60 },
              },
              {
                id: 'opex-manager',
                when: [{ field: 'amount', op: '>=', value: 1000 }],
                outputs: { approvalRequired: true, requiredQuorum: 1, slaMinutes: 120 },
              },
            ],
            defaultOutputs: { approvalRequired: false, requiredQuorum: 1, slaMinutes: 240 },
          },
        },
      },
      {
        id: 'approval_gate',
        name: 'Requires Human Approval?',
        type: 'logic.if',
        stage: 'Spend Policy',
        config: { condition: '$vars.approvalRequired == true' },
      },
      {
        id: 'finance_approval',
        name: 'Finance & Executive Approval',
        type: 'bpmn.user_task',
        stage: 'Executive Approval',
        config: {
          title: 'Approve PO {{ $trigger.body.poNumber }} ({{ $trigger.body.vendorName }})',
          candidateGroup: 'finance',
          requiredApprovals: '{{ $vars.requiredQuorum }}',
          slaMinutes: '{{ $vars.slaMinutes }}',
          escalateTo: 'cfo@nexusflow.local',
          formSchema: {
            fields: [{ name: 'budgetCode', label: 'Budget Code', type: 'text', required: true }],
          },
        },
      },
      {
        id: 'parallel_erp',
        name: 'Parallel ERP & Notification',
        type: 'logic.parallel',
        stage: 'ERP Fulfillment',
        config: {},
      },
      {
        id: 'create_erp_po',
        name: 'Create ERP Purchase Order',
        type: 'action.transform',
        stage: 'ERP Fulfillment',
        config: {
          mapping: {
            erpPoCreated: true,
            poNumber: '{{ $trigger.body.poNumber }}',
            issuedAt: '{{ $now() }}',
          },
        },
        compensateNodeId: 'void_erp_po',
      },
      {
        id: 'notify_procurement',
        name: 'Prepare Stakeholder Notice',
        type: 'action.transform',
        stage: 'ERP Fulfillment',
        config: { mapping: { stakeholderNotified: true } },
      },
      {
        id: 'join_erp',
        name: 'Join ERP & Notice',
        type: 'logic.join',
        stage: 'ERP Fulfillment',
        config: {},
      },
      {
        id: 'await_goods_receipt',
        name: 'Await Warehouse Goods Receipt',
        type: 'bpmn.message_catch',
        stage: 'ERP Fulfillment',
        config: {
          messageName: 'goods.received',
          correlationKey: '{{ $trigger.body.poNumber }}',
        },
      },
      {
        id: 'void_erp_po',
        name: 'Void ERP Purchase Order',
        type: 'action.transform',
        config: { mapping: { erpPoVoided: true } },
        isCompensationHandler: true,
      },
      { id: 'end', name: 'Procurement Closed', type: 'bpmn.end', stage: 'Completed', config: {} },
    ],
    edges: [
      { id: 'e1', from: 'intake_webhook', to: 'spend_policy_dmn' },
      { id: 'e2', from: 'spend_policy_dmn', to: 'approval_gate' },
      { id: 'e3', from: 'approval_gate', to: 'finance_approval', branch: 'true' },
      { id: 'e4', from: 'approval_gate', to: 'parallel_erp', branch: 'false' },
      { id: 'e5', from: 'finance_approval', to: 'parallel_erp' },
      { id: 'e6', from: 'parallel_erp', to: 'create_erp_po' },
      { id: 'e7', from: 'parallel_erp', to: 'notify_procurement' },
      { id: 'e8', from: 'create_erp_po', to: 'join_erp' },
      { id: 'e9', from: 'notify_procurement', to: 'join_erp' },
      { id: 'e10', from: 'join_erp', to: 'await_goods_receipt' },
      { id: 'e11', from: 'await_goods_receipt', to: 'end' },
    ],
  },
};

