import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../domain/errors.js';
import type { ExternalTask } from '../../domain/execution/types.js';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import { UNIT_OF_WORK } from '../tokens.js';

@Injectable()
export class ExternalTaskService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork) {}

  async fetchAndLock(
    workerId: string,
    topics: string[],
    maxTasks = 10,
    lockDurationMs = 30_000,
  ): Promise<ExternalTask[]> {
    const now = new Date();
    const lockUntil = new Date(now.getTime() + lockDurationMs);
    return this.uow.repos.externalTasks.fetchAndLock(workerId, topics, maxTasks, lockUntil, now);
  }

  async complete(
    taskId: string,
    workerId: string,
    resultVariables: Record<string, unknown> = {},
  ): Promise<ExternalTask> {
    return this.uow.runInTransaction(async (repos) => {
      const task = await repos.externalTasks.findById(taskId);
      if (!task) throw new NotFoundError('ExternalTask', taskId);
      if (task.status === 'COMPLETED') {
        throw new ConflictError(`ExternalTask '${taskId}' is already completed`);
      }
      if (task.status === 'LOCKED' && task.workerId && task.workerId !== workerId) {
        throw new ConflictError(`ExternalTask '${taskId}' is locked by another worker`);
      }

      const now = new Date();
      const updated = await repos.externalTasks.update({
        ...task,
        status: 'COMPLETED',
        workerId,
        resultVariables,
      });

      await repos.jobs.enqueue({
        id: crypto.randomUUID(),
        instanceId: task.instanceId,
        tokenId: task.tokenId,
        nodeId: task.nodeId,
        jobType: 'RESUME_TOKEN',
        payload: resultVariables,
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
        aggregateType: 'ExternalTask',
        aggregateId: task.id,
        eventType: 'EXTERNAL_TASK_COMPLETED',
        payload: { taskId: task.id, topic: task.topic, instanceId: task.instanceId, workerId },
        status: 'PENDING',
        attempts: 0,
        createdAt: now,
        publishedAt: null,
      });

      return updated;
    });
  }

  async reportFailure(
    taskId: string,
    workerId: string,
    errorMessage: string,
    retriesRemaining?: number,
  ): Promise<ExternalTask> {
    return this.uow.runInTransaction(async (repos) => {
      const task = await repos.externalTasks.findById(taskId);
      if (!task) throw new NotFoundError('ExternalTask', taskId);
      if (task.workerId && task.workerId !== workerId) {
        throw new ConflictError(`ExternalTask '${taskId}' is locked by another worker`);
      }

      const nextRetries =
        retriesRemaining !== undefined ? retriesRemaining : Math.max(0, task.retries - 1);
      const now = new Date();

      if (nextRetries > 0) {
        return repos.externalTasks.update({
          ...task,
          status: 'OPEN',
          workerId: null,
          lockExpiresAt: null,
          retries: nextRetries,
          errorMessage,
        });
      }

      const failed = await repos.externalTasks.update({
        ...task,
        status: 'FAILED',
        retries: 0,
        errorMessage,
      });

      const instance = await repos.instances.findById(task.instanceId);
      if (instance && instance.status !== 'INCIDENT_OPEN') {
        await repos.instances.updateWithOcc({ ...instance, status: 'INCIDENT_OPEN' });
        await repos.incidents.create({
          id: crypto.randomUUID(),
          instanceId: task.instanceId,
          tokenId: task.tokenId,
          stepExecutionId: null,
          nodeId: task.nodeId,
          incidentType: 'ExternalTaskFailure',
          message: errorMessage,
          stackTrace: null,
          payloadSnapshot: instance.variables,
          status: 'OPEN',
          resolvedBy: null,
          resolutionNote: null,
          createdAt: now,
          resolvedAt: null,
        });
      }

      return failed;
    });
  }

  /**
   * Temporal-style activity heartbeating.
   * Allows long-running external tasks to report incremental progress and maintain worker liveness.
   */
  async recordHeartbeat(
    taskId: string,
    workerId: string,
    progress?: Record<string, unknown>,
    extendLockMs = 30_000,
  ): Promise<ExternalTask> {
    return this.uow.runInTransaction(async (repos) => {
      const task = await repos.externalTasks.findById(taskId);
      if (!task) throw new NotFoundError('ExternalTask', taskId);
      if (task.status !== 'LOCKED') {
        throw new ConflictError(`ExternalTask '${taskId}' cannot heartbeat in status '${task.status}'`);
      }
      if (task.workerId && task.workerId !== workerId) {
        throw new ConflictError(`ExternalTask '${taskId}' is locked by worker '${task.workerId}', not '${workerId}'`);
      }

      const now = new Date();
      const newLockExpiresAt = new Date(now.getTime() + extendLockMs);

      const updated = await repos.externalTasks.update({
        ...task,
        lastHeartbeatAt: now,
        lockExpiresAt: newLockExpiresAt,
        progress: progress ? { ...(task.progress ?? {}), ...progress } : task.progress,
        updatedAt: now,
      });

      await repos.outbox.append({
        id: crypto.randomUUID(),
        aggregateType: 'ExternalTask',
        aggregateId: task.id,
        eventType: 'EXTERNAL_TASK_HEARTBEAT',
        payload: { taskId: task.id, workerId, progress, lockExpiresAt: newLockExpiresAt },
        status: 'PENDING',
        attempts: 0,
        createdAt: now,
        publishedAt: null,
      });

      return updated;
    });
  }

  async getTaskProgress(taskId: string): Promise<{
    taskId: string;
    status: string;
    progress: Record<string, unknown> | null;
    lastHeartbeatAt: Date | null;
    lockExpiresAt: Date | null;
  }> {
    const task = await this.uow.repos.externalTasks.findById(taskId);
    if (!task) throw new NotFoundError('ExternalTask', taskId);
    return {
      taskId: task.id,
      status: task.status,
      progress: task.progress ?? null,
      lastHeartbeatAt: task.lastHeartbeatAt ?? null,
      lockExpiresAt: task.lockExpiresAt,
    };
  }
}

