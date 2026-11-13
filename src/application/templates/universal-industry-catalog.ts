import type { CreateWorkflowInput } from '../services/workflow-service.js';

export interface IndustryTemplateMeta {
  key: string;
  name: string;
  category: 'BANKING' | 'HEALTHCARE' | 'SUPPLY_CHAIN' | 'TELECOM' | 'LEGAL' | 'IT_DEVOPS' | 'GOVERNMENT' | 'HR_PEOPLE';
  industry: string;
  description: string;
  icon: string;
  features: string[];
  workflow: CreateWorkflowInput;
}

/**
 * 1. BANKING & FINTECH: Commercial & Retail Loan Origination
 * Multi-stage underwrite, DMN credit matrix, KYC check, and dual-signoff disbursement.
 */
export const BANKING_LOAN_ORIGINATION_TEMPLATE: IndustryTemplateMeta = {
  key: 'banking-loan-origination',
  name: 'Commercial & Retail Loan Origination (ባንክ የብድር አመላለስ)',
  category: 'BANKING',
  industry: 'Banking & Financial Services',
  description: 'Automates customer credit application, AML/KYC background check, dual underwriter signoff, and core banking disbursement.',
  icon: 'Banknote',
  features: ['DMN Risk Scoring', 'Dual-Underwriter Quorum', 'Core Banking Saga', 'AML / KYC Verification'],
  workflow: {
    key: 'banking-loan-origination',
    name: 'Commercial & Retail Loan Origination',
    description: 'Automates customer credit application, AML/KYC background check, dual underwriter signoff, and core banking disbursement.',
    createdBy: 'system',
    definition: {
      stages: ['APPLICATION', 'KYC_RISK_CHECK', 'UNDERWRITING_QUORUM', 'DISBURSEMENT', 'COMPLETED'],
      intakeFormSchema: {
        fields: [
          { name: 'applicantName', label: 'Applicant / Business Name', type: 'text', required: true },
          { name: 'requestedAmount', label: 'Requested Loan Amount (ETB / USD)', type: 'currency', required: true },
          { name: 'loanTermMonths', label: 'Repayment Term (Months)', type: 'number', required: true },
          { name: 'collateralValue', label: 'Collateral Appraised Value', type: 'currency', required: true },
          { name: 'creditScore', label: 'Credit Bureau Score', type: 'number', required: true },
        ],
      },
      nodes: [
        { id: 'start', type: 'trigger.manual', name: 'Submit Loan Application', config: {} },
        {
          id: 'risk_evaluation',
          type: 'bpmn.decision_table',
          name: 'DMN Credit Risk Assessment',
          config: {
            table: {
              hitPolicy: 'FIRST',
              rules: [
                {
                  id: 'high-score',
                  when: [{ field: 'creditScore', op: '>=', value: 750 }],
                  outputs: { riskTier: 'LOW', approvalPath: 'FAST_TRACK' },
                },
                {
                  id: 'low-score',
                  when: [{ field: 'creditScore', op: '<', value: 600 }],
                  outputs: { riskTier: 'HIGH', approvalPath: 'SENIOR_COMMITTEE' },
                },
              ],
              defaultOutputs: { riskTier: 'MEDIUM', approvalPath: 'STANDARD_QUORUM' },
            },
          },
        },
        {
          id: 'dual_underwriting',
          type: 'bpmn.user_task',
          name: 'Underwriting Dual-Signoff (Consensus Quorum)',
          config: {
            candidateGroup: 'credit_underwriters',
            requiredApprovals: 2,
            timeLimitHours: 48,
          },
        },
        {
          id: 'disburse_funds',
          type: 'action.http',
          name: 'Core Banking API Disbursement',
          config: {
            url: 'https://core-banking.internal/api/v1/loans/disburse',
            method: 'POST',
            body: {
              account: '{{ $vars.applicantName }}',
              amount: '{{ $vars.requestedAmount }}',
            },
          },
        },
        { id: 'end', type: 'bpmn.end', name: 'Loan Disbursed & Active', config: {} },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'risk_evaluation' },
        { id: 'e2', from: 'risk_evaluation', to: 'dual_underwriting' },
        { id: 'e3', from: 'dual_underwriting', to: 'disburse_funds' },
        { id: 'e4', from: 'disburse_funds', to: 'end' },
      ],
    },
  },
};

