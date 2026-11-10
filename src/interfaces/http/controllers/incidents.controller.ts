import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import { IncidentService } from '../../../application/services/incident-service.js';
import type { IncidentStatus } from '../../../domain/execution/types.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { CurrentPrincipal, RequirePermission } from '../decorators/auth.decorator.js';
import {
  ErrorResponseDto,
  IncidentListResponseDto,
  IncidentResponseDto,
  ResolveIncidentDto,
} from '../dto/api.dto.js';
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
  @ApiQuery({ name: 'status', required: false, enum: ['OPEN', 'RESOLVED', 'DISMISSED'] })
  @ApiQuery({ name: 'instanceId', required: false, example: '97d2ba45-8609-4bb4-bc9d-aedbbd3233ed' })
  @ApiOkResponse({ description: 'List of incidents', type: IncidentListResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ErrorResponseDto })
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
  @ApiParam({ name: 'id', example: '69df0788-fe2d-43a7-b826-9732deb718fe' })
  @ApiBody({ type: ResolveIncidentDto })
  @ApiOkResponse({ description: 'Incident resolved', type: IncidentResponseDto })
  @ApiBadRequestResponse({ description: 'Validation failed', type: ErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Incident not found', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Incident already resolved', type: ErrorResponseDto })
  async resolve(
    @Param('id') id: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(ResolveIncidentSchema)) body: ResolveIncidentDto,
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
