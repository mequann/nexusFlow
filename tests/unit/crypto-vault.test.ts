import { describe, expect, it } from 'vitest';
import { SecurityViolationError } from '../../src/domain/errors.js';
import { AesGcmCredentialVault } from '../../src/infrastructure/security/crypto-vault.js';

const KEY_V1 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const KEY_V2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

describe('AES-256-GCM Credential Vault', () => {
  it('encrypts and decrypts secrets roundtrip', () => {
    const vault = new AesGcmCredentialVault('v1', { v1: KEY_V1 });
    const encrypted = vault.encrypt({ apiKey: 'super-secret-123', tenant: 'acme' });

    expect(encrypted.keyId).toBe('v1');
    expect(encrypted.ciphertext).not.toContain('super-secret-123');
    expect(vault.decrypt(encrypted)).toEqual({ apiKey: 'super-secret-123', tenant: 'acme' });
  });

  it('supports key rotation (decrypts v1 payloads when v2 is active)', () => {
    const vaultV1 = new AesGcmCredentialVault('v1', { v1: KEY_V1 });
    const legacy = vaultV1.encrypt({ token: 'legacy-token' });

    const vaultV2 = new AesGcmCredentialVault('v2', { v1: KEY_V1, v2: KEY_V2 });
    const fresh = vaultV2.encrypt({ token: 'fresh-token' });

    expect(fresh.keyId).toBe('v2');
    expect(vaultV2.decrypt(legacy)).toEqual({ token: 'legacy-token' });
    expect(vaultV2.decrypt(fresh)).toEqual({ token: 'fresh-token' });
  });

  it('rejects tampered ciphertext via GCM auth tag', () => {
    const vault = new AesGcmCredentialVault('v1', { v1: KEY_V1 });
    const encrypted = vault.encrypt({ token: 'secret' });
    const tampered = { ...encrypted, ciphertext: Buffer.from('tampered').toString('base64') };

    expect(() => vault.decrypt(tampered)).toThrow(SecurityViolationError);
  });
});

