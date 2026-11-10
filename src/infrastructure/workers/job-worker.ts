import os from 'node:os';
import { Inject, Injectable } from '@nestjs/common';
import { WorkflowEngine } from '../../application/engine/workflow-engine.js';
import { APP_CONFIG, APP_LOGGER, UNIT_OF_WORK } from '../../application/tokens.js';
import type { AppConfig } from '../../config/env.js';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import type { ILogger } from '../../domain/ports/telemetry.js';

@Injectable()
export class JobWorker {
  private readonly workerId: string;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private activePromise: Promise<void> | null = null;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork,
    @Inject(WorkflowEngine) private readonly engine: WorkflowEngine,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_LOGGER) private readonly logger: ILogger,
  ) {
    this.workerId = `${os.hostname()}-${process.pid}`;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext(0);
    this.logger.info('JobWorker started', {
      workerId: this.workerId,
      concurrency: this.config.WORKER_CONCURRENCY,
    });
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
    this.logger.info('JobWorker stopped gracefully', { workerId: this.workerId });
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.activePromise = this.tick()
        .then(() => undefined)
        .catch((err) => {
          this.logger.error('JobWorker tick failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          this.activePromise = null;
          this.scheduleNext(this.config.WORKER_POLL_INTERVAL_MS);
        });
    }, delayMs);
  }

  async tick(): Promise<number> {
    const jobs = await this.uow.repos.jobs.claimNextBatch(
      this.workerId,
      this.config.WORKER_CONCURRENCY,
      new Date(),
    );
    if (jobs.length === 0) return 0;

    await Promise.all(
      jobs.map(async (job) => {
        try {
          await this.engine.processJob(job);
        } catch (err) {
          this.logger.error('Unhandled job execution error', {
            jobId: job.id,
            instanceId: job.instanceId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );

    return jobs.length;
  }
}
