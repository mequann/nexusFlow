export interface EncryptedPayload {
  keyId: string;
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface ICredentialVault {
  encrypt(plaintext: Record<string, unknown>): EncryptedPayload;
  decrypt(payload: EncryptedPayload): Record<string, unknown>;
}
