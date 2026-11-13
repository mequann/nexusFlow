import { CreateWorkflowInput } from '../services/workflow-service.js';

/**
 * Pre-configured turnkey workflow templates for Ethiopian administrative offices.
 */

/**
 * 1. Model 20: Store Issue Voucher (ሞዴል 20 የእቃ ወጪ ማዘዣ)
 * Regulates requisition and distribution of supplies and inventory.
 */
export const MODEL_20_STORE_ISSUE_TEMPLATE: CreateWorkflowInput = {
  key: 'eth-model-20-store-issue',
  name: 'Model 20 - Store Issue Voucher (ሞዴል 20 የእቃ ወጪ ማዘዣ)',
  description: 'Standard Ethiopian public & enterprise store requisition for inventory issuance',
  createdBy: 'system',
  definition: {
    intakeFormSchema: {
      title: 'Model 20 Store Issue Voucher',
      fields: [
        { name: 'requesterName', label: 'Requester Full Name (የጠያቂው ሙሉ ስም)', type: 'text', required: true },
        { name: 'department', label: 'Department (ክፍል / ዳይሬክቶሬት)', type: 'text', required: true },
        { name: 'purpose', label: 'Purpose of Requisition (የፍጆታው ምክንያት)', type: 'text', required: true },
        { name: 'itemsRequested', label: 'Requested Items (የዕቃዎች ዝርዝር)', type: 'text', required: true },
        { name: 'itemCount', label: 'Total Quantity of Items', type: 'number', required: false },
      ],
    },
    stages: ['SUBMITTED', 'DEPT_REVIEW', 'STORE_DISPATCH', 'COMPLETED'],
    nodes: [
      {
        id: 'start_requisition',
        type: 'trigger.manual',
        name: 'Submit Model 20 Requisition',
        config: {},
      },
      {
        id: 'dept_head_approval',
        type: 'bpmn.user_task',
        name: 'Department Head Approval (የክፍል ኃላፊ ፈቃድ)',
        config: {
          candidateGroup: 'department_heads',
          dueInSeconds: 86400, // 24 hours
          taskSchema: {
            fields: [
              { name: 'approvalDecision', label: 'Decision (ውሳኔ)', type: 'text', required: true },
              { name: 'remarks', label: 'Remarks / Comments (አስተያየት)', type: 'text', required: false },
            ],
          },
        },
      },
      {
        id: 'storekeeper_fulfillment',
        type: 'bpmn.user_task',
        name: 'Storekeeper Fulfillment & Voucher Stamping (የዕቃ ማረጋገጫ)',
        config: {
          candidateGroup: 'storekeepers',
          dueInSeconds: 172800, // 48 hours
          taskSchema: {
            fields: [
              { name: 'issuedQuantity', label: 'Quantity Issued (የተሰጠ መጠን)', type: 'number', required: true },
              { name: 'binCardNumber', label: 'Bin Card / Shelf Number (የካርድ ቁጥር)', type: 'text', required: true },
            ],
          },
        },
      },
      {
        id: 'finish_issuance',
        type: 'bpmn.end',
        name: 'Model 20 Finalized & Archived',
        config: {},
      },
    ],
    edges: [
      { id: 'e1', from: 'start_requisition', to: 'dept_head_approval' },
      { id: 'e2', from: 'dept_head_approval', to: 'storekeeper_fulfillment' },
      { id: 'e3', from: 'storekeeper_fulfillment', to: 'finish_issuance' },
    ],
  },
};

export const ETHIOPIAN_STORE_MODEL_20_TEMPLATE: CreateWorkflowInput = {
  ...MODEL_20_STORE_ISSUE_TEMPLATE,
  key: 'ethiopian-store-model-20',
};

/**
 * 2. Field Mission & Per Diem Requisition (የስራ ጉዞ እና አበል ጥያቄ)
 * Governs employee travel authorizations and subsistence allowance calculations.
 */
export const PER_DIEM_TRAVEL_TEMPLATE: CreateWorkflowInput = {
  key: 'eth-per-diem-travel',
  name: 'Field Mission & Per Diem (የስራ ጉዞ እና አበል ክፍያ)',
  description: 'Authorization for official field missions, vehicle allocation, and per-diem allowance',
  createdBy: 'system',
  definition: {
    intakeFormSchema: {
      title: 'Field Mission & Per Diem Requisition',
      fields: [
        { name: 'travelerName', label: 'Traveler Name (የተጓዡ ስም)', type: 'text', required: true },
        { name: 'destination', label: 'Destination / City (የጉዞው ቦታ)', type: 'text', required: true },
        { name: 'missionObjective', label: 'Mission Objective (የስራው ዓላማ)', type: 'text', required: true },
        { name: 'estimatedDays', label: 'Number of Days (የቀናት ብዛት)', type: 'number', required: false },
        { name: 'estimatedPerDiemEtb', label: 'Total Estimated Per Diem (ETB)', type: 'number', required: true },
      ],
    },
    stages: ['REQUESTED', 'DIRECTOR_APPROVAL', 'AUDIT_VERIFICATION', 'DISBURSEMENT'],
    nodes: [
      {
        id: 'start_travel_req',
        type: 'trigger.manual',
        name: 'Submit Travel Request',
        config: {},
      },
      {
        id: 'director_approval',
        type: 'bpmn.user_task',
        name: 'Director Authorization (የዳይሬክተር ፈቃድ)',
        config: {
          candidateGroup: 'directors',
          dueInSeconds: 86400,
          taskSchema: {
            fields: [
              { name: 'directorDecision', label: 'Decision (ተፈቅዷል / አልተፈቀደም)', type: 'text', required: true },
            ],
          },
        },
      },
      {
        id: 'internal_audit_check',
        type: 'bpmn.user_task',
        name: 'Internal Audit Rate Verification (የአበል ተመን ማረጋገጫ)',
        config: {
          candidateGroup: 'internal_auditors',
          dueInSeconds: 86400,
          taskSchema: {
            fields: [
              { name: 'auditApprovedAmountEtb', label: 'Audit Approved Per Diem (ETB)', type: 'number', required: true },
            ],
          },
        },
      },
      {
        id: 'end_travel',
        type: 'bpmn.end',
        name: 'Per Diem Approved for Disbursement',
        config: {},
      },
    ],
    edges: [
      { id: 'te1', from: 'start_travel_req', to: 'director_approval' },
      { id: 'te2', from: 'director_approval', to: 'internal_audit_check' },
      { id: 'te3', from: 'internal_audit_check', to: 'end_travel' },
    ],
  },
};

export const ETHIOPIAN_FIELD_MISSION_PER_DIEM_TEMPLATE: CreateWorkflowInput = {
  ...PER_DIEM_TRAVEL_TEMPLATE,
  key: 'ethiopian-field-mission-per-diem',
};
