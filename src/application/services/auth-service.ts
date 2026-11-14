import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import type { AppConfig } from '../../config/env.js';
import { ConflictError, UnauthorizedError } from '../../domain/errors.js';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import type { AuthPrincipal, Role, UserRecord } from '../../domain/security/types.js';
import {
  hashPassword,
  sha256Hex,
  verifyPassword,
} from '../../infrastructure/security/password.js';
import { APP_CONFIG, UNIT_OF_WORK } from '../tokens.js';

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresInSeconds: number;
  user: {
    id: string;
    tenantId: string;
    email: string;
    name: string;
    role: Role;
  };
}

@Injectable()
export class AuthService {
  private readonly jwtSecretKey: Uint8Array;

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.jwtSecretKey = new TextEncoder().encode(config.JWT_SECRET);
  }

  async bootstrapAdminIfEmpty(): Promise<void> {
    // Ensure default tenant exists
    const defaultTenant = await this.uow.repos.tenants.findById('default');
    if (!defaultTenant) {
      await this.uow.repos.tenants.create({
        id: 'default',
        name: 'Default Organization',
        plan: 'ENTERPRISE',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    const defaultAdmin = await this.uow.repos.users.findByEmail(this.config.BOOTSTRAP_ADMIN_EMAIL, 'default');
    const now = new Date();
    if (!defaultAdmin) {
      await this.uow.repos.users.create({
        id: crypto.randomUUID(),
        tenantId: 'default',
        email: this.config.BOOTSTRAP_ADMIN_EMAIL,
        name: 'Platform Admin',
        passwordHash: hashPassword(this.config.BOOTSTRAP_ADMIN_PASSWORD),
        role: 'ADMIN',
        department: 'IT & Infrastructure',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    // In non-test environments (development & production), bootstrap role demo accounts
    if (this.config.NODE_ENV !== 'test') {
      await this.bootstrapDemoUsers();
    }
  }

  async bootstrapDemoUsers(): Promise<void> {
    const defaultUsers: Array<{
      email: string;
      name: string;
      role: Role;
      department: string;
    }> = [
      {
        email: 'hr@nexusflow.local',
        name: 'Almaz Tadesse',
        role: 'HR',
        department: 'Human Resources',
      },
      {
        email: 'operator@nexusflow.local',
        name: 'Sara Bekele',
        role: 'OPERATOR',
        department: 'Operations & DevOps',
      },
      {
        email: 'builder@nexusflow.local',
        name: 'Dawit Kebede',
        role: 'BUILDER',
        department: 'Engineering & Automation',
      },
      {
        email: 'viewer@nexusflow.local',
        name: 'Yonas Haile',
        role: 'VIEWER',
        department: 'Audit & Compliance',
      },
      {
        email: 'user@nexusflow.local',
        name: 'Abebe Bikila',
        role: 'USER',
        department: 'Operations / IT',
      },
    ];

    const passwordHash = hashPassword(this.config.BOOTSTRAP_ADMIN_PASSWORD);
    const now = new Date();
    for (const u of defaultUsers) {
      const existing = await this.uow.repos.users.findByEmail(u.email, 'default');
      if (!existing) {
        await this.uow.repos.users.create({
          id: crypto.randomUUID(),
          tenantId: 'default',
          email: u.email,
          name: u.name,
          passwordHash,
          role: u.role,
          department: u.department,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  async registerUser(input: {
    tenantId?: string;
    email: string;
    name: string;
    password: string;
    role: Role;
  }): Promise<Omit<UserRecord, 'passwordHash'>> {
    const tenantId = input.tenantId ?? 'default';
    const existing = await this.uow.repos.users.findByEmail(input.email, tenantId);
    if (existing) {
      throw new ConflictError(`User '${input.email}' already exists in tenant '${tenantId}'`);
    }

    const now = new Date();
    const created = await this.uow.repos.users.create({
      id: crypto.randomUUID(),
      tenantId,
      email: input.email.toLowerCase().trim(),
      name: input.name.trim(),
      passwordHash: hashPassword(input.password),
      role: input.role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return {
      id: created.id,
      tenantId: created.tenantId,
      email: created.email,
      name: created.name,
      role: created.role,
      isActive: created.isActive,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async login(email: string, password: string, tenantId?: string): Promise<LoginResult> {
    const user = await this.uow.repos.users.findByEmail(email, tenantId);
    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const expiresInSeconds = 3600;
    const accessToken = await new SignJWT({
      tenantId: user.tenantId,
      email: user.email,
      name: user.name,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(this.config.JWT_ISSUER)
      .setAudience(this.config.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${expiresInSeconds}s`)
      .sign(this.jwtSecretKey);

    await this.uow.repos.auditLogs.append({
      id: crypto.randomUUID(),
      tenantId: user.tenantId,
      userId: user.id,
      userEmail: user.email,
      action: 'AUTH_LOGIN',
      resourceType: 'User',
      resourceId: user.id,
      details: { role: user.role, loginTime: new Date().toISOString() },
      ipAddress: null,
      userAgent: null,
      timestamp: new Date(),
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresInSeconds,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };
  }

  async verifyBearerToken(token: string): Promise<AuthPrincipal> {
    try {
      const { payload } = await jwtVerify(token, this.jwtSecretKey, {
        issuer: this.config.JWT_ISSUER,
        audience: this.config.JWT_AUDIENCE,
      });
      if (!payload.sub || !payload.email || !payload.role) {
        throw new UnauthorizedError('Malformed JWT claims');
      }
      return {
        tenantId: (payload.tenantId as string) || 'default',
        userId: payload.sub,
        email: String(payload.email),
        name: (payload.name as string) || undefined,
        role: payload.role as Role,
        authType: 'jwt',
      };
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }

  async createApiKey(input: {
    tenantId?: string;
    userId: string;
    name: string;
    role: Role;
    expiresAt?: Date | null;
  }): Promise<{ id: string; rawKey: string; keyPrefix: string; role: Role }> {
    const rawSecret = crypto.randomBytes(24).toString('hex');
    const rawKey = `nxf_${rawSecret}`;
    const keyPrefix = rawKey.slice(0, 12);
    const keyHash = sha256Hex(rawKey);

    const record = await this.uow.repos.users.createApiKey({
      id: crypto.randomUUID(),
      tenantId: input.tenantId ?? 'default',
      userId: input.userId,
      name: input.name,
      keyPrefix,
      keyHash,
      role: input.role,
      expiresAt: input.expiresAt ?? null,
      lastUsedAt: null,
      createdAt: new Date(),
    });

    return {
      id: record.id,
      rawKey,
      keyPrefix: record.keyPrefix,
      role: record.role,
    };
  }

  async verifyApiKey(rawKey: string): Promise<AuthPrincipal> {
    const keyHash = sha256Hex(rawKey);
    const apiKey = await this.uow.repos.users.findApiKeyByHash(keyHash);
    if (!apiKey) {
      throw new UnauthorizedError('Invalid API key');
    }
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError('API key has expired');
    }

    const user = await this.uow.repos.users.findById(apiKey.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError('API key owner is inactive');
    }

    await this.uow.repos.users.touchApiKey(apiKey.id, new Date());
    return {
      tenantId: user.tenantId ?? apiKey.tenantId ?? 'default',
      userId: user.id,
      email: user.email,
      role: apiKey.role,
      authType: 'api_key',
    };
  }
}

