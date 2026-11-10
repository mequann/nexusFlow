import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CaseService } from '../../../application/services/case-service.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { CurrentPrincipal, RequirePermission } from '../decorators/auth.decorator.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

const AddCommentSchema = z.object({
  body: z.string().min(1).max(4000),
});

@ApiTags('Business Cases & Collaboration (Kissflow)')
@ApiBearerAuth()
@Controller('api/v1/cases')
export class CasesController {
  constructor(@Inject(CaseService) private readonly caseService: CaseService) {}

  @Get(':instanceId')
  @RequirePermission('instance:read')
  @ApiOperation({
    summary: 'Get Kissflow business case view (stage milestone progress, SLA status, tasks, comments)',
  })
  async getCase(@Param('instanceId') instanceId: string) {
    return this.caseService.getCaseSummary(instanceId);
  }

  @Get(':instanceId/comments')
  @RequirePermission('instance:read')
  @ApiOperation({ summary: 'List collaboration comments on a case' })
  async listComments(@Param('instanceId') instanceId: string) {
    const items = await this.caseService.listComments(instanceId);
    return { items };
  }

  @Post(':instanceId/comments')
  @RequirePermission('task:act')
  @ApiOperation({ summary: 'Add a collaboration comment to a business case' })
  async addComment(
    @Param('instanceId') instanceId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(AddCommentSchema)) body: z.infer<typeof AddCommentSchema>,
  ) {
    return this.caseService.addComment(
      instanceId,
      principal.userId,
      principal.email,
      body.body,
    );
  }
}
