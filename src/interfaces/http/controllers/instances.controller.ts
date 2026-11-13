import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
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
import { UNIT_OF_WORK } from '../../../application/tokens.js';
import { ForbiddenError, NotFoundError } from '../../../domain/errors.js';
import type { InstanceStatus } from '../../../domain/execution/types.js';
import type { IUnitOfWork } from '../../../domain/ports/repositories.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { CurrentPrincipal, RequirePermission } from '../decorators/auth.decorator.js';
import {
  ErrorResponseDto,
  ExecutionTokenResponseDto,
  InstanceListResponseDto,
  InstanceResponseDto,
  InstanceTraceResponseDto,
  MoveTokenDto,
  PatchInstanceVariablesDto,
} from '../dto/api.dto.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

const PatchVariablesSchema = z.object({
  variables: z.record(z.unknown()),
});

const MoveTokenSchema = z.object({
  tokenId: z.string().min(1),
  targetNodeId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

const ResetInstanceSchema = z.object({
  targetNodeId: z.string().min(1),
  reason: z.string().min(1),
  variablesOverride: z.record(z.unknown()).optional(),
});

const ContinueAsNewSchema = z.object({
  carryoverVariables: z.record(z.unknown()).optional(),
  reason: z.string().optional(),
});

const QueryInstanceSchema = z.object({
  expression: z.string().optional(),
  variableKey: z.string().optional(),
});

@ApiTags('Instances')
@ApiBearerAuth()
@Controller('api/v1/instances')
export class InstancesController {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork,
    @Inject(WorkflowEngine) private readonly engine: WorkflowEngine,
  ) {}

  @Get()
  @RequirePermission('instance:read')
  @ApiOperation({ summary: 'List workflow instances' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: [
      'PENDING',
      'RUNNING',
      'WAITING',
      'INCIDENT_OPEN',
      'COMPENSATING',
      'COMPENSATED',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ],
  })
  @ApiQuery({ name: 'workflowKey', required: false, example: 'procurement-capex-approval' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiOkResponse({ description: 'List of workflow instances', type: InstanceListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ErrorResponseDto })
  async list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query('status') status?: InstanceStatus,
    @Query('workflowKey') workflowKey?: string,
    @Query('limit') limit?: string,
  ) {
    const isGlobalAdmin = principal.role === 'ADMIN';
    const items = await this.uow.repos.instances.list({
      tenantId: principal.tenantId,
      status,
      workflowKey,
      startedBy: isGlobalAdmin ? undefined : principal.userId,
      limit: limit ? Number(limit) : 100,
    });
    return { items };
  }

  @Get(':id')
  @RequirePermission('instance:read')
  @ApiOperation({ summary: 'Get workflow instance details' })
  @ApiParam({ name: 'id', example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  @ApiOkResponse({ description: 'Workflow instance details', type: InstanceResponseDto })
  @ApiNotFoundResponse({ description: 'Instance not found', type: ErrorResponseDto })
  async getById(@Param('id') id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    const instance = await this.uow.repos.instances.findById(id);
    if (!instance) throw new NotFoundError('WorkflowInstance', id);
    if (principal.role !== 'ADMIN' && instance.tenantId !== principal.tenantId) {
      throw new ForbiddenError('You do not have access to view this workflow instance');
    }
    if (principal.role !== 'ADMIN' && instance.startedBy && instance.startedBy !== principal.userId) {
      throw new ForbiddenError('You do not have access to view this workflow instance');
    }
    return instance;
  }

  @Get(':id/trace')
  @RequirePermission('instance:read')
  @ApiOperation({
    summary: 'Get complete execution audit trace (tokens, steps, tasks, subscriptions, incidents)',
  })
  @ApiParam({ name: 'id', example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  @ApiOkResponse({ description: 'Full instance execution trace', type: InstanceTraceResponseDto })
  @ApiNotFoundResponse({ description: 'Instance not found', type: ErrorResponseDto })
  async getTrace(@Param('id') id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    const instance = await this.uow.repos.instances.findById(id);
    if (!instance) throw new NotFoundError('WorkflowInstance', id);
    if (principal.role !== 'ADMIN' && instance.tenantId !== principal.tenantId) {
      throw new ForbiddenError('You do not have access to view this workflow instance trace');
    }
    if (principal.role !== 'ADMIN' && instance.startedBy && instance.startedBy !== principal.userId) {
      throw new ForbiddenError('You do not have access to view this workflow instance trace');
    }

    const [tokens, steps, tasks, subscriptions, incidents] = await Promise.all([
      this.uow.repos.tokens.findByInstance(id),
      this.uow.repos.steps.findByInstance(id),
      this.uow.repos.userTasks.list({ instanceId: id }),
      this.uow.repos.subscriptions.findByInstance(id),
      this.uow.repos.incidents.list({ instanceId: id }),
    ]);

    return { instance, tokens, steps, tasks, subscriptions, incidents };
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('instance:cancel')
  @ApiOperation({ summary: 'Cancel an active or waiting workflow instance' })
  @ApiParam({ name: 'id', example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  @ApiOkResponse({ description: 'Workflow instance cancelled', type: InstanceResponseDto })
  @ApiNotFoundResponse({ description: 'Instance not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Instance is already in a terminal state', type: ErrorResponseDto })
  async cancel(@Param('id') id: string) {
    return this.engine.cancelInstance(id);
  }

  @Patch(':id/variables')
  @RequirePermission('instance:cancel')
  @ApiOperation({ summary: 'Dynamically patch variables on an active workflow instance' })
  @ApiParam({ name: 'id', example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  @ApiBody({ type: PatchInstanceVariablesDto })
  @ApiOkResponse({ description: 'Variables updated', type: InstanceResponseDto })
  @ApiBadRequestResponse({ description: 'Validation error', type: ErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Instance not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Terminal instance cannot be modified', type: ErrorResponseDto })
  async patchVariables(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PatchVariablesSchema)) body: PatchInstanceVariablesDto,
  ) {
    return this.engine.patchVariables(id, body.variables);
  }

  @Post(':id/tokens/move')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('instance:cancel')
  @ApiOperation({
    summary: 'Camunda-style dynamic process modification: move/jump a token to any node in the workflow',
  })
  @ApiParam({ name: 'id', example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  @ApiBody({ type: MoveTokenDto })
  @ApiOkResponse({ description: 'Token moved and scheduled', type: ExecutionTokenResponseDto })
  @ApiNotFoundResponse({ description: 'Instance, token, or target node not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Terminal instance cannot be modified', type: ErrorResponseDto })
  async moveToken(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MoveTokenSchema)) body: MoveTokenDto,
  ) {
    return this.engine.moveTokenToNode(id, body.tokenId, body.targetNodeId, body.reason);
  }

  @Post(':id/reset')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('instance:cancel')
  @ApiOperation({
    summary: 'Temporal-style Point-in-Time Reset: rewind workflow execution to a specific node and resume forward',
  })
  @ApiParam({ name: 'id', description: 'Instance UUID' })
  async reset(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ResetInstanceSchema)) body: z.infer<typeof ResetInstanceSchema>,
  ) {
    return this.engine.resetInstance(id, body);
  }

  @Post(':id/continue-as-new')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('instance:cancel')
  @ApiOperation({
    summary: 'Temporal-style ContinueAsNew: compact history and start a fresh execution generation carrying over state',
  })
  @ApiParam({ name: 'id', description: 'Instance UUID' })
  async continueAsNew(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ContinueAsNewSchema)) body: z.infer<typeof ContinueAsNewSchema>,
  ) {
    return this.engine.continueAsNew(id, body);
  }

  @Post(':id/query')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('instance:read')
  @ApiOperation({
    summary: 'Temporal-style Synchronous Live Query: inspect running workflow variables and evaluate safe expressions without mutating state',
  })
  @ApiParam({ name: 'id', description: 'Instance UUID' })
  async query(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(QueryInstanceSchema)) body: z.infer<typeof QueryInstanceSchema>,
  ) {
    return this.engine.queryInstance(id, body);
  }
}