/**
 * 2. HEALTHCARE & LIFE SCIENCES: Medical Insurance Prior Authorization
 * Clinical triage, electronic health record (EHR) lookup, medical director review.
 */
export const HEALTHCARE_PRIOR_AUTH_TEMPLATE: IndustryTemplateMeta = {
  key: 'healthcare-prior-authorization',
  name: 'Clinical Prior Authorization & Treatment Triage',
  category: 'HEALTHCARE',
  industry: 'Healthcare, Hospitals & Health Insurance',
  description: 'Automates insurance pre-authorization for surgical procedures, specialized pharmacology, and medical director consensus review.',
  icon: 'Activity',
  features: ['HIPAA Compliant Vault', 'Clinical Urgent SLA (4h)', 'EHR Sync', 'Medical Director Review'],
  workflow: {
    key: 'healthcare-prior-authorization',
    name: 'Clinical Prior Authorization & Treatment Triage',
    description: 'Automates insurance pre-authorization for surgical procedures, specialized pharmacology, and medical director consensus review.',
    createdBy: 'system',
    definition: {
      stages: ['PATIENT_INTAKE', 'CLINICAL_TRIAGE', 'DIRECTOR_REVIEW', 'AUTHORIZED', 'COMPLETED'],
      intakeFormSchema: {
        fields: [
          { name: 'patientId', label: 'Patient Medical Record Number (MRN)', type: 'text', required: true },
          { name: 'diagnosisCode', label: 'ICD-10 Diagnosis Code', type: 'text', required: true },
          { name: 'procedureCode', label: 'CPT Procedure Code', type: 'text', required: true },
          { name: 'isUrgent', label: 'Emergency / Urgent Clinical Case', type: 'boolean', required: true },
          { name: 'estimatedCostEtb', label: 'Estimated Procedure Cost (ETB)', type: 'currency', required: true },
        ],
      },
      nodes: [
        { id: 'start', type: 'trigger.manual', name: 'Submit Prior Authorization', config: {} },
        {
          id: 'clinical_review',
          type: 'bpmn.user_task',
          name: 'Registered Nurse Clinical Triage',
          config: {
            candidateGroup: 'clinical_triagers',
            timeLimitHours: 12,
          },
        },
        {
          id: 'medical_director_approval',
          type: 'bpmn.user_task',
          name: 'Medical Director Signoff',
          config: {
            candidateGroup: 'medical_directors',
            timeLimitHours: 24,
          },
        },
        {
          id: 'notify_patient',
          type: 'action.http',
          name: 'SMS / Patient Portal Notification',
          config: {
            url: 'https://notifications.hospital.et/api/v1/sms/send',
            method: 'POST',
            body: { message: 'Your medical procedure authorization has been approved.' },
          },
        },
        { id: 'end', type: 'bpmn.end', name: 'Treatment Authorized', config: {} },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'clinical_review' },
        { id: 'e2', from: 'clinical_review', to: 'medical_director_approval' },
        { id: 'e3', from: 'medical_director_approval', to: 'notify_patient' },
        { id: 'e4', from: 'notify_patient', to: 'end' },
      ],
    },
  },
};

/**
 * 3. SUPPLY CHAIN, MANUFACTURING & LOGISTICS: Procure-to-Pay (P2P)
 * Purchase requisition, automated spending tier routing, 3-way invoice match, warehouse store issue.
 */
