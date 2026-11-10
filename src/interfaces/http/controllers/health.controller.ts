import { Controller, Get, Header, Inject, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { APP_METRICS, UNIT_OF_WORK } from '../../../application/tokens.js';
import type { IUnitOfWork } from '../../../domain/ports/repositories.js';
import type { PrometheusMetrics } from '../../../infrastructure/observability/metrics.js';
import { Public } from '../decorators/auth.decorator.js';

@ApiTags('Health & Observability')
@Controller()
export class HealthController {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork,
    @Inject(APP_METRICS) private readonly metrics: PrometheusMetrics,
  ) {}

  @Public()
  @Get('healthz')
  @ApiOperation({ summary: 'Liveness probe' })
  healthz(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Public()
  @Get('readyz')
  @ApiOperation({ summary: 'Readiness probe checking storage backend connectivity' })
  async readyz(@Res() res: Response): Promise<void> {
    const healthy = await this.uow.healthCheck();
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ready' : 'unavailable',
      timestamp: new Date().toISOString(),
    });
  }

  @Public()
  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({ summary: 'Prometheus metrics endpoint' })
  async getMetrics(): Promise<string> {
    return this.metrics.renderPrometheus();
  }
}

