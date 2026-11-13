import fs from 'node:fs';
import path from 'node:path';
import type { TenantWorkflowImportPayload } from '../../domain/workflow/tenant-import-types.js';

export const FALLBACK_EMPLOYEE_TRANSFER_PAYLOAD: TenantWorkflowImportPayload = {
  conflictMode: 'SkipExisting',
  workflows: [
    {
      code: 'EmployeeMasterTransfer',
      name: 'Employee Transfer Approval',
      description: 'Three-step sample: the employee submits a request, managers review it in parallel, and HR gives a conditional final approval.',
      country: 'ET',
      domainService: 'EmployeeMaster',
      version: 1,
      status: 'Published',
      isDefault: false,
      tags: ['transfer', 'employee-master', 'sample'],
      steps: [
        {
          stepOrder: 1,
          code: 'REQUEST_SUBMISSION',
          name: 'Request Submission',
          collaborationMode: 'Sequential',
          requiredParticipants: 1,
          buttonLabel: 'SUBMIT',
          timeLimitHours: 48,
          statuses: [
            { statusCode: 'DRAFT', name: 'Draft', isDefault: true, isTerminal: false },
            { statusCode: 'SUBMITTED', name: 'Submitted', isDefault: false, isTerminal: true },
          ],
          statusTransitions: [
            { fromStatusCode: 'DRAFT', toStatusCode: 'SUBMITTED', isAllowed: true },
          ],
          participantAssignment: {
            assignmentType: 'Role',
            participants: [{ id: '00000000-0000-0000-0000-000000000000', name: 'Employee', order: 1, isMandatory: true }],
            logic: 'Manual',
          },
          uiForms: [
            {
              formId: 'transfer_request_form',
              fields: [
                {
                  name: 'reason',
                  fieldLabel: 'Reason for Transfer',
                  type: 'Textarea',
                  source: null,
                  validations: [{ type: 'Required', parameter: null, message: 'Reason is required.' }],
                },
                {
                  name: 'requestTitle',
                  fieldLabel: 'Request Title',
                  type: 'Text',
                  source: null,
                  validations: [{ type: 'Required', parameter: null, message: 'Title is required.' }],
                },
                {
                  name: 'targetDepartment',
                  fieldLabel: 'Target Department',
                  type: 'Dropdown',
                  source: 'Finance & Accounts, Operations, Engineering, Human Resources',
                  validations: [{ type: 'Required', parameter: null, message: 'Target department is required.' }],
                },
                {
                  name: 'effectiveDate',
                  fieldLabel: 'Effective Date',
                  type: 'Date',
                  source: null,
                  validations: [{ type: 'Required', parameter: null, message: 'Effective date is required.' }],
                },
              ],
            },
          ],
        },
        {
          stepOrder: 2,
          code: 'MANAGER_REVIEW',
          name: 'Manager Review',
          collaborationMode: 'Parallel',
          requiredParticipants: 2,
          buttonLabel: 'REVIEW',
          timeLimitHours: 72,
          statuses: [
            { statusCode: 'PENDING', name: 'Pending Review', isDefault: true, isTerminal: false },
            { statusCode: 'APPROVED', name: 'Approved', isDefault: false, isTerminal: true },
            { statusCode: 'REJECTED', name: 'Rejected', isDefault: false, isTerminal: true },
          ],
          statusTransitions: [
            { fromStatusCode: 'PENDING', toStatusCode: 'APPROVED', isAllowed: true },
            { fromStatusCode: 'PENDING', toStatusCode: 'REJECTED', isAllowed: true },
          ],
          participantAssignment: {
            assignmentType: 'Role',
            participants: [{ id: '00000000-0000-0000-0000-000000000000', name: 'Department Managers', order: 1, isMandatory: true }],
            logic: 'All',
          },
        },
        {
          stepOrder: 3,
          code: 'HR_FINAL_APPROVAL',
          name: 'HR Final Approval',
          collaborationMode: 'Consensus',
          requiredParticipants: 3,
          buttonLabel: 'FINALIZE_TRANSFER',
          timeLimitHours: 96,
          statuses: [
            { statusCode: 'PENDING', name: 'Pending HR Signoff', isDefault: true, isTerminal: false },
            { statusCode: 'COMPLETED', name: 'Transfer Authorized', isDefault: false, isTerminal: true },
          ],
          statusTransitions: [
            { fromStatusCode: 'PENDING', toStatusCode: 'COMPLETED', isAllowed: true },
          ],
          participantAssignment: {
            assignmentType: 'Role',
            participants: [{ id: '00000000-0000-0000-0000-000000000000', name: 'HR Directors', order: 1, isMandatory: true }],
            logic: 'All',
          },
        },
      ],
    },
  ],
};

export function getStarterTenantImportPayload(): TenantWorkflowImportPayload {
  const candidatePaths = [
    path.resolve(process.cwd(), 'src/application/templates/tenant-workflow-import-template.json'),
    path.resolve(process.cwd(), 'dist/application/templates/tenant-workflow-import-template.json'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (parsed.workflows && Array.isArray(parsed.workflows) && parsed.workflows.length > 0) {
          return parsed as TenantWorkflowImportPayload;
        }
      } catch {
        // Fallback to embedded
      }
    }
  }

  return FALLBACK_EMPLOYEE_TRANSFER_PAYLOAD;
}
