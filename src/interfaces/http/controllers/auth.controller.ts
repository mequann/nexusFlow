import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { z } from 'zod';
import { AuthService } from '../../../application/services/auth-service.js';
import { UserSyncService } from '../../../application/services/user-sync-service.js';
import { SsoService } from '../../../application/services/sso.service.js';
import { ValidationError } from '../../../domain/errors.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { CurrentPrincipal, Public, RequirePermission } from '../decorators/auth.decorator.js';
import {
  CreateApiKeyDto,
  CreateApiKeyResponseDto,
  ErrorResponseDto,
  LoginRequestDto,
  LoginResponseDto,
  MeResponseDto,
  RegisterUserDto,
  UserResponseDto,
} from '../dto/api.dto.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  tenantId: z.string().optional(),
});

const RegisterSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'OPERATOR', 'BUILDER', 'VIEWER', 'HR', 'USER']),
  tenantId: z.string().optional(),
});

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  role: z.enum(['ADMIN', 'OPERATOR', 'BUILDER', 'VIEWER', 'HR', 'USER']),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

const ImportUsersSchema = z.object({
  users: z.array(
    z.object({
      email: z.string().email(),
      name: z.string().min(1),
      role: z.enum(['ADMIN', 'OPERATOR', 'BUILDER', 'VIEWER', 'HR', 'USER']).optional(),
      department: z.string().optional(),
      managerEmail: z.string().email().optional(),
      isActive: z.boolean().optional(),
      tenantId: z.string().optional(),
    }),
  ),
});

@ApiTags('Authentication')
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(UserSyncService) private readonly userSyncService: UserSyncService,
    @Inject(SsoService) private readonly ssoService: SsoService,
  ) {}

  @Public()
  @Get('sso/providers')
  @ApiOperation({ summary: 'List configured Enterprise SSO Identity Providers (OIDC, SAML, Keycloak, Azure AD)' })
  getSsoProviders() {
    return { providers: this.ssoService.listConfiguredProviders() };
  }

  @Public()
  @Post('sso/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Process Enterprise SSO identity token / callback and issue JWT' })
  async ssoCallback(
    @Body() body: { providerId: string; email: string; name?: string; groups?: string[]; department?: string; tenantId?: string },
  ) {
    if (!body?.email || !body?.providerId) {
      throw new ValidationError('Missing email or providerId in SSO callback payload');
    }
    return this.ssoService.handleSsoLogin({
      providerId: body.providerId,
      email: body.email,
      name: body.name || body.email.split('@')[0] || 'User',
      groups: body.groups,
      department: body.department,
      tenantId: body.tenantId,
    });
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email & password to receive JWT' })
  @ApiBody({ type: LoginRequestDto })
  @ApiOkResponse({ description: 'JWT issued successfully', type: LoginResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid request format', type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials', type: ErrorResponseDto })
  async login(@Body(new ZodValidationPipe(LoginSchema)) body: LoginRequestDto) {
    const validated = body as z.infer<typeof LoginSchema>;
    return this.authService.login(validated.email, validated.password, validated.tenantId);
  }

  @Post('register')
  @ApiBearerAuth()
  @RequirePermission('admin:users')
  @ApiOperation({ summary: 'Create a new user (ADMIN only)' })
  @ApiBody({ type: RegisterUserDto })
  @ApiCreatedResponse({ description: 'User created', type: UserResponseDto })
  @ApiBadRequestResponse({ description: 'Validation error', type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ErrorResponseDto })
  @ApiForbiddenResponse({ description: 'Insufficient role permissions', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'User already exists', type: ErrorResponseDto })
  async register(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(RegisterSchema)) body: RegisterUserDto,
  ) {
    const validated = body as z.infer<typeof RegisterSchema>;
    return this.authService.registerUser({
      ...validated,
      tenantId: validated.tenantId ?? principal.tenantId,
    });
  }

  @Post('api-keys')
  @ApiBearerAuth()
  @RequirePermission('admin:users')
  @ApiOperation({ summary: 'Issue a scoped service API key (ADMIN only)' })
  @ApiBody({ type: CreateApiKeyDto })
  @ApiCreatedResponse({ description: 'API key issued', type: CreateApiKeyResponseDto })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ErrorResponseDto })
  @ApiForbiddenResponse({ description: 'Insufficient role permissions', type: ErrorResponseDto })
  async createApiKey(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CreateApiKeySchema)) body: CreateApiKeyDto,
  ) {
    const validated = body as z.infer<typeof CreateApiKeySchema>;
    const expiresAt = validated.expiresInDays
      ? new Date(Date.now() + validated.expiresInDays * 86_400_000)
      : null;
    return this.authService.createApiKey({
      tenantId: principal.tenantId,
      userId: principal.userId,
      name: validated.name,
      role: validated.role,
      expiresAt,
    });
  }

  @Post('import-users')
  @ApiBearerAuth()
  @RequirePermission('admin:users')
  @ApiOperation({ summary: 'Import / batch-synchronize users from HRIS or external directory (ADMIN only)' })
  @ApiOkResponse({ description: 'User sync summary' })
  @ApiUnauthorizedResponse({ description: 'Unauthorized', type: ErrorResponseDto })
  @ApiForbiddenResponse({ description: 'Insufficient role permissions', type: ErrorResponseDto })
  async importUsers(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(ImportUsersSchema)) body: z.infer<typeof ImportUsersSchema>,
  ) {
    const usersWithTenant = body.users.map((u) => ({
      ...u,
      tenantId: u.tenantId ?? principal.tenantId,
    }));
    return this.userSyncService.syncUsers(usersWithTenant);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return current authenticated principal' })
  @ApiOkResponse({ description: 'Current authenticated principal', type: MeResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token', type: ErrorResponseDto })
  me(@CurrentPrincipal() principal: AuthPrincipal | undefined) {
    return { principal };
  }
}
