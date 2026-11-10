import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import { CaseService } from '../../../application/services/case-service.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { CurrentPrincipal, RequirePermission } from '../decorators/auth.decorator.js';
import {
  AddCommentDto,
  CaseCommentListResponseDto,
  CaseCommentResponseDto,
  CaseSummaryResponseDto,
  ErrorResponseDto,
} from '../dto/api.dto.js';
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
  @ApiParam({ name: 'instanceId', example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  @ApiOkResponse({ description: 'Business case summary', type: CaseSummaryResponseDto })
  @ApiNotFoundResponse({ description: 'Case instance not found', type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ErrorResponseDto })
  async getCase(@Param('instanceId') instanceId: string) {
    return this.caseService.getCaseSummary(instanceId);
  }

  @Get(':instanceId/comments')
  @RequirePermission('instance:read')
  @ApiOperation({ summary: 'List collaboration comments on a case' })
  @ApiParam({ name: 'instanceId', example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  @ApiOkResponse({ description: 'Case collaboration comments', type: CaseCommentListResponseDto })
  @ApiNotFoundResponse({ description: 'Case instance not found', type: ErrorResponseDto })
  async listComments(@Param('instanceId') instanceId: string) {
    const items = await this.caseService.listComments(instanceId);
    return { items };
  }

  @Post(':instanceId/comments')
  @RequirePermission('task:act')
  @ApiOperation({ summary: 'Add a collaboration comment to a business case' })
  @ApiParam({ name: 'instanceId', example: 'b64d7c30-2d2a-4f7c-9c30-cf2310fb5a5f' })
  @ApiBody({ type: AddCommentDto })
  @ApiCreatedResponse({ description: 'Comment added to case', type: CaseCommentResponseDto })
  @ApiBadRequestResponse({ description: 'Comment body invalid', type: ErrorResponseDto })
  @ApiNotFoundResponse({ description: 'Case instance not found', type: ErrorResponseDto })
  async addComment(
    @Param('instanceId') instanceId: string,
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(AddCommentSchema)) body: AddCommentDto,
  ) {
    return this.caseService.addComment(
      instanceId,
      principal.userId,
      principal.email,
      body.body,
    );
  }
}
