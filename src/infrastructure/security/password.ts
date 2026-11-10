import crypto from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const salt = parts[1];
  const expectedHex = parts[2];
  if (!salt || !expectedHex) return false;

  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export function computeHmacSha256(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const normalizedA = a.replace(/^sha256=/i, '').trim().toLowerCase();
  const normalizedB = b.replace(/^sha256=/i, '').trim().toLowerCase();
  if (normalizedA.length !== normalizedB.length || normalizedA.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(
    Buffer.from(normalizedA, 'utf8'),
    Buffer.from(normalizedB, 'utf8'),
  );
}
