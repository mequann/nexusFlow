import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../guards/auth.guard.js';
import { CurrentPrincipal } from '../decorators/auth.decorator.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { TenantWorkflowImporterService } from '../../../application/services/tenant-workflow-importer.service.js';
import type { TenantWorkflowImportPayload } from '../../../domain/workflow/tenant-import-types.js';

@ApiTags('Tenant Workflow Importer (ቴነንት የስራ ፍሰት ማስመጫ)')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/v1/workflows/import/json')
export class WorkflowImportController {
  constructor(private readonly importerService: TenantWorkflowImporterService) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate enterprise tenant workflow JSON template without saving' })
  public validate(@Body() payload: TenantWorkflowImportPayload) {
    return this.importerService.validate(payload);
  }

  @Post('process')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Process and import enterprise tenant workflow JSON template for caller tenant' })
  public async process(
    @Body() payload: TenantWorkflowImportPayload,
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    return this.importerService.process(payload, principal.tenantId, principal.userId);
  }
}

