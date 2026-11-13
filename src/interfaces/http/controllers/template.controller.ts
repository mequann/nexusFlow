import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Inject,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiParam } from '@nestjs/swagger';
import { AuthGuard } from '../guards/auth.guard.js';
import { CurrentPrincipal } from '../decorators/auth.decorator.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { WorkflowService } from '../../../application/services/workflow-service.js';
import {
  UNIVERSAL_INDUSTRY_TEMPLATES,
  type IndustryTemplateMeta,
} from '../../../application/templates/universal-industry-catalog.js';
import { NotFoundError } from '../../../domain/errors.js';

@ApiTags('Universal Industry Templates (ሁለንተናዊ የድርጅት ቴምፕሌቶች)')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/v1/templates')
export class TemplateController {
  constructor(@Inject(WorkflowService) private readonly workflowService: WorkflowService) {}

  @Get('catalog')
  @ApiOperation({
    summary: 'List turnkey industry workflow templates (Banking, Healthcare, Supply Chain, Telecom, Legal, DevOps)',
  })
  @ApiQuery({ name: 'category', required: false, description: 'Filter by category (BANKING, HEALTHCARE, etc.)' })
  public getCatalog(@Query('category') category?: string): { items: IndustryTemplateMeta[]; total: number } {
    let items = UNIVERSAL_INDUSTRY_TEMPLATES;
    if (category) {
      items = items.filter((t) => t.category.toLowerCase() === category.toLowerCase());
    }
    return { items, total: items.length };
  }

  @Post(':key/instantiate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Instantiate and publish an industry template directly into the authenticated tenant workspace',
  })
  @ApiParam({ name: 'key', description: 'Template key to instantiate' })
  public async instantiate(
    @Param('key') key: string,
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    const template = UNIVERSAL_INDUSTRY_TEMPLATES.find((t) => t.key === key);
    if (!template) {
      throw new NotFoundError('IndustryTemplate', key);
    }

    const created = await this.workflowService.createWorkflow({
      ...template.workflow,
      tenantId: principal.tenantId,
      createdBy: null,
    });

    const published = await this.workflowService.publishWorkflow(created.id);

    return {
      message: `Template '${template.name}' instantiated and published successfully for tenant '${principal.tenantId}'`,
      workflow: published,
    };
  }
}
