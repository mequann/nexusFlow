export interface ParticipantRecipient {
  id: string;
  name: string;
  order: number;
  isMandatory: boolean;
}

export interface FormFieldValidation {
  type: string; // Required, MinLength, MaxLength, MinValue, MaxValue, Regex, Email, Phone, DateRange, Custom
  parameter: string | null;
  message: string;
}

export interface FormFieldDefinition {
  name: string;
  fieldLabel: string;
  type: string; // Text, Textarea, Number, Date, DateTime, Dropdown, MultiSelect, Grid, Questionnaire, FileUpload, Checkbox, Radio, Switch, Rating, Milestone, Competency
  source: string | null;
  validations: FormFieldValidation[] | null;
}

export interface StepUiForm {
  formId: string;
  fields: FormFieldDefinition[];
}

export interface StepStatus {
  statusCode: string;
  name: string;
  isDefault: boolean;
  isTerminal: boolean;
  allowComments?: boolean;
  allowAttachments?: boolean;
  colorCode?: string;
  iconName?: string;
}

export interface StepStatusTransition {
  fromStatusCode: string;
  toStatusCode: string;
  isAllowed: boolean;
  requiredReason?: boolean;
  allowedReasons?: string[];
}

export interface StepParticipantAssignment {
  assignmentType: 'Role' | 'User' | 'Conditional';
  participants: ParticipantRecipient[];
  logic: 'Manual' | 'All' | 'Majority' | 'Any';
  conditions?: Array<{
    condition: string;
    participants: ParticipantRecipient[];
  }> | null;
}

export interface StepEscalationLevel {
  level: number;
  assigneeType?: string;
  escalateTo?: ParticipantRecipient[];
  afterDuration: string; // e.g. "PT72H", "96", "4.00:00:00"
  actions: string[];
  condition?: string | null;
}

export interface StepEscalation {
  trigger: string;
  type: string;
  priority?: number;
  condition?: string | null;
  levels: StepEscalationLevel[];
}

export interface TenantWorkflowStep {
  stepOrder: number;
  code: string;
  name: string;
  collaborationMode: 'Sequential' | 'Parallel' | 'Consensus';
  requiredParticipants: number;
  buttonLabel?: string;
  timeLimitHours?: number;
  notifyBeforeHours?: number;
  statuses: StepStatus[];
  statusTransitions: StepStatusTransition[];
  participantAssignment: StepParticipantAssignment;
  uiForms?: StepUiForm[];
  stepRules?: any[];
  stepNotifications?: any[];
  stepEscalations?: StepEscalation[];
}

export interface TenantWorkflowDefinitionInput {
  code: string;
  name: string;
  description?: string;
  country?: string;
  domainService: string;
  tenantId?: string;
  subTenantId?: string;
  version?: number;
  status?: string;
  isDefault?: boolean;
  tags?: string[];
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  steps: TenantWorkflowStep[];
  rules?: any[];
  notifications?: any[];
  escalations?: any[];
  validationRules?: any[];
}

export interface TenantWorkflowImportPayload {
  workflows: TenantWorkflowDefinitionInput[];
  conflictMode?: 'SkipExisting' | 'CreateNextVersion' | 'OverwriteDraft';
}

export interface ImportValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    totalWorkflows: number;
    validWorkflows: number;
  };
}

export interface ImportProcessResult {
  importedCount: number;
  skippedCount: number;
  workflows: Array<{
    code: string;
    name: string;
    version: number;
    workflowId: string;
    status: string;
  }>;
}
