import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { IncidentService } from '../../../application/services/incident-service.js';
import type { IncidentStatus } from '../../../domain/execution/types.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { CurrentPrincipal, RequirePermission } from '../decorators/auth.decorator.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

const ResolveIncidentSchema = z.object({
  action: z.enum(['RETRY', 'COMPENSATE', 'FAIL']),
  note: z.string().max(1000).optional(),
  variablesPatch: z.record(z.unknown()).optional(),
});

@ApiTags('Incidents (Camunda)')
@ApiBearerAuth()
@Controller('api/v1/incidents')
export class IncidentsController {
  constructor(@Inject(IncidentService) private readonly incidentService: IncidentService) {}

  @Get()
  @RequirePermission('incident:read')
  @ApiOperation({ summary: 'List operational incidents' })
  async list(
    @Query('status') status?: IncidentStatus,
    @Query('instanceId') instanceId?: string,
  ) {
    const items = await this.incidentService.listIncidents({ status, instanceId });
    return { items };
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('incident:resolve')
  @ApiOperation({ summary: 'Resolve an open incident via RETRY, COMPENSATE, or FAIL' })
  async resolve(
    @Param('id') id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(ResolveIncidentSchema)) body: z.infer<typeof ResolveIncidentSchema>,
  ) {
    return this.incidentService.resolveIncident(
      id,
      principal.userId,
      body.action,
      body.note,
      body.variablesPatch,
    );
  }
}

