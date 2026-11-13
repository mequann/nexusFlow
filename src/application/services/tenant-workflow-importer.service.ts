import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowService } from './workflow-service.js';
import {
  TenantWorkflowImportPayload,
  TenantWorkflowDefinitionInput,
  ImportValidationResult,
  ImportProcessResult,
  TenantWorkflowStep,
} from '../../domain/workflow/tenant-import-types.js';
import {
  WorkflowGraphDefinition,
  NodeDefinition,
  EdgeDefinition,
} from '../../domain/workflow/types.js';
import { ValidationError } from '../../domain/errors.js';

@Injectable()
export class TenantWorkflowImporterService {
  private readonly logger = new Logger(TenantWorkflowImporterService.name);

  constructor(
    @Inject(WorkflowService) private readonly workflowService: WorkflowService,
  ) {}

  /**
   * Validates the enterprise tenant workflow import payload against structural and business constraints.
   */
  public validate(payload: TenantWorkflowImportPayload): ImportValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!payload.workflows || !Array.isArray(payload.workflows) || payload.workflows.length === 0) {
      return {
        isValid: false,
        errors: ['Import payload must contain a non-empty "workflows" array.'],
        warnings: [],
        summary: { totalWorkflows: 0, validWorkflows: 0 },
      };
    }

    let validCount = 0;

    for (const [wfIdx, wf] of payload.workflows.entries()) {
      const prefix = `Workflow[${wfIdx}] (${wf.code || 'UNKNOWN'}):`;

      if (!wf.code) errors.push(`${prefix} "code" is required.`);
      if (!wf.name) errors.push(`${prefix} "name" is required.`);
      if (!wf.domainService) errors.push(`${prefix} "domainService" is required.`);
      if (!wf.steps || !Array.isArray(wf.steps) || wf.steps.length === 0) {
        errors.push(`${prefix} must contain at least one step.`);
        continue;
      }

      // Check step code uniqueness
      const stepCodes = new Set<string>();
      let hasWfError = false;

      for (const [stepIdx, step] of wf.steps.entries()) {
        const stepPrefix = `${prefix} Step[${stepIdx}] (${step.code || 'UNKNOWN'}):`;

        if (!step.code) {
          errors.push(`${stepPrefix} "code" is required.`);
          hasWfError = true;
        } else if (stepCodes.has(step.code)) {
          errors.push(`${stepPrefix} duplicate step code '${step.code}'.`);
          hasWfError = true;
        } else {
          stepCodes.add(step.code);
        }

        // Validate statuses
        if (!step.statuses || step.statuses.length === 0) {
          errors.push(`${stepPrefix} must define at least one status.`);
          hasWfError = true;
        } else {
          const defaultStatuses = step.statuses.filter((s) => s.isDefault);
          const terminalStatuses = step.statuses.filter((s) => s.isTerminal);

          if (defaultStatuses.length !== 1) {
            errors.push(`${stepPrefix} must have exactly one status with isDefault=true (found ${defaultStatuses.length}).`);
            hasWfError = true;
          }
          if (terminalStatuses.length !== 1) {
            errors.push(`${stepPrefix} must have exactly one status with isTerminal=true (found ${terminalStatuses.length}).`);
            hasWfError = true;
          }

          // Validate transitions reference valid statuses
          const validStatusCodes = new Set(step.statuses.map((s) => s.statusCode));
          if (step.statusTransitions) {
            for (const t of step.statusTransitions) {
              if (!validStatusCodes.has(t.fromStatusCode)) {
                errors.push(`${stepPrefix} transition fromStatusCode '${t.fromStatusCode}' is not defined in step.`);
                hasWfError = true;
              }
              if (!validStatusCodes.has(t.toStatusCode)) {
                errors.push(`${stepPrefix} transition toStatusCode '${t.toStatusCode}' is not defined in step.`);
                hasWfError = true;
              }
            }
          }
        }
      }

      if (!hasWfError) {
        validCount++;
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      summary: {
        totalWorkflows: payload.workflows.length,
        validWorkflows: validCount,
      },
    };
  }

  /**
   * Converts an enterprise tenant workflow step into NexusFlow Node and Edge definitions.
   */
  private convertToWorkflowGraph(wf: TenantWorkflowDefinitionInput): WorkflowGraphDefinition {
    const nodes: NodeDefinition[] = [];
    const edges: EdgeDefinition[] = [];
    const stages: string[] = [];

    // Sort steps by stepOrder
    const sortedSteps = [...wf.steps].sort((a, b) => a.stepOrder - b.stepOrder);

    // Initial Trigger Node
    const startNodeId = 'start_trigger';
    nodes.push({
      id: startNodeId,
      type: 'trigger.manual',
      name: `Start: ${wf.name}`,
      config: {},
    });

    // Extract intake form schema from Step 1 if present
    let intakeFormSchema: Record<string, unknown> | undefined = undefined;
    const firstStep = sortedSteps[0];
    if (firstStep && firstStep.uiForms && firstStep.uiForms.length > 0) {
      const firstForm = firstStep.uiForms[0];
      if (firstForm) {
        intakeFormSchema = {
          title: firstForm.formId,
          fields: firstForm.fields.map((f) => ({
            name: f.name,
            label: f.fieldLabel,
            type: this.mapFieldType(f.type),
            required: (f.validations ?? []).some((v) => v.type === 'Required'),
            options: (f.source && !f.source.startsWith('/') && !f.source.startsWith('http'))
              ? f.source.split(',').map((s) => s.trim())
              : undefined,
          })),
        };
      }
    }

    let previousNodeId = startNodeId;

    for (const step of sortedSteps) {
      stages.push(step.code);
      const stepNodeId = `step_${step.code.toLowerCase()}`;

      // Build task schema from step's uiForms
      const taskFields: Array<{ name: string; label?: string; type: any; required?: boolean }> = [];
      if (step.uiForms) {
        for (const form of step.uiForms) {
          for (const field of form.fields) {
            taskFields.push({
              name: field.name,
              label: field.fieldLabel,
              type: this.mapFieldType(field.type),
              required: (field.validations ?? []).some((v) => v.type === 'Required'),
            });
          }
        }
      }

      const candidateGroup = step.participantAssignment?.participants?.[0]?.name ?? 'Reviewers';
      const requiredApprovals = step.collaborationMode === 'Consensus' 
        ? Math.max(1, step.requiredParticipants) 
        : 1;

      const dueInSeconds = step.timeLimitHours ? step.timeLimitHours * 3600 : undefined;

      nodes.push({
        id: stepNodeId,
        type: 'bpmn.user_task',
        name: step.name,
        stage: step.code,
        config: {
          candidateGroup,
          requiredApprovals,
          dueInSeconds,
          buttonLabel: step.buttonLabel,
          collaborationMode: step.collaborationMode,
          taskSchema: taskFields.length > 0 ? { fields: taskFields } : undefined,
        },
      });

      // Connect previous node to this step
      edges.push({
        id: `e_${previousNodeId}_to_${stepNodeId}`,
        from: previousNodeId,
        to: stepNodeId,
      });

      previousNodeId = stepNodeId;
    }

    // Final End Node
    const endNodeId = 'end_terminal';
    nodes.push({
      id: endNodeId,
      type: 'bpmn.end',
      name: `${wf.name} Completed`,
      config: {},
    });

    edges.push({
      id: `e_${previousNodeId}_to_${endNodeId}`,
      from: previousNodeId,
      to: endNodeId,
    });

    return {
      nodes,
      edges,
      stages,
      intakeFormSchema,
    };
  }

  private mapFieldType(rawType: string): 'text' | 'number' | 'currency' | 'boolean' | 'select' | 'date' | 'email' {
    const lower = rawType.toLowerCase();
    if (lower.includes('email')) return 'email';
    if (lower.includes('number') || lower.includes('rating')) return 'number';
    if (lower.includes('date')) return 'date';
    if (lower.includes('checkbox') || lower.includes('switch')) return 'boolean';
    if (lower.includes('dropdown') || lower.includes('select') || lower.includes('radio')) return 'select';
    return 'text';
  }

  /**
   * Processes the tenant workflow import: validates, converts, and persists workflows for the tenant.
   */
  public async process(
    payload: TenantWorkflowImportPayload,
    tenantId: string,
    userId: string,
  ): Promise<ImportProcessResult> {
    const validation = this.validate(payload);
    if (!validation.isValid) {
      throw new ValidationError(`Validation failed: ${validation.errors.join('; ')}`);
    }

    const importedWorkflows: Array<{
      code: string;
      name: string;
      version: number;
      workflowId: string;
      status: string;
    }> = [];

    let skippedCount = 0;

    for (const wf of payload.workflows) {
      const graphDefinition = this.convertToWorkflowGraph(wf);

      try {
        const createdRecord = await this.workflowService.createWorkflow({
          tenantId,
          key: wf.code,
          name: wf.name,
          description: wf.description ?? '',
          definition: graphDefinition,
          createdBy: userId,
        });

        let finalStatus = createdRecord.status;

        // Auto-publish if template specifies Published or Active
        if (wf.status === 'Published' || wf.status === 'Active') {
          const publishedRecord = await this.workflowService.publishWorkflow(
            createdRecord.id,
          );
          finalStatus = publishedRecord.status;
        }

        importedWorkflows.push({
          code: wf.code,
          name: wf.name,
          version: createdRecord.version,
          workflowId: createdRecord.id,
          status: finalStatus,
        });

        this.logger.log(`Successfully imported tenant workflow '${wf.code}' v${createdRecord.version} for tenant '${tenantId}'`);
      } catch (err: any) {
        if (payload.conflictMode === 'SkipExisting') {
          this.logger.warn(`Skipping workflow '${wf.code}': ${err.message}`);
          skippedCount++;
        } else {
          throw err;
        }
      }
    }

    return {
      importedCount: importedWorkflows.length,
      skippedCount,
      workflows: importedWorkflows,
    };
  }
}
