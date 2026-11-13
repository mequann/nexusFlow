import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NexusFlowModule } from '../src/app.module.js';
import { AuthService } from '../src/application/services/auth-service.js';

async function seed(): Promise<void> {
  const ctx = await NestFactory.createApplicationContext(
    NexusFlowModule.register({ enableWorkers: false, enableStarterWorkflows: true }),
    { logger: ['error', 'warn'] },
  );

  try {
    const authService = ctx.get(AuthService);
    await authService.bootstrapAdminIfEmpty();
    console.log('Seeding completed successfully: Admin user and starter workflows verified.');
  } finally {
    await ctx.close();
  }
}

void seed();
