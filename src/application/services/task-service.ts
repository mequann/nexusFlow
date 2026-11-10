import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError } from '../../domain/errors.js';
import { assertTaskTransition } from '../../domain/execution/state-machine.js';
import type { TaskApprovalVote, UserTask, UserTaskStatus } from '../../domain/execution/types.js';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import { validateFormSubmission } from '../../domain/workflow/form-validator.js';
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

  /**
   * Kissflow-style task delegation / reassignment (e.g., Out-Of-Office handoff).
   */
  async delegateTask(
    taskId: string,
    actorId: string,
    toAssignee: string,
    reason?: string,
  ): Promise<UserTask> {
    return this.uow.runInTransaction(async (repos) => {
      const task = await repos.userTasks.findById(taskId);
      if (!task) throw new NotFoundError('UserTask', taskId);
      if (task.status !== 'OPEN' && task.status !== 'CLAIMED') {
        throw new ConflictError(`Cannot delegate task in status '${task.status}'`);
      }

      const previousOwner = task.assignee ?? actorId;
      const now = new Date();
      const updated = await repos.userTasks.update({
        ...task,
        delegatedFrom: previousOwner,
        assignee: toAssignee,
        status: 'CLAIMED',
      });

      await repos.outbox.append({
        id: crypto.randomUUID(),
        aggregateType: 'UserTask',
        aggregateId: task.id,
        eventType: 'USER_TASK_DELEGATED',
        payload: {
          taskId: task.id,
          instanceId: task.instanceId,
          delegatedFrom: previousOwner,
          delegatedTo: toAssignee,
          reason: reason ?? 'Reassigned',
        },
        status: 'PENDING',
        attempts: 0,
        createdAt: now,
        publishedAt: null,
      });

      return updated;
    });
  }

  /**
   * Completes or rejects a Kissflow/Camunda human task.
   * Supports form schema validation and multi-approver quorum voting (`requiredApprovals`).
   */
  async completeTask(
    taskId: string,
    actorId: string,
    resolution: Record<string, unknown>,
    rejected = false,
  ): Promise<UserTask> {
    return this.uow.runInTransaction(async (repos) => {
      const task = await repos.userTasks.findById(taskId);
      if (!task) throw new NotFoundError('UserTask', taskId);

      // For single-approver tasks, enforce claim ownership; for quorum tasks, multiple reviewers vote.
      if (
        task.requiredApprovals <= 1 &&
        task.status === 'CLAIMED' &&
        task.assignee &&
        task.assignee !== actorId
      ) {
        throw new ConflictError(`Task '${taskId}' is claimed by another user`);
      }

      if (!rejected && task.formSchema) {
        validateFormSubmission(task.formSchema, resolution);
      }

      const existingVotes = task.approvalsReceived ?? [];
      if (existingVotes.some((v) => v.userId === actorId)) {
        throw new ConflictError(`User '${actorId}' has already submitted a decision for this task`);
      }

      const now = new Date();
      const newVote: TaskApprovalVote = {
        userId: actorId,
        decision: rejected ? 'REJECTED' : 'APPROVED',
        note: typeof resolution.note === 'string' ? resolution.note : undefined,
        decidedAt: now.toISOString(),
      };
      const updatedVotes = [...existingVotes, newVote];
      const approvalCount = updatedVotes.filter((v) => v.decision === 'APPROVED').length;

      // If multi-approver quorum is not yet reached (and not rejected), keep task OPEN for remaining approvers
      if (!rejected && approvalCount < task.requiredApprovals) {
        assertTaskTransition(task.status, 'OPEN');
        return repos.userTasks.update({
          ...task,
          status: 'OPEN',
          assignee: null,
          approvalsReceived: updatedVotes,
          resolution: { ...resolution, approvalsCount: approvalCount },
        });
      }

      const nextStatus: UserTaskStatus = rejected ? 'REJECTED' : 'COMPLETED';
      assertTaskTransition(task.status, nextStatus);

      const finalResolution = {
        ...resolution,
        approved: !rejected,
        resolvedBy: actorId,
        approvalsReceived: updatedVotes,
      };

      const updated = await repos.userTasks.update({
        ...task,
        assignee: task.assignee ?? actorId,
        status: nextStatus,
        approvalsReceived: updatedVotes,
        resolution: finalResolution,
        completedAt: now,
      });

      await repos.jobs.enqueue({
        id: crypto.randomUUID(),
        instanceId: task.instanceId,
        tokenId: task.tokenId,
        nodeId: task.nodeId,
        jobType: 'RESUME_TOKEN',
        payload: finalResolution,
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

  /**
   * Kissflow SLA watchdog: marks overdue tasks as breached, escalates assignee, and emits outbox events.
   */
  async escalateOverdueTasks(now = new Date()): Promise<number> {
    const overdue = await this.uow.repos.userTasks.findOverdueTasks(now, 50);
    let escalated = 0;

    for (const task of overdue) {
      await this.uow.runInTransaction(async (repos) => {
        const freshTask = await repos.userTasks.findById(task.id);
        if (!freshTask || freshTask.slaBreached) return;
        if (freshTask.status !== 'OPEN' && freshTask.status !== 'CLAIMED') return;

        await repos.userTasks.update({
          ...freshTask,
          slaBreached: true,
          escalationLevel: freshTask.escalationLevel + 1,
          assignee: freshTask.escalateTo ?? freshTask.assignee,
          status: freshTask.escalateTo ? 'CLAIMED' : freshTask.status,
        });

        const instance = await repos.instances.findById(freshTask.instanceId);
        if (instance && instance.slaStatus !== 'BREACHED') {
          await repos.instances.updateWithOcc({
            ...instance,
            slaStatus: 'BREACHED',
          });
        }

        await repos.outbox.append({
          id: crypto.randomUUID(),
          aggregateType: 'UserTask',
          aggregateId: freshTask.id,
          eventType: 'TASK_SLA_ESCALATED',
          payload: {
            taskId: freshTask.id,
            instanceId: freshTask.instanceId,
            escalatedTo: freshTask.escalateTo,
            escalationLevel: freshTask.escalationLevel + 1,
          },
          status: 'PENDING',
          attempts: 0,
          createdAt: now,
          publishedAt: null,
        });

        escalated += 1;
      });
    }

    return escalated;
  }
}
