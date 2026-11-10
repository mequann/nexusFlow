import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { TaskService } from '../../../application/services/task-service.js';
import type { UserTaskStatus } from '../../../domain/execution/types.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { CurrentPrincipal, RequirePermission } from '../decorators/auth.decorator.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

const CompleteTaskSchema = z.object({
  resolution: z.record(z.unknown()).default({}),
});

const DelegateTaskSchema = z.object({
  toAssignee: z.string().min(1),
  reason: z.string().max(500).optional(),
});

@ApiTags('Human User Tasks (Camunda)')
@ApiBearerAuth()
@Controller('api/v1/tasks')
export class TasksController {
  constructor(@Inject(TaskService) private readonly taskService: TaskService) {}

  @Get()
  @RequirePermission('task:read')
  @ApiOperation({ summary: 'List human user tasks' })
  async list(
    @Query('status') status?: UserTaskStatus,
    @Query('assignee') assignee?: string,
    @Query('candidateGroup') candidateGroup?: string,
    @Query('instanceId') instanceId?: string,
  ) {
    const items = await this.taskService.listTasks({
      status,
      assignee,
      candidateGroup,
      instanceId,
    });
    return { items };
  }

  @Post(':id/claim')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('task:act')
  @ApiOperation({ summary: 'Claim a human user task for the current operator' })
  async claim(@Param('id') id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.taskService.claimTask(id, principal.userId);
  }

  @Post(':id/delegate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('task:act')
  @ApiOperation({ summary: 'Delegate / reassign a human task to another user (Kissflow OOO handoff)' })
  async delegate(
    @Param('id') id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(DelegateTaskSchema)) body: z.infer<typeof DelegateTaskSchema>,
  ) {
    return this.taskService.delegateTask(id, principal.userId, body.toAssignee, body.reason);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('task:act')
  @ApiOperation({ summary: 'Complete a human user task and resume the workflow token' })
  async complete(
    @Param('id') id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CompleteTaskSchema)) body: z.infer<typeof CompleteTaskSchema>,
  ) {
    return this.taskService.completeTask(id, principal.userId, body.resolution, false);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('task:act')
  @ApiOperation({ summary: 'Reject a human user task and resume the workflow token' })
  async reject(
    @Param('id') id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CompleteTaskSchema)) body: z.infer<typeof CompleteTaskSchema>,
  ) {
    return this.taskService.completeTask(id, principal.userId, body.resolution, true);
  }
}

