import crypto from 'node:crypto';
import { SecurityViolationError, ValidationError } from '../../domain/errors.js';
import type { EncryptedPayload, ICredentialVault } from '../../domain/ports/crypto.js';

export interface VaultKeyRing {
  activeKeyId: string;
  keys: Record<string, Buffer>;
}

/**
 * AES-256-GCM authenticated encryption vault with multi-key rotation support.
 */
export class AesGcmCredentialVault implements ICredentialVault {
  private readonly activeKeyId: string;
  private readonly keys: Map<string, Buffer>;

  constructor(activeKeyId: string, hexKeys: Record<string, string>) {
    this.activeKeyId = activeKeyId;
    this.keys = new Map();

    for (const [keyId, hex] of Object.entries(hexKeys)) {
      if (!hex) continue;
      const buf = Buffer.from(hex, 'hex');
      if (buf.length !== 32) {
        throw new ValidationError(`Vault key '${keyId}' must be 32 bytes (64 hex chars)`);
      }
      this.keys.set(keyId, buf);
    }

    if (!this.keys.has(activeKeyId)) {
      throw new ValidationError(`Active vault key '${activeKeyId}' is not configured`);
    }
  }

  encrypt(plaintext: Record<string, unknown>): EncryptedPayload {
    const key = this.keys.get(this.activeKeyId);
    if (!key) {
      throw new SecurityViolationError(`Missing encryption key '${this.activeKeyId}'`);
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const serialized = JSON.stringify(plaintext);
    const encrypted = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      keyId: this.activeKeyId,
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      ciphertext: encrypted.toString('base64'),
    };
  }

  decrypt(payload: EncryptedPayload): Record<string, unknown> {
    const key = this.keys.get(payload.keyId);
    if (!key) {
      throw new SecurityViolationError(`Unknown vault key id '${payload.keyId}'`);
    }

    try {
      const iv = Buffer.from(payload.iv, 'base64');
      const authTag = Buffer.from(payload.authTag, 'base64');
      const ciphertext = Buffer.from(payload.ciphertext, 'base64');

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
        'utf8',
      );
      return JSON.parse(decrypted) as Record<string, unknown>;
    } catch {
      throw new SecurityViolationError('Failed to decrypt credential payload (authentication failed)');
    }
  }
}