export const SUPPLY_CHAIN_P2P_TEMPLATE: IndustryTemplateMeta = {
  key: 'supply-chain-procure-to-pay',
  name: 'Procure-to-Pay & Warehouse Store Issue',
  category: 'SUPPLY_CHAIN',
  industry: 'Supply Chain, Logistics & Manufacturing',
  description: 'Controls procurement from purchase requisition, supplier quotation matrix, 3-way matching, to warehouse delivery issuance.',
  icon: 'Package',
  features: ['3-Way Matching', 'Tiered Financial Authority', 'Vendor ERP Integration', 'Inventory Deduction'],
  workflow: {
    key: 'supply-chain-procure-to-pay',
    name: 'Procure-to-Pay & Warehouse Store Issue',
    description: 'Controls procurement from purchase requisition, supplier quotation matrix, 3-way matching, to warehouse delivery issuance.',
    createdBy: 'system',
    definition: {
      stages: ['REQUISITION', 'QUOTATIONS_REVIEW', 'FINANCE_AUDIT', 'WAREHOUSE_RECEIPT', 'PAID'],
      intakeFormSchema: {
        fields: [
          { name: 'requisitionTitle', label: 'Item / Material Description', type: 'text', required: true },
          { name: 'costCenter', label: 'Department Cost Center', type: 'text', required: true },
          { name: 'totalEstimateEtb', label: 'Total Value (ETB)', type: 'currency', required: true },
          { name: 'selectedSupplier', label: 'Preferred Supplier / Vendor', type: 'text', required: true },
        ],
      },
      nodes: [
        { id: 'start', type: 'trigger.manual', name: 'Submit Purchase Requisition', config: {} },
        {
          id: 'procurement_matrix',
          type: 'bpmn.decision_table',
          name: 'Spending Threshold Gateway',
          config: {
            table: {
              hitPolicy: 'FIRST',
              rules: [
                {
                  id: 'tier-3',
                  when: [{ field: 'totalEstimateEtb', op: '>', value: 500000 }],
                  outputs: { requiresBoardApproval: true, tier: 'TIER_3' },
                },
                {
                  id: 'tier-2',
                  when: [{ field: 'totalEstimateEtb', op: '>', value: 100000 }],
                  outputs: { requiresBoardApproval: false, tier: 'TIER_2' },
                },
              ],
              defaultOutputs: { requiresBoardApproval: false, tier: 'TIER_1' },
            },
          },
        },
        {
          id: 'finance_approval',
          type: 'bpmn.user_task',
          name: 'CFO / Finance Approval',
          config: { candidateGroup: 'finance_executives', timeLimitHours: 48 },
        },
        {
          id: 'sap_po_creation',
          type: 'action.http',
          name: 'ERP / SAP Purchase Order Dispatch',
          config: {
            url: 'https://sap.enterprise.internal/po/create',
            method: 'POST',
            body: { vendor: '{{ $vars.selectedSupplier }}', amount: '{{ $vars.totalEstimateEtb }}' },
          },
        },
        { id: 'end', type: 'bpmn.end', name: 'PO Dispatched & Tracked', config: {} },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'procurement_matrix' },
        { id: 'e2', from: 'procurement_matrix', to: 'finance_approval' },
        { id: 'e3', from: 'finance_approval', to: 'sap_po_creation' },
        { id: 'e4', from: 'sap_po_creation', to: 'end' },
      ],
    },
  },
};

/**
 * 4. TELECOM & UTILITIES: Fiber Broadband Service Provisioning
 * Customer onboarding, Optical Line Terminal (OLT) port assignment, technician dispatch with heartbeats.
 */
