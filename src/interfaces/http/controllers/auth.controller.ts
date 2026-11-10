import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuthService } from '../../../application/services/auth-service.js';
import type { AuthPrincipal } from '../../../domain/security/types.js';
import { CurrentPrincipal, Public, RequirePermission } from '../decorators/auth.decorator.js';
import { ZodValidationPipe } from '../pipes/zod-validation.pipe.js';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RegisterSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8),
  role: z.enum(['ADMIN', 'OPERATOR', 'BUILDER', 'VIEWER']),
});

const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  role: z.enum(['ADMIN', 'OPERATOR', 'BUILDER', 'VIEWER']),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

@ApiTags('Authentication')
@Controller('api/v1/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email & password to receive JWT' })
  async login(@Body(new ZodValidationPipe(LoginSchema)) body: z.infer<typeof LoginSchema>) {
    return this.authService.login(body.email, body.password);
  }

  @Post('register')
  @ApiBearerAuth()
  @RequirePermission('admin:users')
  @ApiOperation({ summary: 'Create a new user (ADMIN only)' })
  async register(@Body(new ZodValidationPipe(RegisterSchema)) body: z.infer<typeof RegisterSchema>) {
    return this.authService.registerUser(body);
  }

  @Post('api-keys')
  @ApiBearerAuth()
  @RequirePermission('admin:users')
  @ApiOperation({ summary: 'Issue a scoped service API key (ADMIN only)' })
  async createApiKey(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Body(new ZodValidationPipe(CreateApiKeySchema)) body: z.infer<typeof CreateApiKeySchema>,
  ) {
    const expiresAt = body.expiresInDays
      ? new Date(Date.now() + body.expiresInDays * 86_400_000)
      : null;
    return this.authService.createApiKey({
      userId: principal.userId,
      name: body.name,
      role: body.role,
      expiresAt,
    });
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return current authenticated principal' })
  me(@CurrentPrincipal() principal: AuthPrincipal | undefined) {
    return { principal };
  }
}

