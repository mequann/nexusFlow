import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '../../domain/errors.js';
import type { ICredentialVault } from '../../domain/ports/crypto.js';
import type { IUnitOfWork } from '../../domain/ports/repositories.js';
import type { CredentialRecord } from '../../domain/security/types.js';
import { CREDENTIAL_VAULT, UNIT_OF_WORK } from '../tokens.js';

export interface CreateCredentialInput {
  name: string;
  type: CredentialRecord['type'];
  secretData: Record<string, unknown>;
  createdBy: string | null;
}

export interface MaskedCredentialView {
  id: string;
  name: string;
  type: CredentialRecord['type'];
  keyId: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class CredentialService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: IUnitOfWork,
    @Inject(CREDENTIAL_VAULT) private readonly vault: ICredentialVault,
  ) {}

  async createCredential(input: CreateCredentialInput): Promise<MaskedCredentialView> {
    const encrypted = this.vault.encrypt(input.secretData);
    const now = new Date();
    const record: CredentialRecord = {
      id: crypto.randomUUID(),
      name: input.name,
      type: input.type,
      keyId: encrypted.keyId,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
      ciphertext: encrypted.ciphertext,
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    };

    const saved = await this.uow.repos.credentials.create(record);
    return this.mask(saved);
  }

  async listCredentials(): Promise<MaskedCredentialView[]> {
    const all = await this.uow.repos.credentials.list();
    return all.map((c) => this.mask(c));
  }

  async getDecryptedSecretByName(name: string): Promise<{
    type: CredentialRecord['type'];
    data: Record<string, unknown>;
  }> {
    const record = await this.uow.repos.credentials.findByName(name);
    if (!record) {
      throw new NotFoundError('Credential', name);
    }
    const data = this.vault.decrypt({
      keyId: record.keyId,
      iv: record.iv,
      authTag: record.authTag,
      ciphertext: record.ciphertext,
    });
    return { type: record.type, data };
  }

  async deleteCredential(id: string): Promise<void> {
    await this.uow.repos.credentials.delete(id);
  }

  private mask(record: CredentialRecord): MaskedCredentialView {
    return {
      id: record.id,
      name: record.name,
      type: record.type,
      keyId: record.keyId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

