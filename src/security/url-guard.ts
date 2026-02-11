import { isIP } from 'net';

function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if ([a, b].some((v) => Number.isNaN(v))) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80')) return true;
  return false;
}

function isPrivateIp(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  const ipType = isIP(hostname);
  if (ipType === 4) return isPrivateIpv4(hostname);
  if (ipType === 6) return isPrivateIpv6(hostname);
  return false;
}

export function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (isPrivateIp(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}
