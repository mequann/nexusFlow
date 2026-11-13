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
      fields: [
        { id: 'requesterName', label: 'Requester Full Name (የጠያቂው ሙሉ ስም)', type: 'string', required: true },
        { id: 'department', label: 'Department (ክፍል / ዳይሬክቶሬት)', type: 'string', required: true },
        { id: 'purpose', label: 'Purpose of Requisition (የፍጆታው ምክንያት)', type: 'string', required: true },
        { id: 'itemsRequested', label: 'Requested Items (የዕቃዎች ዝርዝር)', type: 'string', required: true },
        { id: 'itemCount', label: 'Total Quantity of Items', type: 'number', required: true },
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
              { id: 'approvalDecision', label: 'Decision (ውሳኔ)', type: 'string', required: true },
              { id: 'remarks', label: 'Remarks / Comments (አስተያየት)', type: 'string', required: false },
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
              { id: 'issuedQuantity', label: 'Quantity Issued (የተሰጠ መጠን)', type: 'number', required: true },
              { id: 'binCardNumber', label: 'Bin Card / Shelf Number (የካርድ ቁጥር)', type: 'string', required: true },
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
      fields: [
        { id: 'travelerName', label: 'Traveler Name (የተጓዡ ስም)', type: 'string', required: true },
        { id: 'destination', label: 'Destination / City (የጉዞው ቦታ)', type: 'string', required: true },
        { id: 'missionObjective', label: 'Mission Objective (የስራው ዓላማ)', type: 'string', required: true },
        { id: 'estimatedDays', label: 'Number of Days (የቀናት ብዛት)', type: 'number', required: true },
        { id: 'estimatedPerDiemEtb', label: 'Total Estimated Per Diem (ETB)', type: 'number', required: true },
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
              { id: 'directorDecision', label: 'Decision (ተፈቅዷል / አልተፈቀደም)', type: 'string', required: true },
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
              { id: 'auditApprovedAmountEtb', label: 'Audit Approved Per Diem (ETB)', type: 'number', required: true },
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
