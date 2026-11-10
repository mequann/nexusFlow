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
  @ApiBody({ type: LoginRequestDto })
  @ApiOkResponse({ description: 'JWT issued successfully', type: LoginResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid request format', type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials', type: ErrorResponseDto })
  async login(@Body(new ZodValidationPipe(LoginSchema)) body: LoginRequestDto) {
    return this.authService.login(body.email, body.password);
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
  async register(@Body(new ZodValidationPipe(RegisterSchema)) body: RegisterUserDto) {
    return this.authService.registerUser(body as z.infer<typeof RegisterSchema>);
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
      userId: principal.userId,
      name: validated.name,
      role: validated.role,
      expiresAt,
    });
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
