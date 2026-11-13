export type BuiltinNodeType =
  | 'trigger.manual'
  | 'trigger.webhook'
  | 'trigger.cron'
  | 'action.http'
  | 'action.transform'
  | 'action.script'
  | 'logic.if'
  | 'logic.switch'
  | 'logic.parallel'
  | 'logic.join'
  | 'logic.for_each'
  | 'bpmn.user_task'
  | 'bpmn.timer'
  | 'bpmn.message_catch'
  | 'bpmn.decision_table'
  | 'bpmn.external_task'
  | 'bpmn.call_activity'
  | 'bpmn.end'
  | 'kissflow.approval_matrix';

/**
 * Extensible node type supporting built-in Camunda/n8n/Kissflow nodes
 * as well as dynamically registered enterprise connectors (e.g. `connector.sap_erp`, `external.ml_score`).
 */
export type NodeType = BuiltinNodeType | (string & {});

export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
  backoffMultiplier: number;
  maxDelayMs: number;
}

export interface NodeDefinition {
  id: string;
  name: string;
  type: NodeType;
  /** Kissflow business case milestone / stage (e.g., 'Intake', 'Finance Review', 'ERP Sync') */
  stage?: string;
  /** Optional visual canvas coordinates persisted for the Drag-and-Drop Studio */
  position?: { x: number; y: number };
  config: Record<string, unknown>;
  retryPolicy?: RetryPolicy;
  /** Camunda Saga compensation handler node id to run in reverse order on failure */
  compensateNodeId?: string;
  /** Marks a node as a compensation-only handler (not part of normal forward flow) */
  isCompensationHandler?: boolean;
  /** Output variable key stored into instance variables as `$steps.<id>.output` and optionally merged */
  outputKey?: string;
}

export interface EdgeDefinition {
  id: string;
  from: string;
  to: string;
  /** Used by logic.if ('true' | 'false') or logic.switch (case label | 'default') */
  branch?: string;
  /** Optional guard expression evaluated on edge traversal */
  condition?: string;
}

export interface WorkflowGraphDefinition {
  nodes: NodeDefinition[];
  edges: EdgeDefinition[];
  defaultRetryPolicy?: RetryPolicy;
  sagaEnabled?: boolean;
  /** Kissflow ordered business case stages (auto-derived from node.stage if omitted) */
  stages?: string[];
  /** Kissflow intake form schema validated when starting an instance */
  intakeFormSchema?: Record<string, unknown>;
}

export type WorkflowStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface WorkflowDefinitionRecord {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  description: string;
  version: number;
  status: WorkflowStatus;
  definition: WorkflowGraphDefinition;
  webhookPath: string | null;
  webhookSecretHash: string | null;
  cronExpression: string | null;
  cronNextRunAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}