export const TELECOM_PROVISIONING_TEMPLATE: IndustryTemplateMeta = {
  key: 'telecom-broadband-provisioning',
  name: 'Fiber Broadband Activation & Dispatch',
  category: 'TELECOM',
  industry: 'Telecommunications & Utilities',
  description: 'Orchestrates subscriber fiber broadband provisioning, port allocation, field technician dispatch, and automated billing activation.',
  icon: 'Wifi',
  features: ['External Task Heartbeating', 'Field Tech Mobile App', 'RADIUS / OLT Config', 'Billing Saga Rollback'],
  workflow: {
    key: 'telecom-broadband-provisioning',
    name: 'Fiber Broadband Activation & Dispatch',
    description: 'Orchestrates subscriber fiber broadband provisioning, port allocation, field technician dispatch, and automated billing activation.',
    createdBy: 'system',
    definition: {
      stages: ['ORDER_PLACED', 'NETWORK_FEASIBILITY', 'FIELD_DISPATCH', 'LINE_TESTING', 'ACTIVE'],
      intakeFormSchema: {
        fields: [
          { name: 'subscriberName', label: 'Subscriber Full Name', type: 'text', required: true },
          { name: 'installationAddress', label: 'GPS Coordinates / Street Address', type: 'text', required: true },
          { name: 'packageSpeedMbps', label: 'Speed Tier (Mbps)', type: 'number', required: true },
          { name: 'contactPhone', label: 'Subscriber Mobile Phone', type: 'text', required: true },
        ],
      },
      nodes: [
        { id: 'start', type: 'trigger.manual', name: 'Receive Fiber Order', config: {} },
        {
          id: 'tech_dispatch',
          type: 'action.transform',
          name: 'Assign Technician & OLT Port',
          config: {
            assignedTechnician: 'Tech-Addis-04',
            ontSerialNumber: 'ONT-HW-2026-99',
            portId: 'OLT-08-PORT-14',
          },
        },
        {
          id: 'field_installation',
          type: 'bpmn.user_task',
          name: 'Field Technician Installation & Splicing',
          config: {
            candidateGroup: 'field_technicians',
            timeLimitHours: 72,
          },
        },
        {
          id: 'activate_radius',
          type: 'action.http',
          name: 'Activate AAA / RADIUS Billing',
          config: {
            url: 'https://radius.telecom.et/api/subscribers/activate',
            method: 'POST',
            body: { phone: '{{ $vars.contactPhone }}', speed: '{{ $vars.packageSpeedMbps }}' },
          },
        },
        { id: 'end', type: 'bpmn.end', name: 'Service Activated & Online', config: {} },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'tech_dispatch' },
        { id: 'e2', from: 'tech_dispatch', to: 'field_installation' },
        { id: 'e3', from: 'field_installation', to: 'activate_radius' },
        { id: 'e4', from: 'activate_radius', to: 'end' },
      ],
    },
  },
};

/**
 * 5. LEGAL & COMPLIANCE: Contract Lifecycle Management (CLM)
 * NDA & contract negotiation, legal counsel review, executive consensus, and digital cryptographic seal.
 */
export const LEGAL_CLM_TEMPLATE: IndustryTemplateMeta = {
  key: 'legal-contract-lifecycle',
  name: 'Enterprise Contract Lifecycle & NDA Review',
  category: 'LEGAL',
  industry: 'Legal, Corporate Governance & Compliance',
  description: 'Manages master service agreements (MSA), vendor contracts, legal redlining, cross-departmental approval, and digital seals.',
  icon: 'FileText',
  features: ['Digital HMAC-SHA256 Seal', 'Public QR Verification', 'Collaborative Minutes', 'Audit Trail'],
  workflow: {
    key: 'legal-contract-lifecycle',
    name: 'Enterprise Contract Lifecycle & NDA Review',
    description: 'Manages master service agreements (MSA), vendor contracts, legal redlining, cross-departmental approval, and digital seals.',
    createdBy: 'system',
    definition: {
      stages: ['DRAFT_CONTRACT', 'LEGAL_REVIEW', 'EXECUTIVE_CONSENSUS', 'DIGITALLY_SEALED', 'EXECUTED'],
      intakeFormSchema: {
        fields: [
          { name: 'contractTitle', label: 'Agreement / Contract Title', type: 'text', required: true },
          { name: 'counterpartyName', label: 'Counterparty Organization', type: 'text', required: true },
          { name: 'contractValueEtb', label: 'Contract Value (ETB / USD)', type: 'currency', required: true },
          { name: 'effectiveDate', label: 'Effective Date', type: 'date', required: true },
        ],
      },
      nodes: [
        { id: 'start', type: 'trigger.manual', name: 'Submit Agreement Draft', config: {} },
        {
          id: 'legal_counsel_review',
          type: 'bpmn.user_task',
          name: 'General Counsel Risk Analysis & Redline',
          config: { candidateGroup: 'legal_counsel', timeLimitHours: 48 },
        },
        {
          id: 'executive_signoff',
          type: 'bpmn.user_task',
          name: 'Executive Committee Consensus Approval',
          config: { candidateGroup: 'executive_committee', requiredApprovals: 2, timeLimitHours: 48 },
        },
        { id: 'end', type: 'bpmn.end', name: 'Contract Digitally Executed & Archived', config: {} },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'legal_counsel_review' },
        { id: 'e2', from: 'legal_counsel_review', to: 'executive_signoff' },
        { id: 'e3', from: 'executive_signoff', to: 'end' },
      ],
    },
  },
};

