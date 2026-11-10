import dns from 'node:dns/promises';
import net from 'node:net';
import { SecurityViolationError, ValidationError } from '../../domain/errors.js';

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  return (
    (((parts[0] ?? 0) << 24) |
      ((parts[1] ?? 0) << 16) |
      ((parts[2] ?? 0) << 8) |
      (parts[3] ?? 0)) >>>
    0
  );
}

function inCidr4(ip: string, network: string, maskBits: number): boolean {
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(network) & mask);
}

export function isPrivateOrReservedIp(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();
  if (normalized.startsWith('::ffff:')) {
    return isPrivateOrReservedIp(normalized.slice(7));
  }

  if (net.isIPv4(normalized)) {
    return (
      inCidr4(normalized, '0.0.0.0', 8) ||
      inCidr4(normalized, '10.0.0.0', 8) ||
      inCidr4(normalized, '100.64.0.0', 10) ||
      inCidr4(normalized, '127.0.0.0', 8) ||
      inCidr4(normalized, '169.254.0.0', 16) ||
      inCidr4(normalized, '172.16.0.0', 12) ||
      inCidr4(normalized, '192.0.0.0', 24) ||
      inCidr4(normalized, '192.168.0.0', 16) ||
      inCidr4(normalized, '198.18.0.0', 15) ||
      inCidr4(normalized, '224.0.0.0', 4) ||
      inCidr4(normalized, '240.0.0.0', 4)
    );
  }

  if (net.isIPv6(normalized)) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('ff')
    );
  }

  return true;
}

export async function assertSafeOutboundUrl(
  rawUrl: string,
  allowPrivateNetwork = false,
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ValidationError(`Invalid outbound URL '${rawUrl}'`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SecurityViolationError(
      `Unsupported protocol '${parsed.protocol}'; only http and https are allowed`,
    );
  }

  if (allowPrivateNetwork) {
    return parsed;
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new SecurityViolationError(`SSRF blocked: forbidden internal hostname '${hostname}'`);
  }

  if (net.isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new SecurityViolationError(`SSRF blocked: private/reserved IP '${hostname}'`);
    }
    return parsed;
  }

  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new ValidationError(`Unable to resolve outbound host '${hostname}'`);
  }

  if (addresses.length === 0) {
    throw new ValidationError(`No DNS records found for outbound host '${hostname}'`);
  }

  for (const addr of addresses) {
    if (isPrivateOrReservedIp(addr.address)) {
      throw new SecurityViolationError(
        `SSRF blocked: host '${hostname}' resolved to private/reserved IP '${addr.address}'`,
      );
    }
  }

  return parsed;
}

