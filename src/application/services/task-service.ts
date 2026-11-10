import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../domain/errors.js';
import { assertTaskTransition } from '../../domain/execution/state-machine.js';
import type { UserTask, UserTaskStatus } from '../../domain/execution/types.js';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import { UNIT_OF_WORK } from '../tokens.js';

@Injectable()
export class TaskService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork) {}

  async listTasks(filters?: {
    status?: UserTaskStatus;
    assignee?: string;
    candidateGroup?: string;
    instanceId?: string;
  }): Promise<UserTask[]> {
    return this.uow.repos.userTasks.list(filters);
  }

  async claimTask(taskId: string, userId: string): Promise<UserTask> {
    return this.uow.runInTransaction(async (repos) => {
      const task = await repos.userTasks.findById(taskId);
      if (!task) throw new NotFoundError('UserTask', taskId);
      if (task.assignee && task.assignee !== userId) {
        throw new ConflictError(`Task '${taskId}' is already claimed by '${task.assignee}'`);
      }
      assertTaskTransition(task.status, 'CLAIMED');
      return repos.userTasks.update({
        ...task,
        assignee: userId,
        status: 'CLAIMED',
      });
    });
  }

  async completeTask(
    taskId: string,
    actorId: string,
    resolution: Record<string, unknown>,
    rejected = false,
  ): Promise<UserTask> {
    return this.uow.runInTransaction(async (repos) => {
      const task = await repos.userTasks.findById(taskId);
      if (!task) throw new NotFoundError('UserTask', taskId);
      if (task.status === 'CLAIMED' && task.assignee && task.assignee !== actorId) {
        throw new ConflictError(`Task '${taskId}' is claimed by another user`);
      }

      const nextStatus: UserTaskStatus = rejected ? 'REJECTED' : 'COMPLETED';
      assertTaskTransition(task.status, nextStatus);

      const now = new Date();
      const updated = await repos.userTasks.update({
        ...task,
        assignee: task.assignee ?? actorId,
        status: nextStatus,
        resolution: { ...resolution, approved: !rejected, resolvedBy: actorId },
        completedAt: now,
      });

      await repos.jobs.enqueue({
        id: crypto.randomUUID(),
        instanceId: task.instanceId,
        tokenId: task.tokenId,
        nodeId: task.nodeId,
        jobType: 'RESUME_TOKEN',
        payload: updated.resolution ?? {},
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        availableAt: now,
        lockedBy: null,
        lockedAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      });

      await repos.outbox.append({
        id: crypto.randomUUID(),
        aggregateType: 'UserTask',
        aggregateId: task.id,
        eventType: rejected ? 'USER_TASK_REJECTED' : 'USER_TASK_COMPLETED',
        payload: { taskId: task.id, instanceId: task.instanceId, actorId },
        status: 'PENDING',
        attempts: 0,
        createdAt: now,
        publishedAt: null,
      });

      return updated;
    });
  }
}

