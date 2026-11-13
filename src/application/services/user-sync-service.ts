import crypto from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import type { Role, UserRecord } from '../../domain/security/types.js';
import { hashPassword } from '../../infrastructure/security/password.js';
import { UNIT_OF_WORK } from '../tokens.js';

export interface ExternalUserInput {
  email: string;
  name: string;
  role?: Role;
  department?: string;
  managerEmail?: string;
  isActive?: boolean;
}

export interface SyncUsersResult {
  totalReceived: number;
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ email: string; reason: string }>;
}

@Injectable()
export class UserSyncService {
  private readonly logger = new Logger(UserSyncService.name);

  constructor(@Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork) {}

  /**
   * Synchronizes user records from an external HRIS, SCIM, Active Directory, or CSV batch.
   * Handles user creation, department updates, active status, and manager hierarchy resolution.
   */
  async syncUsers(inputs: ExternalUserInput[]): Promise<SyncUsersResult> {
    const result: SyncUsersResult = {
      totalReceived: inputs.length,
      created: 0,
      updated: 0,
      failed: 0,
      errors: [],
    };

    // First pass: upsert all user accounts
    for (const input of inputs) {
      try {
        const existing = await this.uow.repos.users.findByEmail(input.email);
        const now = new Date();

        if (existing) {
          const updated: UserRecord = {
            ...existing,
            name: input.name || existing.name,
            role: input.role ?? existing.role,
            department: input.department !== undefined ? input.department : existing.department,
            isActive: input.isActive !== undefined ? input.isActive : existing.isActive,
            updatedAt: now,
          };
          await this.uow.repos.users.update(updated);
          result.updated += 1;
        } else {
          // Default temporary password for newly synced users: random cryptographic token
          const tempPassword = crypto.randomBytes(16).toString('hex');
          const newUser: UserRecord = {
            id: crypto.randomUUID(),
            email: input.email.toLowerCase(),
            name: input.name,
            passwordHash: hashPassword(tempPassword),
            role: input.role ?? 'VIEWER',
            department: input.department ?? null,
            managerId: null,
            outOfOffice: false,
            delegateId: null,
            isActive: input.isActive ?? true,
            createdAt: now,
            updatedAt: now,
          };
          await this.uow.repos.users.create(newUser);
          result.created += 1;
        }
      } catch (err: unknown) {
        result.failed += 1;
        result.errors.push({
          email: input.email,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Second pass: resolve manager hierarchy links
    for (const input of inputs) {
      if (!input.managerEmail) continue;
      try {
        const user = await this.uow.repos.users.findByEmail(input.email);
        const manager = await this.uow.repos.users.findByEmail(input.managerEmail);
        if (user && manager && user.managerId !== manager.id) {
          await this.uow.repos.users.update({
            ...user,
            managerId: manager.id,
            updatedAt: new Date(),
          });
        }
      } catch (err: unknown) {
        this.logger.warn(`Failed to link manager for ${input.email}: ${String(err)}`);
      }
    }

    this.logger.log(
      `HRIS sync completed: ${result.created} created, ${result.updated} updated, ${result.failed} failed`,
    );
    return result;
  }
}
