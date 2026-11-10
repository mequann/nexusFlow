import 'reflect-metadata';
import {
  type DynamicModule,
  type INestApplication,
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { WorkflowEngine } from './application/engine/workflow-engine.js';
import { AuthService } from './application/services/auth-service.js';
import { CredentialService } from './application/services/credential-service.js';
import { IncidentService } from './application/services/incident-service.js';
import { MessageService } from './application/services/message-service.js';
import { TaskService } from './application/services/task-service.js';
import { WorkflowService } from './application/services/workflow-service.js';
import {
  APP_CONFIG,
  APP_LOGGER,
  APP_METRICS,
  CIRCUIT_BREAKER,
  CREDENTIAL_VAULT,
  UNIT_OF_WORK,
} from './application/tokens.js';
import { type AppConfig, loadConfig } from './config/env.js';
import type { IUnitOfWork } from './domain/ports/repositories.js';
import { createPgPool } from './infrastructure/db/pool.js';
import { runMigrations } from './infrastructure/db/migrator.js';
import { PinoLogger } from './infrastructure/observability/logger.js';
import { PrometheusMetrics } from './infrastructure/observability/metrics.js';
import { MemoryUnitOfWork } from './infrastructure/repositories/memory/memory-uow.js';
import { PostgresUnitOfWork } from './infrastructure/repositories/postgres/postgres-uow.js';
import { CircuitBreakerRegistry } from './infrastructure/resilience/circuit-breaker.js';
import { AesGcmCredentialVault } from './infrastructure/security/crypto-vault.js';
import { JobWorker } from './infrastructure/workers/job-worker.js';
import { SchedulerWorker } from './infrastructure/workers/scheduler-worker.js';
import { AuthController } from './interfaces/http/controllers/auth.controller.js';
import { CredentialsController } from './interfaces/http/controllers/credentials.controller.js';
import { HealthController } from './interfaces/http/controllers/health.controller.js';
import { IncidentsController } from './interfaces/http/controllers/incidents.controller.js';
import { InstancesController } from './interfaces/http/controllers/instances.controller.js';
import { MessagesController } from './interfaces/http/controllers/messages.controller.js';
import { TasksController } from './interfaces/http/controllers/tasks.controller.js';
import { WebhooksController } from './interfaces/http/controllers/webhooks.controller.js';
import { WorkflowsController } from './interfaces/http/controllers/workflows.controller.js';
import { DomainExceptionFilter } from './interfaces/http/filters/domain-exception.filter.js';
import { AuthGuard } from './interfaces/http/guards/auth.guard.js';
import { RateLimitGuard } from './interfaces/http/guards/rate-limit.guard.js';
import { CorrelationMetricsInterceptor } from './interfaces/http/interceptors/correlation-metrics.interceptor.js';
import { IdempotencyInterceptor } from './interfaces/http/interceptors/idempotency.interceptor.js';

export interface NexusFlowModuleOptions {
  configOverrides?: Record<string, string | undefined>;
  enableWorkers?: boolean;
  enableDefaultMetrics?: boolean;
}

@Module({})
export class NexusFlowModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(JobWorker) private readonly jobWorker: JobWorker,
    @Inject(SchedulerWorker) private readonly schedulerWorker: SchedulerWorker,
  ) {}

  private static startWorkersOnInit = true;
  private static uowRef: IUnitOfWork | null = null;

  static register(options: NexusFlowModuleOptions = {}): DynamicModule {
    const config = loadConfig(options.configOverrides);
    NexusFlowModule.startWorkersOnInit =
      options.enableWorkers ?? config.ENABLE_EMBEDDED_WORKERS;

    const logger = new PinoLogger(config.LOG_LEVEL);
    const metrics = new PrometheusMetrics(options.enableDefaultMetrics ?? true);
    const vaultKeys: Record<string, string> = { v1: config.VAULT_MASTER_KEY_V1 };
    if (config.VAULT_MASTER_KEY_V2) vaultKeys.v2 = config.VAULT_MASTER_KEY_V2;
    const vault = new AesGcmCredentialVault(config.VAULT_ACTIVE_KEY_ID, vaultKeys);
    const circuitBreaker = new CircuitBreakerRegistry({
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
    });

    const uowProvider = {
      provide: UNIT_OF_WORK,
      useFactory: async (): Promise<IUnitOfWork> => {
        if (config.STORAGE_DRIVER === 'postgres') {
          if (!config.DATABASE_URL) {
            throw new Error('DATABASE_URL is required when STORAGE_DRIVER=postgres');
          }
          const pool = createPgPool(config.DATABASE_URL);
          await runMigrations(pool);
          const pgUow = new PostgresUnitOfWork(pool);
          NexusFlowModule.uowRef = pgUow;
          return pgUow;
        }
        const memUow = new MemoryUnitOfWork();
        NexusFlowModule.uowRef = memUow;
        return memUow;
      },
    };

    return {
      module: NexusFlowModule,
      controllers: [
        HealthController,
        AuthController,
        WorkflowsController,
        InstancesController,
        TasksController,
        IncidentsController,
        MessagesController,
        CredentialsController,
        WebhooksController,
      ],
      providers: [
        { provide: APP_CONFIG, useValue: config satisfies AppConfig },
        { provide: APP_LOGGER, useValue: logger },
        { provide: APP_METRICS, useValue: metrics },
        { provide: CREDENTIAL_VAULT, useValue: vault },
        { provide: CIRCUIT_BREAKER, useValue: circuitBreaker },
        uowProvider,
        CredentialService,
        AuthService,
        WorkflowService,
        WorkflowEngine,
        TaskService,
        IncidentService,
        MessageService,
        JobWorker,
        SchedulerWorker,
        IdempotencyInterceptor,
        { provide: APP_FILTER, useClass: DomainExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: CorrelationMetricsInterceptor },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [
        APP_CONFIG,
        APP_LOGGER,
        APP_METRICS,
        UNIT_OF_WORK,
        CredentialService,
        AuthService,
        WorkflowService,
        WorkflowEngine,
        TaskService,
        IncidentService,
        MessageService,
        JobWorker,
        SchedulerWorker,
      ],
    };
  }

  async onModuleInit(): Promise<void> {
    await this.authService.bootstrapAdminIfEmpty();
    if (NexusFlowModule.startWorkersOnInit) {
      this.jobWorker.start();
      this.schedulerWorker.start();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.jobWorker.stop();
    await this.schedulerWorker.stop();
    if (NexusFlowModule.uowRef) {
      await NexusFlowModule.uowRef.close();
    }
  }
}

export async function shutdownGracefully(app: INestApplication): Promise<void> {
  await app.close();
}
