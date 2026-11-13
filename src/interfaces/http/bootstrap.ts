import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { NexusFlowModule, type NexusFlowModuleOptions } from '../../app.module.js';

export async function createNestApp(
  options: NexusFlowModuleOptions = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(NexusFlowModule.register(options), {
    bufferLogs: false,
    logger: ['error', 'warn'],
  });

  // Security headers with CSP relaxed for standalone web studio frontend assets
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.enableCors({ origin: true, credentials: true });
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('NexusFlow Hybrid Orchestration API')
    .setDescription(
      'Senior Backend Hybrid Camunda BPMN + Temporal + n8n DAG + Kissflow Case Engine built with NestJS & Clean Architecture',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-api-key' }, 'x-api-key')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  // Standalone Single-Node Static UI Hosting:
  // If frontend/dist exists, serve it directly so running NexusFlow gives both the API and the full Studio UI out-of-the-box.
  const frontendDist = path.resolve(process.cwd(), 'frontend', 'dist');
  if (fs.existsSync(frontendDist)) {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.use(express.static(frontendDist));

    // HTML5 History Mode pushState fallback for client-side routing
    expressApp.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET') {
        return next();
      }
      const p = req.path;
      if (
        p.startsWith('/api') ||
        p.startsWith('/docs') ||
        p.startsWith('/webhooks') ||
        p.startsWith('/metrics') ||
        p.startsWith('/healthz') ||
        p.startsWith('/livez') ||
        p.startsWith('/readyz')
      ) {
        return next();
      }
      return res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  return app;
}
