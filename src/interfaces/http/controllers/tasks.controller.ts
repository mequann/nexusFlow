import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query } from '@nestjs/common';
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
import { TaskService } from '../../../application/services/task-service.js';
import type { UserTaskStatus } from '../../../domain/execution/types.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { CurrentPrincipal, RequirePermission } from '../decorators/auth.decorator.js';
import {
  CompleteTaskDto,
  DelegateTaskDto,
  ErrorResponseDto,
  UserTaskListResponseDto,
  UserTaskResponseDto,
} from '../dto/api.dto.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

const CompleteTaskSchema = z.object({
  resolution: z.record(z.unknown()).default({}),
});

const DelegateTaskSchema = z.object({
  toAssignee: z.string().min(1),
  reason: z.string().max(500).optional(),
});

@ApiTags('Human User Tasks (Camunda + Kissflow)')
@ApiBearerAuth()
@Controller('api/v1/tasks')
export class TasksController {
  constructor(@Inject(TaskService) private readonly taskService: TaskService) {}

  @Get()
  @RequirePermission('task:read')
  @ApiOperation({ summary: 'List human user tasks' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['OPEN', 'CLAIMED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  })
  @ApiQuery({ name: 'assignee', required: false, example: 'cfo@nexusflow.local' })
  @ApiQuery({ name: 'candidateGroup', required: false, example: 'finance' })
  @ApiQuery({ name: 'instanceId', required: false, example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  @ApiOkResponse({ description: 'List of user tasks', type: UserTaskListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ErrorResponseDto })
  async list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query('status') status?: UserTaskStatus,
    @Query('assignee') assignee?: string,
    @Query('candidateGroup') candidateGroup?: string,
    @Query('instanceId') instanceId?: string,
  ) {
    const isGlobalAdmin = principal.role === 'ADMIN';

    // Scoping: non-admin users only view tasks assigned to them, or addressed to their groups/departments
    const userOrGroups = isGlobalAdmin
      ? undefined
      : { userId: principal.userId, groups: [principal.email, principal.role.toLowerCase()] };

    const items = await this.taskService.listTasks({
      status,
      assignee: assignee ?? (isGlobalAdmin ? undefined : principal.userId),
      candidateGroup,
      userOrGroups,
      instanceId,
    });
    return { items };
  }

  @Post(':id/claim')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('task:act')
  @ApiOperation({ summary: 'Claim a human user task for the current operator' })
  @ApiParam({ name: 'id', example: '7b92c4a1-1234-4abc-9def-0123456789ab' })
  @ApiOkResponse({ description: 'Task claimed', type: UserTaskResponseDto })
  @ApiNotFoundResponse({ description: 'Task not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Task already claimed or closed', type: ErrorResponseDto })
  async claim(@Param('id') id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    return this.taskService.claimTask(id, principal.userId);
  }

  @Post(':id/delegate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('task:act')
  @ApiOperation({ summary: 'Delegate / reassign a human task to another user (Kissflow OOO handoff)' })
  @ApiParam({ name: 'id', example: '7b92c4a1-1234-4abc-9def-0123456789ab' })
  @ApiBody({ type: DelegateTaskDto })
  @ApiOkResponse({ description: 'Task delegated', type: UserTaskResponseDto })
  @ApiNotFoundResponse({ description: 'Task not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Task cannot be delegated in current state', type: ErrorResponseDto })
  async delegate(
    @Param('id') id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(DelegateTaskSchema)) body: DelegateTaskDto,
  ) {
    return this.taskService.delegateTask(id, principal.userId, body.toAssignee, body.reason);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('task:act')
  @ApiOperation({ summary: 'Complete a human user task (validates form schema & quorum) and resume workflow' })
  @ApiParam({ name: 'id', example: '7b92c4a1-1234-4abc-9def-0123456789ab' })
  @ApiBody({ type: CompleteTaskDto })
  @ApiOkResponse({ description: 'Task vote recorded / task completed', type: UserTaskResponseDto })
  @ApiBadRequestResponse({ description: 'Task form validation failed', type: ErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Task not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Task claimed by another user or duplicate vote', type: ErrorResponseDto })
  async complete(
    @Param('id') id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CompleteTaskSchema)) body: CompleteTaskDto,
  ) {
    return this.taskService.completeTask(id, principal.userId, body.resolution, false);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('task:act')
  @ApiOperation({ summary: 'Reject a human user task and resume the workflow token' })
  @ApiParam({ name: 'id', example: '7b92c4a1-1234-4abc-9def-0123456789ab' })
  @ApiBody({ type: CompleteTaskDto })
  @ApiOkResponse({ description: 'Task rejected', type: UserTaskResponseDto })
  @ApiNotFoundResponse({ description: 'Task not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Task cannot be rejected in current state', type: ErrorResponseDto })
  async reject(
    @Param('id') id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CompleteTaskSchema)) body: CompleteTaskDto,
  ) {
    return this.taskService.completeTask(id, principal.userId, body.resolution, true);
  }
}
