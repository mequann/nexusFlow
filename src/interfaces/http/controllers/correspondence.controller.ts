import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { AuthGuard } from '../guards/auth.guard.js';
import { CurrentPrincipal } from '../decorators/auth.decorator.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { CorrespondenceService } from '../../../application/services/correspondence-service.js';
import { z } from 'zod';

const CreateCorrespondenceSchema = z.object({
  type: z.enum(['INBOUND', 'OUTBOUND', 'INTERNAL_MEMO']),
  subject: z.string().min(3),
  senderOrg: z.string().min(2),
  recipientOrg: z.string().min(2),
  urgency: z.enum(['NORMAL', 'URGENT', 'VERY_URGENT']).optional(),
  classification: z.enum(['PUBLIC', 'CONFIDENTIAL', 'TOP_SECRET']).optional(),
  bodyHtml: z.string().optional(),
  attachments: z
    .array(
      z.object({
        name: z.string(),
        url: z.string(),
        sizeBytes: z.number().optional(),
      }),
    )
    .optional(),
  customPrefix: z.string().optional(),
});

const AddMinuteSchema = z.object({
  actionTaken: z.enum(['FORWARDED', 'RECOMMENDED', 'APPROVED', 'REJECTED', 'COMMENT']),
  comment: z.string().min(1),
});

const ApproveAndSealSchema = z.object({
  signatoryRole: z.string().min(2),
  baseUrl: z.string().url().optional(),
});

@ApiTags('Correspondence & Digital Registry (ደብዳቤ መዝገብ)')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/v1/correspondence')
export class CorrespondenceController {
  constructor(
    @Inject(CorrespondenceService) private readonly correspondenceService: CorrespondenceService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new inbound or outbound correspondence document with auto reference numbering' })
  public async create(
    @Body() body: unknown,
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    const input = CreateCorrespondenceSchema.parse(body);
    return this.correspondenceService.createDocument({
      ...input,
      tenantId: principal.tenantId,
      createdById: principal.userId,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List correspondence documents for current tenant' })
  public async list(@CurrentPrincipal() principal: AuthPrincipal) {
    return this.correspondenceService.listDocuments(principal.tenantId);
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiOperation({ summary: 'Get correspondence document details including minutes and seal' })
  public async getById(@Param('id') id: string) {
    return this.correspondenceService.getDocumentById(id);
  }

  @Post(':id/minutes')
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiOperation({ summary: 'Add official minute/endorsement (አስተያየትና የውሳኔ ሃሳብ)' })
  public async addMinute(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    const input = AddMinuteSchema.parse(body);
    const authorName = principal.email ? principal.email.split('@')[0] ?? 'Officer' : 'Officer';
    return this.correspondenceService.addMinute(id, {
      authorId: principal.userId,
      authorName,
      authorRole: principal.role,
      actionTaken: input.actionTaken,
      comment: input.comment,
    });
  }

  @Post(':id/approve-and-seal')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Document UUID' })
  @ApiOperation({ summary: 'Approve document and apply cryptographic SHA-256 seal with verification QR code' })
  public async approveAndSeal(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() principal: AuthPrincipal,
  ) {
    const input = ApproveAndSealSchema.parse(body);
    const signatoryName = principal.email ? principal.email.split('@')[0] ?? 'Signatory' : 'Signatory';
    return this.correspondenceService.approveAndSeal(id, {
      signatoryId: principal.userId,
      signatoryName,
      signatoryRole: input.signatoryRole,
      baseUrl: input.baseUrl,
    });
  }
}

/**
 * Public Verification Endpoint (No authentication required)
 * Anyone scanning the QR code or visiting /api/v1/verify/:id can verify authenticity.
 */
@ApiTags('Public Document Verification (የሰነድ ትክክለኛነት ማረጋገጫ)')
@Controller('api/v1/verify')
export class PublicVerificationController {
  constructor(
    @Inject(CorrespondenceService) private readonly correspondenceService: CorrespondenceService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Verify authenticity of a digitally sealed document (Public QR scanner destination)' })
  public async verify(@Param('id') id: string) {
    return this.correspondenceService.verifyPublicDocument(id);
  }
}
