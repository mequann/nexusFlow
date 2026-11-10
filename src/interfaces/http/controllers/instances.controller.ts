import { Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { WorkflowEngine } from '../../../application/engine/workflow-engine.js';
import { UNIT_OF_WORK } from '../../../application/tokens.js';
import { NotFoundError } from '../../../domain/errors.js';
import type { InstanceStatus } from '../../../domain/execution/types.js';
import type { IUnitOfWork } from '../../../domain/ports/repositories.js';
import { RequirePermission } from '../decorators/auth.decorator.js';
import {
  ErrorResponseDto,
  InstanceListResponseDto,
  InstanceResponseDto,
  InstanceTraceResponseDto,
} from '../dto/api.dto.js';

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
    @Query('status') status?: InstanceStatus,
    @Query('workflowKey') workflowKey?: string,
    @Query('limit') limit?: string,
  ) {
    const items = await this.uow.repos.instances.list({
      status,
      workflowKey,
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
  async getById(@Param('id') id: string) {
    const instance = await this.uow.repos.instances.findById(id);
    if (!instance) throw new NotFoundError('WorkflowInstance', id);
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
  async getTrace(@Param('id') id: string) {
    const instance = await this.uow.repos.instances.findById(id);
    if (!instance) throw new NotFoundError('WorkflowInstance', id);

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
}
