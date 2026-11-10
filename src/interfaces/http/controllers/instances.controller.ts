import { Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkflowEngine } from '../../../application/engine/workflow-engine.js';
import { UNIT_OF_WORK } from '../../../application/tokens.js';
import { NotFoundError } from '../../../domain/errors.js';
import type { InstanceStatus } from '../../../domain/execution/types.js';
import type { IUnitOfWork } from '../../../domain/ports/repositories.js';
import { RequirePermission } from '../decorators/auth.decorator.js';

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
  async cancel(@Param('id') id: string) {
    return this.engine.cancelInstance(id);
  }
}