/**
 * 6. IT, SAAS & DEVOPS: Change Advisory Board (CAB) & Automated Deployment
 * Production release gating, test automation check, Canary verification, automatic rollback compensation.
 */
export const IT_CAB_DEPLOYMENT_TEMPLATE: IndustryTemplateMeta = {
  key: 'it-cab-deployment-pipeline',
  name: 'DevOps Change Advisory Board (CAB) & Deployment',
  category: 'IT_DEVOPS',
  industry: 'Software, IT Infrastructure & Cloud DevOps',
  description: 'Guarantees production change safety: architecture risk scoring, CAB approval, canary rollout, and automatic rollback on alerts.',
  icon: 'Cpu',
  features: ['Saga Rollback Compensation', 'Canary Health Probing', 'Slack / Webhook Alerting', 'Audit Trail'],
  workflow: {
    key: 'it-cab-deployment-pipeline',
    name: 'DevOps Change Advisory Board (CAB) & Deployment',
    description: 'Guarantees production change safety: architecture risk scoring, CAB approval, canary rollout, and automatic rollback on alerts.',
    createdBy: 'system',
    definition: {
      stages: ['RFC_SUBMITTED', 'AUTOMATED_TESTS', 'CAB_APPROVAL', 'CANARY_DEPLOYMENT', 'PRODUCTION_ACTIVE'],
      intakeFormSchema: {
        fields: [
          { name: 'releaseVersion', label: 'Release Tag / Semantic Version', type: 'text', required: true },
          { name: 'serviceName', label: 'Target Microservice Name', type: 'text', required: true },
          { name: 'isHighRisk', label: 'High Risk Database Schema Migration', type: 'boolean', required: true },
          { name: 'rollbackPlan', label: 'Documented Rollback Procedure', type: 'text', required: true },
        ],
      },
      nodes: [
        { id: 'start', type: 'trigger.manual', name: 'Request For Change (RFC)', config: {} },
        {
          id: 'cab_approval',
          type: 'bpmn.user_task',
          name: 'CAB Senior Leadership Approval',
          config: { candidateGroup: 'cab_architects', timeLimitHours: 24 },
        },
        {
          id: 'deploy_k8s',
          type: 'action.http',
          name: 'Trigger Kubernetes Blue/Green Deployment',
          config: {
            url: 'https://ci.devops.internal/deploy/k8s',
            method: 'POST',
            body: { service: '{{ $vars.serviceName }}', tag: '{{ $vars.releaseVersion }}' },
          },
        },
        { id: 'end', type: 'bpmn.end', name: 'Production Deployed Successfully', config: {} },
      ],
      edges: [
        { id: 'e1', from: 'start', to: 'cab_approval' },
        { id: 'e2', from: 'cab_approval', to: 'deploy_k8s' },
        { id: 'e3', from: 'deploy_k8s', to: 'end' },
      ],
    },
  },
};

/**
 * Universal Template Registry Master Array
 */
export const UNIVERSAL_INDUSTRY_TEMPLATES: IndustryTemplateMeta[] = [
  BANKING_LOAN_ORIGINATION_TEMPLATE,
  HEALTHCARE_PRIOR_AUTH_TEMPLATE,
  SUPPLY_CHAIN_P2P_TEMPLATE,
  TELECOM_PROVISIONING_TEMPLATE,
  LEGAL_CLM_TEMPLATE,
  IT_CAB_DEPLOYMENT_TEMPLATE,
];
