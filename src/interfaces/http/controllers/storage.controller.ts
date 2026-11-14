import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { AuthGuard } from '../guards/auth.guard.js';
import { CurrentPrincipal, Public } from '../decorators/auth.decorator.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { StorageService } from '../../../application/services/storage.service.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

const UploadFileSchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().optional(),
  contentBase64: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

@ApiTags('Document & Attachment Storage (S3 / MinIO / Local)')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('api/v1/storage')
export class StorageController {
  constructor(@Inject(StorageService) private readonly storageService: StorageService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Upload document or requisition attachment (S3, MinIO, database or local disk)',
  })
  async upload(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(UploadFileSchema)) body: z.infer<typeof UploadFileSchema>,
  ) {
    const buffer = Buffer.from(body.contentBase64, 'base64');
    const file = await this.storageService.uploadFile({
      filename: body.filename,
      mimeType: body.mimeType,
      content: buffer,
      metadata: body.metadata,
      tenantId: principal.tenantId,
      uploadedBy: principal.email,
    });

    return {
      file,
      downloadUrl: `/api/v1/storage/files/${file.id}/download`,
    };
  }

  @Get(['', 'files'])
  @ApiOperation({ summary: 'List stored documents and requisition attachments' })
  async list(@CurrentPrincipal() principal: AuthPrincipal) {
    const items = await this.storageService.listFiles(principal.tenantId);
    return { items, files: items, total: items.length };
  }

  @Get([':id', 'files/:id'])
  @ApiParam({ name: 'id', description: 'File UUID' })
  @ApiOperation({ summary: 'Get file metadata and storage details' })
  async getById(@Param('id') id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    const file = await this.storageService.getFile(id, principal.tenantId);
    return {
      file,
      downloadUrl: `/api/v1/storage/files/${file.id}/download`,
    };
  }

  @Public()
  @Get([':id/content', 'files/:id/download'])
  @ApiParam({ name: 'id', description: 'File UUID' })
  @ApiOperation({ summary: 'Download file binary stream' })
  async download(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename, mimeType } = await this.storageService.downloadFileContent(id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  @Delete([':id', 'files/:id'])
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'File UUID' })
  @ApiOperation({ summary: 'Delete a stored file' })
  async remove(@Param('id') id: string, @CurrentPrincipal() principal: AuthPrincipal) {
    await this.storageService.deleteFile(id, principal.tenantId);
    return { success: true };
  }
}
