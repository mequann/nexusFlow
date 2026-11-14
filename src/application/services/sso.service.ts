import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, APP_LOGGER, UNIT_OF_WORK } from '../tokens.js';
import type { AppConfig } from '../../config/env.js';
import type { ILogger } from '../../domain/ports/telemetry.js';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import type { Role } from '../../domain/security/types.js';
import { AuthService } from './auth-service.js';

export interface SsoProviderDescriptor {
  id: string;
  name: string;
  type: 'oidc' | 'saml' | 'ldap';
  icon: string;
  enabled: boolean;
  loginUrl: string;
}

export interface SsoCallbackInput {
  providerId: string;
  email: string;
  name: string;
  groups?: string[];
  department?: string;
  tenantId?: string;
}

@Injectable()
export class SsoService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(APP_LOGGER) private readonly logger: ILogger,
  ) {}

  /**
   * Return configured enterprise Identity Providers (IDPs)
   */
  listConfiguredProviders(): SsoProviderDescriptor[] {
    const isSsoEnabled = this.config.SSO_ENABLED;
    return [
      {
        id: 'entra_id',
        name: 'Microsoft Entra ID (Azure AD)',
        type: 'oidc',
        icon: 'microsoft',
        enabled: isSsoEnabled || Boolean(this.config.SSO_OIDC_ISSUER_URL),
        loginUrl: '/api/v1/auth/sso/entra_id/login',
      },
      {
        id: 'keycloak',
        name: 'Keycloak / RedHat Sovereign SSO',
        type: 'oidc',
        icon: 'shield',
        enabled: true,
        loginUrl: '/api/v1/auth/sso/keycloak/login',
      },
      {
        id: 'google_workspace',
        name: 'Google Workspace Enterprise',
        type: 'oidc',
        icon: 'google',
        enabled: isSsoEnabled,
        loginUrl: '/api/v1/auth/sso/google/login',
      },
      {
        id: 'enterprise_ldap',
        name: 'Enterprise Active Directory / LDAP',
        type: 'ldap',
        icon: 'server',
        enabled: true,
        loginUrl: '/api/v1/auth/sso/ldap/login',
      },
    ];
  }

  /**
   * Just-In-Time (JIT) Enterprise user provisioning & JWT issuance on SSO callback
   */
  async handleSsoLogin(input: SsoCallbackInput) {
    const tenantId = input.tenantId ?? 'default';
    const email = input.email.trim().toLowerCase();
    const role = this.mapGroupsToRole(input.groups);

    let user = await this.uow.repos.users.findByEmail(email, tenantId);

    if (!user) {
      // JIT Provisioning
      const now = new Date();
      user = await this.uow.repos.users.create({
        id: crypto.randomUUID(),
        tenantId,
        email,
        name: input.name || email.split('@')[0] || 'User',
        passwordHash: 'SSO_FEDERATED_AUTHENTICATION',
        role,
        department: input.department ?? 'Enterprise SSO Provisioned',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });

      this.logger.info(`JIT provisioned new SSO user '${email}' with role '${role}'`);
    } else if (input.groups && input.groups.length > 0) {
      // Sync role with directory claims
      if (user.role !== role) {
        user = await this.uow.repos.users.update({
          ...user,
          role,
          name: input.name || user.name,
          updatedAt: new Date(),
        });
      }
    }

    // Issue JWT session through AuthService
    const loginResult = await this.authService.login(email, 'BYPASS_SSO_PREVERIFIED', tenantId).catch(async () => {
      // If password verification was bypassed for SSO, issue token directly
      return this.authService.verifyBearerToken(
        await this.generateSsoToken(user!, tenantId),
      ).then(async (principal) => {
        return {
          accessToken: await this.generateSsoToken(user!, tenantId),
          tokenType: 'Bearer',
          expiresInSeconds: 3600,
          user: {
            id: user!.id,
            tenantId: user!.tenantId,
            email: user!.email,
            name: user!.name,
            role: user!.role,
          },
        };
      });
    });

    return loginResult;
  }

  private mapGroupsToRole(groups?: string[]): Role {
    if (!groups || groups.length === 0) return 'USER';
    const lower = groups.map((g) => g.toLowerCase());

    if (lower.some((g) => g.includes('admin') || g.includes('sysadmin'))) return 'ADMIN';
    if (lower.some((g) => g.includes('hr') || g.includes('people') || g.includes('human_resources'))) return 'HR';
    if (lower.some((g) => g.includes('devops') || g.includes('operator') || g.includes('ops'))) return 'OPERATOR';
    if (lower.some((g) => g.includes('builder') || g.includes('developer') || g.includes('engineer') || g.includes('architect'))) return 'BUILDER';
    if (lower.some((g) => g.includes('audit') || g.includes('compliance') || g.includes('viewer'))) return 'VIEWER';
    return 'USER';
  }

  private async generateSsoToken(user: { id: string; tenantId: string; email: string; name: string; role: Role }, tenantId: string): Promise<string> {
    const { SignJWT } = await import('jose');
    const secretKey = new TextEncoder().encode(this.config.JWT_SECRET);
    return new SignJWT({
      tenantId: user.tenantId ?? tenantId,
      email: user.email,
      name: user.name,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(this.config.JWT_ISSUER)
      .setAudience(this.config.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('3600s')
      .sign(secretKey);
  }
}

