import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import cronParser from 'cron-parser';
import { WorkflowEngine } from '../../application/engine/workflow-engine.js';
import { TaskService } from '../../application/services/task-service.js';
import { EventDispatcherService } from '../../application/services/event-dispatcher.service.js';
import { APP_CONFIG, APP_LOGGER, UNIT_OF_WORK } from '../../application/tokens.js';
import type { AppConfig } from '../../config/env.js';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import type { ILogger } from '../../domain/ports/telemetry.js';

@Injectable()
export class SchedulerWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private activePromise: Promise<void> | null = null;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork,
    @Inject(WorkflowEngine) private readonly engine: WorkflowEngine,
    @Inject(TaskService) private readonly taskService: TaskService,
    @Inject(EventDispatcherService) private readonly eventDispatcher: EventDispatcherService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_LOGGER) private readonly logger: ILogger,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(0);
    this.logger.info('SchedulerWorker (timers, cron, outbox relay) started');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.activePromise) {
      await this.activePromise;
    }
    this.logger.info('SchedulerWorker stopped gracefully');
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.activePromise = this.tick()
        .then(() => undefined)
        .catch((err) => {
          this.logger.error('SchedulerWorker tick failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          this.activePromise = null;
          this.scheduleNext(this.config.TIMER_POLL_INTERVAL_MS);
        });
    }, delayMs);
  }

  async tick(
    now = new Date(),
  ): Promise<{
    timersFired: number;
    cronsFired: number;
    slaEscalated: number;
    outboxRelayed: number;
  }> {
    const timersFired = await this.fireDueTimers(now);
    const cronsFired = await this.fireDueCrons(now);
    const slaEscalated = await this.taskService.escalateOverdueTasks(now);
    const outboxRelayed = await this.relayOutbox();
    return { timersFired, cronsFired, slaEscalated, outboxRelayed };
  }

  async fireDueTimers(now = new Date()): Promise<number> {
    const dueTimers = await this.uow.repos.subscriptions.findDueTimers(now, 50);
    let fired = 0;

    for (const sub of dueTimers) {
      await this.uow.runInTransaction(async (repos) => {
        await repos.subscriptions.update({
          ...sub,
          status: 'TRIGGERED',
          payload: { firedAt: now.toISOString() },
          triggeredAt: now,
        });
        const enqueueNow = new Date();
        await repos.jobs.enqueue({
          id: crypto.randomUUID(),
          instanceId: sub.instanceId,
          tokenId: sub.tokenId,
          nodeId: sub.nodeId,
          jobType: 'RESUME_TOKEN',
          payload: { timerFiredAt: now.toISOString() },
          status: 'PENDING',
          attempts: 0,
          maxAttempts: 3,
          availableAt: enqueueNow,
          lockedBy: null,
          lockedAt: null,
          lastError: null,
          createdAt: enqueueNow,
          updatedAt: enqueueNow,
        });
      });
      fired += 1;
    }

    return fired;
  }

  async fireDueCrons(now = new Date()): Promise<number> {
    const dueWorkflows = await this.uow.repos.workflows.findDueCronWorkflows(now);
    let fired = 0;

    for (const wf of dueWorkflows) {
      if (!wf.cronExpression) continue;
      const interval = cronParser.parseExpression(wf.cronExpression, { currentDate: now });
      const nextRunAt = interval.next().toDate();

      await this.uow.repos.workflows.update({
        ...wf,
        cronNextRunAt: nextRunAt,
        updatedAt: now,
      });

      await this.engine.startInstance({
        workflowKey: wf.key,
        version: wf.version,
        triggerType: 'trigger.cron',
        triggerPayload: { scheduledAt: now.toISOString(), cron: wf.cronExpression },
      });
      fired += 1;
    }

    return fired;
  }

  async relayOutbox(): Promise<number> {
    const pending = await this.uow.repos.outbox.fetchPending(50);
    let relayed = 0;
    for (const evt of pending) {
      try {
        await this.eventDispatcher.dispatch(evt);
        this.logger.debug('Outbox event relayed', {
          eventId: evt.id,
          eventType: evt.eventType,
          aggregateType: evt.aggregateType,
          aggregateId: evt.aggregateId,
        });
        await this.uow.repos.outbox.markPublished(evt.id, new Date());
        relayed += 1;
      } catch (err) {
        this.logger.error('Failed to dispatch outbox event', {
          eventId: evt.id,
          error: err instanceof Error ? err.message : String(err),
        });
        await this.uow.repos.outbox.markFailed(evt.id);
      }
    }
    return relayed;
  }
}
