import 'reflect-metadata';
import { APP_CONFIG, APP_LOGGER } from './application/tokens.js';
import type { AppConfig } from './config/env.js';
import type { ILogger } from './domain/ports/telemetry.js';
import { createNestApp } from './interfaces/http/bootstrap.js';

async function main(): Promise<void> {
  const app = await createNestApp();
  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = app.get<ILogger>(APP_LOGGER);

  await app.listen(config.PORT, config.HOST);
  logger.info('NexusFlow NestJS API server listening', {
    host: config.HOST,
    port: config.PORT,
    storageDriver: config.STORAGE_DRIVER,
    swaggerDocs: `http://localhost:${config.PORT}/docs`,
  });

  const handleShutdown = async (signal: string) => {
    logger.info('Received shutdown signal, draining gracefully', { signal });
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void handleShutdown('SIGINT'));
  process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
}

void main();

