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
    const count = await this.uow.repos.users.count();
    if (count > 0) return;

    const now = new Date();
    await this.uow.repos.users.create({
      id: crypto.randomUUID(),
      email: this.config.BOOTSTRAP_ADMIN_EMAIL,
      name: 'Platform Admin',
      passwordHash: hashPassword(this.config.BOOTSTRAP_ADMIN_PASSWORD),
      role: 'ADMIN',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  async registerUser(input: {
    email: string;
    name: string;
    password: string;
    role: Role;
  }): Promise<Omit<UserRecord, 'passwordHash'>> {
    const existing = await this.uow.repos.users.findByEmail(input.email);
    if (existing) {
      throw new ConflictError(`User '${input.email}' already exists`);
    }

    const now = new Date();
    const created = await this.uow.repos.users.create({
      id: crypto.randomUUID(),
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
      email: created.email,
      name: created.name,
      role: created.role,
      isActive: created.isActive,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const user = await this.uow.repos.users.findByEmail(email);
    if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const expiresInSeconds = 3600;
    const accessToken = await new SignJWT({
      email: user.email,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuer(this.config.JWT_ISSUER)
      .setAudience(this.config.JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${expiresInSeconds}s`)
      .sign(this.jwtSecretKey);

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresInSeconds,
      user: {
        id: user.id,
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
        userId: payload.sub,
        email: String(payload.email),
        role: payload.role as Role,
        authType: 'jwt',
      };
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }

  async createApiKey(input: {
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
      userId: user.id,
      email: user.email,
      role: apiKey.role,
      authType: 'api_key',
    };
  }
}

