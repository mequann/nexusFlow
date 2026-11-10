import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../../application/services/auth-service.js';
import { ForbiddenError, UnauthorizedError } from '../../../domain/errors.js';
import { type AuthPrincipal, type Permission, hasPermission } from '../../../domain/security/types.js';
import {
  type AuthenticatedRequest,
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSION_KEY,
} from '../decorators/auth.decorator.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    let principal: AuthPrincipal;

    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers['x-api-key'];

    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      principal = await this.authService.verifyBearerToken(token);
    } else if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim()) {
      principal = await this.authService.verifyApiKey(apiKeyHeader.trim());
    } else {
      throw new UnauthorizedError('Missing Bearer token or x-api-key header');
    }

    req.principal = principal;

    const requiredPermission = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredPermission && !hasPermission(principal.role, requiredPermission)) {
      throw new ForbiddenError(
        `Role '${principal.role}' lacks required permission '${requiredPermission}'`,
      );
    }

    return true;
  }
}

