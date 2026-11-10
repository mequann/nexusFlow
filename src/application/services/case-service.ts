import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '../../domain/errors.js';
import type { CaseComment, StepExecution, UserTask, WorkflowInstance } from '../../domain/execution/types.js';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import { UNIT_OF_WORK } from '../tokens.js';

export interface CaseSummary {
  instance: WorkflowInstance;
  stages: string[];
  currentStage: string | null;
  progressPercent: number;
  openTasks: UserTask[];
  completedSteps: StepExecution[];
  comments: CaseComment[];
}

@Injectable()
export class CaseService {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork) {}

  async getCaseSummary(instanceId: string): Promise<CaseSummary> {
    const instance = await this.uow.repos.instances.findById(instanceId);
    if (!instance) throw new NotFoundError('WorkflowInstance', instanceId);

    const [workflow, tasks, steps, comments] = await Promise.all([
      this.uow.repos.workflows.findById(instance.workflowId),
      this.uow.repos.userTasks.list({ instanceId }),
      this.uow.repos.steps.findByInstance(instanceId),
      this.uow.repos.caseComments.findByInstance(instanceId),
    ]);

    const stages = workflow?.definition.stages ?? [];
    let progressPercent = 0;
    if (instance.status === 'COMPLETED') {
      progressPercent = 100;
    } else if (stages.length > 0 && instance.currentStage) {
      const idx = stages.indexOf(instance.currentStage);
      progressPercent = idx >= 0 ? Math.round(((idx + 1) / stages.length) * 100) : 0;
    }

    return {
      instance,
      stages,
      currentStage: instance.currentStage,
      progressPercent,
      openTasks: tasks.filter((t) => t.status === 'OPEN' || t.status === 'CLAIMED'),
      completedSteps: steps.filter((s) => s.status === 'COMPLETED'),
      comments,
    };
  }

  async addComment(
    instanceId: string,
    authorId: string,
    authorEmail: string,
    body: string,
  ): Promise<CaseComment> {
    const instance = await this.uow.repos.instances.findById(instanceId);
    if (!instance) throw new NotFoundError('WorkflowInstance', instanceId);

    const now = new Date();
    const comment = await this.uow.repos.caseComments.create({
      id: crypto.randomUUID(),
      instanceId,
      authorId,
      authorEmail,
      body: body.trim(),
      createdAt: now,
    });

    await this.uow.repos.outbox.append({
      id: crypto.randomUUID(),
      aggregateType: 'CaseComment',
      aggregateId: comment.id,
      eventType: 'CASE_COMMENT_ADDED',
      payload: { commentId: comment.id, instanceId, authorEmail },
      status: 'PENDING',
      attempts: 0,
      createdAt: now,
      publishedAt: null,
    });

    return comment;
  }

  async listComments(instanceId: string): Promise<CaseComment[]> {
    const instance = await this.uow.repos.instances.findById(instanceId);
    if (!instance) throw new NotFoundError('WorkflowInstance', instanceId);
    return this.uow.repos.caseComments.findByInstance(instanceId);
  }
}
