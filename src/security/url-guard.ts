import { isIP } from 'net';
import { lookup } from 'dns/promises';

const FORBIDDEN_HOSTNAME_REGEX = /(^|\.)((localhost)|(internal)|(local)|(home\.(arpa|local)))$/i;

function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if ([a, b].some((v) => Number.isNaN(v))) return true;
  if (a < 0 || a > 255 || b < 0 || b > 255) return true;
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::') return true;
  if (normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.replace('::ffff:', '');
    if (isIP(mapped) === 4) {
      return isPrivateIpv4(mapped);
    }
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80')) return true;
  if (normalized.startsWith('ff')) return true;
  return false;
}

function isPrivateIp(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  const ipType = isIP(hostname);
  if (ipType === 4) return isPrivateIpv4(hostname);
  if (ipType === 6) return isPrivateIpv6(hostname);
  return false;
}

function isForbiddenHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return FORBIDDEN_HOSTNAME_REGEX.test(normalized);
}

export function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    if (isPrivateIp(parsed.hostname)) return false;
    if (isForbiddenHostname(parsed.hostname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function isAllowedUrlForFetch(url: string): Promise<boolean> {
  if (!isAllowedUrl(url)) return false;

  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const ipType = isIP(host);
    if (ipType === 4 || ipType === 6) {
      return !isPrivateIp(host);
    }

    const records = await lookup(host, { all: true, verbatim: true });
    if (!records || records.length === 0) return false;
    for (const record of records) {
      if (isPrivateIp(record.address)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}
