import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CredentialService } from '../../../application/services/credential-service.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { CurrentPrincipal, RequirePermission } from '../decorators/auth.decorator.js';
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
  async create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CreateCredentialSchema))
    body: z.infer<typeof CreateCredentialSchema>,
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
  async list() {
    const items = await this.credentialService.listCredentials();
    return { items };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('credential:write')
  @ApiOperation({ summary: 'Delete a credential by ID' })
  async remove(@Param('id') id: string): Promise<void> {
    await this.credentialService.deleteCredential(id);
  }
}

