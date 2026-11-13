import { createHmac, createHash } from 'node:crypto';

export interface DigitalSealPayload {
  documentId: string;
  tenantId: string;
  referenceNumber: string;
  subject: string;
  signatoryId: string;
  signatoryName: string;
  approvedAtIso: string;
}

export interface DigitalSealResult {
  sealHash: string;
  verificationCode: string;
  verificationUrl: string;
  tamperProofPayload: string;
}

export class DigitalSealEngine {
  private static readonly SEAL_SALT = process.env.SEAL_HMAC_SECRET ?? 'nexusflow-ethiopian-paperless-digital-seal-salt-2026';

  /**
   * Generates a tamper-evident cryptographic SHA-256 seal and a short human-verifiable code.
   */
  public static generateSeal(payload: DigitalSealPayload, baseUrl = 'https://nexusflow.et'): DigitalSealResult {
    const canonicalString = [
      payload.documentId,
      payload.tenantId,
      payload.referenceNumber.trim().toUpperCase(),
      payload.subject.trim(),
      payload.signatoryId,
      payload.signatoryName.trim(),
      payload.approvedAtIso,
    ].join('::');

    const sealHash = createHmac('sha256', this.SEAL_SALT)
      .update(canonicalString, 'utf8')
      .digest('hex');

    // Generate a clean 10-character alphanumeric verification token for easy manual entry/SMS
    const verificationCode = createHash('sha256')
      .update(sealHash)
      .digest('hex')
      .slice(0, 12)
      .toUpperCase();

    const verificationUrl = `${baseUrl.replace(/\/+$/, '')}/verify/${payload.documentId}?code=${verificationCode}`;

    return {
      sealHash,
      verificationCode,
      verificationUrl,
      tamperProofPayload: canonicalString,
    };
  }

  /**
   * Validates whether a document's details match the cryptographic seal.
   */
  public static verifySeal(payload: DigitalSealPayload, expectedSealHash: string): boolean {
    const regenerated = this.generateSeal(payload);
    return regenerated.sealHash === expectedSealHash;
  }
}

