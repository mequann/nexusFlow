import { Controller, Get, Param, Query, UseGuards, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../guards/auth.guard.js';
import { CurrentPrincipal, RequirePermission } from '../decorators/auth.decorator.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { AuditLogService } from '../../../application/services/audit-log.service.js';

@ApiTags('Logging & Compliance Systems (á‹¨áˆŽáŒáŠ•áŒ«áŠ“ á‹¨áŠ¦á‹²á‰µ áˆµáˆ­á‹“á‰µ)')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/v1/logs')
export class LogsController {
  constructor(
    @Inject(AuditLogService) private readonly auditLogService: AuditLogService,
  ) {}

  @Get('audit')
  @RequirePermission('instance:read')
  @ApiOperation({ summary: 'Retrieve enterprise compliance audit trail with filters' })
  @ApiQuery({ name: 'action', required: false, description: 'Filter by action (AUTH_LOGIN, INSTANCE_STARTED, etc.)' })
  @ApiQuery({ name: 'resourceType', required: false, description: 'Filter by resource (Workflow, User, etc.)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max records (default 100)' })
  async getAuditLogs(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('limit') limit?: string,
  ) {
    const items = await this.auditLogService.query({
      tenantId: principal.tenantId,
      action,
      resourceType,
      limit: limit ? parseInt(limit, 10) : 100,
    });
    return { items, total: items.length };
  }

  @Get('system')
  @RequirePermission('instance:read')
  @ApiOperation({ summary: 'Retrieve live structured engine logs from ring buffer with severity filtering' })
  @ApiQuery({ name: 'minLevel', required: false, description: 'Min level: debug, info, warn, error' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max logs (default 100)' })
  getSystemLogs(
    @Query('minLevel') minLevel?: string,
    @Query('limit') limit?: string,
  ) {
    const items = this.auditLogService.getSystemLogs(
      limit ? parseInt(limit, 10) : 100,
      minLevel,
    );
    return { items, total: items.length };
  }

  @Get('instances/:id')
  @RequirePermission('instance:read')
  @ApiOperation({ summary: 'Retrieve granular execution step logs and timings for a workflow instance' })
  @ApiParam({ name: 'id', description: 'Workflow instance UUID' })
  async getInstanceExecutionLogs(@Param('id') instanceId: string) {
    const steps = await this.auditLogService.getInstanceExecutionLogs(instanceId);
    return { instanceId, steps, total: steps.length };
  }
}
