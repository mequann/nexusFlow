import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { NexusFlowModule, type NexusFlowModuleOptions } from '../../app.module.js';

export async function createNestApp(
  options: NexusFlowModuleOptions = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(NexusFlowModule.register(options), {
    bufferLogs: false,
    logger: ['error', 'warn'],
  });

  app.use(helmet());
  app.enableCors({ origin: true, credentials: true });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('NexusFlow Hybrid Orchestration API')
    .setDescription(
      'Senior Backend Hybrid Camunda BPMN + n8n DAG Workflow Orchestration Engine built with NestJS & Clean Architecture',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'x-api-key')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  return app;
}

