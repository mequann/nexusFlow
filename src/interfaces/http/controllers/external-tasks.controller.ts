import { Body, Controller, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ExternalTaskService } from '../../../application/services/external-task-service.js';
import { RequirePermission } from '../decorators/auth.decorator.js';
import {
  CompleteExternalTaskDto,
  ErrorResponseDto,
  ExternalTaskListResponseDto,
  ExternalTaskResponseDto,
  FailExternalTaskDto,
  FetchAndLockExternalTasksDto,
} from '../dto/api.dto.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

const FetchAndLockSchema = z.object({
  workerId: z.string().min(1),
  topics: z.array(z.string().min(1)).min(1),
  maxTasks: z.number().int().min(1).max(100).optional(),
  lockDurationMs: z.number().int().min(1000).max(3_600_000).optional(),
});

const CompleteExternalSchema = z.object({
  workerId: z.string().min(1),
  variables: z.record(z.unknown()).default({}),
});

const FailExternalSchema = z.object({
  workerId: z.string().min(1),
  errorMessage: z.string().min(1),
  retriesRemaining: z.number().int().min(0).optional(),
});

@ApiTags('External Service Tasks (Camunda Polyglot Workers)')
@ApiBearerAuth()
@Controller('api/v1/external-tasks')
export class ExternalTasksController {
  constructor(
    @Inject(ExternalTaskService) private readonly externalTaskService: ExternalTaskService,
  ) {}

  @Post('fetch-and-lock')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('task:act')
  @ApiOperation({
    summary: 'Fetch and lock pending external tasks for one or more dynamic topics',
  })
  @ApiBody({ type: FetchAndLockExternalTasksDto })
  @ApiOkResponse({ description: 'Locked external tasks', type: ExternalTaskListResponseDto })
  @ApiBadRequestResponse({ description: 'Validation error', type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ErrorResponseDto })
  async fetchAndLock(
    @Body(new ZodValidationPipe(FetchAndLockSchema)) body: FetchAndLockExternalTasksDto,
  ) {
    const items = await this.externalTaskService.fetchAndLock(
      body.workerId,
      body.topics,
      body.maxTasks,
      body.lockDurationMs,
    );
    return { items };
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('task:act')
  @ApiOperation({ summary: 'Complete a locked external task and resume the workflow token' })
  @ApiParam({ name: 'id', example: 'e4d3c2b1-1234-4abc-9def-0123456789ab' })
  @ApiBody({ type: CompleteExternalTaskDto })
  @ApiOkResponse({ description: 'External task completed', type: ExternalTaskResponseDto })
  @ApiNotFoundResponse({ description: 'External task not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Task locked by another worker or already completed', type: ErrorResponseDto })
  async complete(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CompleteExternalSchema)) body: CompleteExternalTaskDto,
  ) {
    return this.externalTaskService.complete(id, body.workerId, body.variables);
  }

  @Post(':id/failure')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('task:act')
  @ApiOperation({ summary: 'Report failure on an external task (retries or opens Incident)' })
  @ApiParam({ name: 'id', example: 'e4d3c2b1-1234-4abc-9def-0123456789ab' })
  @ApiBody({ type: FailExternalTaskDto })
  @ApiOkResponse({ description: 'Failure recorded', type: ExternalTaskResponseDto })
  @ApiNotFoundResponse({ description: 'External task not found', type: ErrorResponseDto })
  async reportFailure(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(FailExternalSchema)) body: FailExternalTaskDto,
  ) {
    return this.externalTaskService.reportFailure(
      id,
      body.workerId,
      body.errorMessage,
      body.retriesRemaining,
    );
  }
}

