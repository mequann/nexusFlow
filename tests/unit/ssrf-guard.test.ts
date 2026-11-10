import { describe, expect, it } from 'vitest';
import { SecurityViolationError } from '../../src/domain/errors.js';
import { assertSafeOutboundUrl, isPrivateOrReservedIp } from '../../src/infrastructure/security/ssrf-guard.js';

describe('SSRF Outbound URL Guard', () => {
  it('blocks loopback, metadata IPs, private RFC1918 CIDRs, and non-HTTP schemes', async () => {
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true);
    expect(isPrivateOrReservedIp('10.20.30.40')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.1.5')).toBe(true);
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('8.8.8.8')).toBe(false);

    await expect(assertSafeOutboundUrl('http://localhost:8080/admin')).rejects.toThrow(
      SecurityViolationError,
    );
    await expect(assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(
      SecurityViolationError,
    );
    await expect(assertSafeOutboundUrl('file:///etc/passwd')).rejects.toThrow(
      SecurityViolationError,
    );
  });

  it('allows public IPv4 HTTPS URLs', async () => {
    const url = await assertSafeOutboundUrl('https://1.1.1.1/dns-query');
    expect(url.hostname).toBe('1.1.1.1');
  });
});

