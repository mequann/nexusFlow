import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import { WorkflowEngine } from '../../../application/engine/workflow-engine.js';
import { WorkflowService } from '../../../application/services/workflow-service.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import type { WorkflowGraphDefinition, WorkflowStatus } from '../../../domain/workflow/types.js';
import { CurrentPrincipal, RequirePermission } from '../decorators/auth.decorator.js';
import {
  CreateWorkflowDto,
  ErrorResponseDto,
  InstanceResponseDto,
  StartInstanceDto,
  UpdateWorkflowDto,
  WorkflowListResponseDto,
  WorkflowResponseDto,
} from '../dto/api.dto.js';
import { IdempotencyInterceptor } from '../interceptors/idempotency.interceptor.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(20),
  initialDelayMs: z.number().int().min(10).max(60_000),
  backoffMultiplier: z.number().min(1).max(10),
  maxDelayMs: z.number().int().min(10).max(600_000),
});

const NodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum([
    'trigger.manual',
    'trigger.webhook',
    'trigger.cron',
    'action.http',
    'action.transform',
    'logic.if',
    'logic.switch',
    'logic.parallel',
    'logic.join',
    'bpmn.user_task',
    'bpmn.timer',
    'bpmn.message_catch',
    'bpmn.decision_table',
    'bpmn.end',
  ]),
  stage: z.string().optional(),
  config: z.record(z.unknown()).default({}),
  retryPolicy: RetryPolicySchema.optional(),
  compensateNodeId: z.string().optional(),
  isCompensationHandler: z.boolean().optional(),
  outputKey: z.string().optional(),
});

const EdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  branch: z.string().optional(),
  condition: z.string().optional(),
});

const GraphSchema = z.object({
  nodes: z.array(NodeSchema).min(1),
  edges: z.array(EdgeSchema),
  defaultRetryPolicy: RetryPolicySchema.optional(),
  sagaEnabled: z.boolean().optional(),
  stages: z.array(z.string()).optional(),
  intakeFormSchema: z.record(z.unknown()).optional(),
});

const CreateWorkflowSchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  definition: GraphSchema,
  webhookSecret: z.string().min(8).optional(),
});

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  definition: GraphSchema.optional(),
  webhookSecret: z.string().min(8).optional(),
});

const StartInstanceSchema = z.object({
  version: z.number().int().positive().optional(),
  payload: z.record(z.unknown()).optional(),
  variables: z.record(z.unknown()).optional(),
  correlationKey: z.string().max(200).optional(),
});

@ApiTags('Workflows')
@ApiBearerAuth()
@Controller('api/v1/workflows')
export class WorkflowsController {
  constructor(
    @Inject(WorkflowService) private readonly workflowService: WorkflowService,
    @Inject(WorkflowEngine) private readonly engine: WorkflowEngine,
  ) {}

  @Post()
  @RequirePermission('workflow:write')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Optional deduplication key' })
  @ApiOperation({ summary: 'Create a new workflow version in DRAFT state' })
  @ApiBody({ type: CreateWorkflowDto })
  @ApiCreatedResponse({ description: 'Workflow draft created', type: WorkflowResponseDto })
  @ApiBadRequestResponse({ description: 'Graph validation or schema error', type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ErrorResponseDto })
  @ApiForbiddenResponse({ description: 'Insufficient role permissions', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Idempotency payload conflict', type: ErrorResponseDto })
  async create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CreateWorkflowSchema)) body: CreateWorkflowDto,
  ) {
    const validated = body as z.infer<typeof CreateWorkflowSchema>;
    return this.workflowService.createWorkflow({
      key: validated.key,
      name: validated.name,
      description: validated.description,
      definition: validated.definition as WorkflowGraphDefinition,
      webhookSecret: validated.webhookSecret,
      createdBy: principal.userId,
    });
  }

  @Get()
  @RequirePermission('workflow:read')
  @ApiOperation({ summary: 'List workflows optionally filtered by status or key' })
  @ApiQuery({ name: 'status', required: false, enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  @ApiQuery({ name: 'key', required: false, example: 'procurement-capex-approval' })
  @ApiOkResponse({ description: 'List of workflow definitions', type: WorkflowListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ErrorResponseDto })
  async list(@Query('status') status?: WorkflowStatus, @Query('key') key?: string) {
    const items = await this.workflowService.list({ status, key });
    return { items };
  }

  @Get(':id')
  @RequirePermission('workflow:read')
  @ApiOperation({ summary: 'Get workflow definition by ID' })
  @ApiParam({ name: 'id', example: '0238655f-3914-4bbd-971c-17703d47fd00' })
  @ApiOkResponse({ description: 'Workflow definition', type: WorkflowResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow not found', type: ErrorResponseDto })
  async getById(@Param('id') id: string) {
    return this.workflowService.getById(id);
  }

  @Put(':id')
  @RequirePermission('workflow:write')
  @ApiOperation({ summary: 'Update a DRAFT workflow definition' })
  @ApiParam({ name: 'id', example: '0238655f-3914-4bbd-971c-17703d47fd00' })
  @ApiBody({ type: UpdateWorkflowDto })
  @ApiOkResponse({ description: 'Updated draft workflow', type: WorkflowResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Only DRAFT workflows can be mutated', type: ErrorResponseDto })
  async updateDraft(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWorkflowSchema)) body: UpdateWorkflowDto,
  ) {
    const validated = body as z.infer<typeof UpdateWorkflowSchema>;
    return this.workflowService.updateDraft(id, {
      name: validated.name,
      description: validated.description,
      definition: validated.definition as WorkflowGraphDefinition | undefined,
      webhookSecret: validated.webhookSecret,
    });
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('workflow:publish')
  @ApiOperation({ summary: 'Validate and publish a workflow version' })
  @ApiParam({ name: 'id', example: '0238655f-3914-4bbd-971c-17703d47fd00' })
  @ApiOkResponse({ description: 'Workflow published', type: WorkflowResponseDto })
  @ApiNotFoundResponse({ description: 'Workflow not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Cannot publish archived workflow', type: ErrorResponseDto })
  async publish(@Param('id') id: string) {
    return this.workflowService.publishWorkflow(id);
  }

  @Post(':key/instances')
  @RequirePermission('instance:start')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({ name: 'Idempotency-Key', required: false, description: 'Optional deduplication key' })
  @ApiOperation({ summary: 'Start a new workflow execution instance' })
  @ApiParam({ name: 'key', example: 'procurement-capex-approval' })
  @ApiBody({ type: StartInstanceDto })
  @ApiCreatedResponse({ description: 'Workflow instance started', type: InstanceResponseDto })
  @ApiBadRequestResponse({ description: 'Intake form validation error', type: ErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Published workflow not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Idempotency conflict', type: ErrorResponseDto })
  async startInstance(
    @Param('key') key: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(StartInstanceSchema)) body: StartInstanceDto,
  ) {
    const validated = body as z.infer<typeof StartInstanceSchema>;
    return this.engine.startInstance({
      workflowKey: key,
      version: validated.version,
      triggerPayload: validated.payload,
      initialVariables: validated.variables,
      correlationKey: validated.correlationKey ?? null,
      startedBy: principal.userId,
    });
  }
}
