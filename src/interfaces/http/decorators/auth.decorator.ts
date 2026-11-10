import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal, Permission } from '../../../domain/security/types.js';

export const IS_PUBLIC_KEY = 'nexusflow:isPublic';
export const REQUIRED_PERMISSION_KEY = 'nexusflow:permission';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);

export interface AuthenticatedRequest extends Request {
  principal?: AuthPrincipal;
}

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.principal;
  },
);

