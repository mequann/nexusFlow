import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import { CredentialService } from '../../../application/services/credential-service.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { CurrentPrincipal, RequirePermission } from '../decorators/auth.decorator.js';
import {
  CreateCredentialDto,
  ErrorResponseDto,
  MaskedCredentialListResponseDto,
  MaskedCredentialResponseDto,
} from '../dto/api.dto.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

const CreateCredentialSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  type: z.enum(['bearer', 'api_key', 'basic', 'custom']),
  secretData: z.record(z.unknown()),
});

@ApiTags('Credential Vault (n8n)')
@ApiBearerAuth()
@Controller('api/v1/credentials')
export class CredentialsController {
  constructor(@Inject(CredentialService) private readonly credentialService: CredentialService) {}

  @Post()
  @RequirePermission('credential:write')
  @ApiOperation({ summary: 'Store encrypted credentials using AES-256-GCM vault' })
  @ApiBody({ type: CreateCredentialDto })
  @ApiCreatedResponse({
    description: 'Credential encrypted and stored (masked response)',
    type: MaskedCredentialResponseDto,
  })
  @ApiBadRequestResponse({ description: 'Validation error', type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'Credential name already exists', type: ErrorResponseDto })
  async create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CreateCredentialSchema)) body: CreateCredentialDto,
  ) {
    return this.credentialService.createCredential({
      name: body.name,
      type: body.type,
      secretData: body.secretData,
      createdBy: principal.userId,
    });
  }

  @Get()
  @RequirePermission('credential:read')
  @ApiOperation({ summary: 'List stored credentials (secrets always masked)' })
  @ApiOkResponse({ description: 'Masked credentials list', type: MaskedCredentialListResponseDto })
  async list() {
    const items = await this.credentialService.listCredentials();
    return { items };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('credential:write')
  @ApiOperation({ summary: 'Delete a credential by ID' })
  @ApiParam({ name: 'id', example: 'd1e2f3a4-5678-4901-abcd-1234567890ef' })
  @ApiNoContentResponse({ description: 'Credential deleted' })
  @ApiNotFoundResponse({ description: 'Credential not found', type: ErrorResponseDto })
  async remove(@Param('id') id: string): Promise<void> {
    await this.credentialService.deleteCredential(id);
  }
}
