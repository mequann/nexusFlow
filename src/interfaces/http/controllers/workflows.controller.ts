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
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { WorkflowEngine } from '../../../application/engine/workflow-engine.js';
import { WorkflowService } from '../../../application/services/workflow-service.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import type { WorkflowGraphDefinition, WorkflowStatus } from '../../../domain/workflow/types.js';
import { CurrentPrincipal, RequirePermission } from '../decorators/auth.decorator.js';
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
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Create a new workflow version in DRAFT state' })
  async create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CreateWorkflowSchema)) body: z.infer<typeof CreateWorkflowSchema>,
  ) {
    return this.workflowService.createWorkflow({
      key: body.key,
      name: body.name,
      description: body.description,
      definition: body.definition as WorkflowGraphDefinition,
      webhookSecret: body.webhookSecret,
      createdBy: principal.userId,
    });
  }

  @Get()
  @RequirePermission('workflow:read')
  @ApiOperation({ summary: 'List workflows optionally filtered by status or key' })
  async list(@Query('status') status?: WorkflowStatus, @Query('key') key?: string) {
    const items = await this.workflowService.list({ status, key });
    return { items };
  }

  @Get(':id')
  @RequirePermission('workflow:read')
  @ApiOperation({ summary: 'Get workflow definition by ID' })
  async getById(@Param('id') id: string) {
    return this.workflowService.getById(id);
  }

  @Put(':id')
  @RequirePermission('workflow:write')
  @ApiOperation({ summary: 'Update a DRAFT workflow definition' })
  async updateDraft(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWorkflowSchema)) body: z.infer<typeof UpdateWorkflowSchema>,
  ) {
    return this.workflowService.updateDraft(id, {
      name: body.name,
      description: body.description,
      definition: body.definition as WorkflowGraphDefinition | undefined,
      webhookSecret: body.webhookSecret,
    });
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('workflow:publish')
  @ApiOperation({ summary: 'Validate and publish a workflow version' })
  async publish(@Param('id') id: string) {
    return this.workflowService.publishWorkflow(id);
  }

  @Post(':key/instances')
  @RequirePermission('instance:start')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @ApiOperation({ summary: 'Start a new workflow execution instance' })
  async startInstance(
    @Param('key') key: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(StartInstanceSchema)) body: z.infer<typeof StartInstanceSchema>,
  ) {
    return this.engine.startInstance({
      workflowKey: key,
      version: body.version,
      triggerPayload: body.payload,
      initialVariables: body.variables,
      correlationKey: body.correlationKey ?? null,
      startedBy: principal.userId,
    });
  }
}

