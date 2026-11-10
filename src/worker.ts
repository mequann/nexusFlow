import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NexusFlowModule } from './app.module.js';
import { APP_CONFIG, APP_LOGGER } from './application/tokens.js';
import type { AppConfig } from './config/env.js';
import type { ILogger } from './domain/ports/telemetry.js';

async function main(): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(
    NexusFlowModule.register({ enableWorkers: true }),
    { logger: ['error', 'warn'] },
  );
  const config = ctx.get<AppConfig>(APP_CONFIG);
  const logger = ctx.get<ILogger>(APP_LOGGER);

  logger.info('NexusFlow standalone NestJS worker started', {
    storageDriver: config.STORAGE_DRIVER,
    concurrency: config.WORKER_CONCURRENCY,
  });

  const handleShutdown = async (signal: string) => {
    logger.info('Worker received shutdown signal', { signal });
    await ctx.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void handleShutdown('SIGINT'));
  process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
}

void main();

