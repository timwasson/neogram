import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';
import { config } from '../config';

/**
 * SSRF-safe outbound GET for user-controlled URLs (station feeds, remote JSON on static hosts).
 *
 *  - http(s) only (http only outside production), no embedded credentials
 *  - every resolved address (initial request AND each redirect hop) is checked inside the socket
 *    `lookup` hook, so DNS-rebinding cannot swap in a private IP after validation
 *  - loopback / private / link-local / CGNAT / ULA / multicast / metadata ranges are rejected
 *  - redirects are followed manually (max 3) and re-validated
 *  - hard timeout + response size cap
 */

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

// IPv6 ranges that are non-public or that embed/translate an IPv4 address (which could be private):
// IPv4-compatible ::/96, NAT64 64:ff9b::/96 + 64:ff9b:1::/48, discard 100::/64, Teredo 2001::/32,
// documentation 2001:db8::/32, 6to4 2002::/16, deprecated site-local fec0::/10.
const BLOCKED_V6 = new net.BlockList();
for (const [prefix, bits] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fec0::', 10],
] as const) {
  BLOCKED_V6.addSubnet(prefix, bits, 'ipv6');
}

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local + cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast + reserved
    );
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.slice(7);
      return net.isIPv4(mapped) ? isPrivateAddress(mapped) : true;
    }
    if (BLOCKED_V6.check(lower, 'ipv6')) return true;
    return (
      lower.startsWith('fc') ||
      lower.startsWith('fd') || // ULA
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb') || // link-local
      lower.startsWith('ff') // multicast
    );
  }
  return true; // not an IP: fail closed
}

/** Lexical URL validation (also used when SAVING a site URL so bad values are rejected early). */
export function validatePublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfBlockedError('Invalid URL');
  }
  const allowHttp = config.env !== 'production';
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new SsrfBlockedError('Only https:// URLs are allowed');
  }
  if (url.username || url.password) throw new SsrfBlockedError('Credentials in URL are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) throw new SsrfBlockedError('Missing host');
  const isProd = config.env === 'production';
  const isLoopbackLiteral = host === '127.0.0.1' || host === '::1';
  if (isProd && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan'))) {
    throw new SsrfBlockedError('Internal hostnames are not allowed');
  }
  // Private/link-local literals are always rejected; loopback literals are tolerated ONLY outside
  // production so local mock hosts and QA fixtures keep working.
  if (net.isIP(host) && isPrivateAddress(host) && !(!isProd && isLoopbackLiteral)) {
    throw new SsrfBlockedError('Private addresses are not allowed');
  }
  return url;
}

const SAFE_HOSTNAME = /^[a-z0-9.-]+$/;

/**
 * Canonical form of a user-supplied site URL, safe to store and to splice into HTML attributes:
 * validated public http(s) URL, plain ASCII hostname, percent-encoded path (including `'`),
 * no query/fragment, no trailing slash. Throws SsrfBlockedError otherwise.
 */
export function normalizePublicSiteUrl(raw: string): string {
  const url = validatePublicUrl(String(raw || '').trim());
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!SAFE_HOSTNAME.test(host) && !net.isIP(host)) {
    throw new SsrfBlockedError('Invalid characters in hostname');
  }
  const pathname = url.pathname.replace(/'/g, '%27').replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${pathname}`;
}

/**
 * Canonical https URL for browser-loaded resources (custom stylesheet, avatar): https only,
 * ASCII hostname, `'` percent-encoded. Returns null when the input is not acceptable.
 */
export function normalizeHttpsResourceUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 500) return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'https:' && !(config.env !== 'production' && url.protocol === 'http:')) return null;
    if (url.username || url.password) return null;
    if (!SAFE_HOSTNAME.test(url.hostname.replace(/^\[|\]$/g, '')) && !net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) return null;
    return url.href.replace(/'/g, '%27');
  } catch {
    return null;
  }
}

/** Same as validatePublicUrl but returns a boolean (for input validation). */
export function isSafePublicUrl(raw: string): boolean {
  try {
    validatePublicUrl(raw);
    return true;
  } catch {
    return false;
  }
}

function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: any, family?: number) => void
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '' as any, 4);
    const list = (addresses as dns.LookupAddress[]) || [];
    // In non-production dev/QA, loopback is permitted so local mock hosts keep working.
    const blocked = list.some((a) => isPrivateAddress(a.address) && !(config.env !== 'production' && (a.address === '127.0.0.1' || a.address === '::1')));
    if (!list.length || blocked) {
      return callback(new SsrfBlockedError(`Blocked address for host ${hostname}`) as any, '' as any, 4);
    }
    if (options.all) return callback(null, list as any);
    callback(null, list[0].address, list[0].family);
  });
}

export interface SafeResponse {
  status: number;
  ok: boolean;
  headers: http.IncomingHttpHeaders;
  text(): string;
  json<T = any>(): T;
}

export interface SafeGetOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

export async function safeGet(rawUrl: string, opts: SafeGetOptions = {}): Promise<SafeResponse> {
  const timeoutMs = opts.timeoutMs ?? 4000;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 3;

  let current = validatePublicUrl(rawUrl);
  const originalOrigin = current.origin;
  // Hard wall-clock budget for the whole exchange (all hops). `timeout` below is only an idle-socket
  // timeout, so a server dripping one byte every few seconds could otherwise hold the request open.
  const deadline = Date.now() + timeoutMs * (maxRedirects + 1);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const result = await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return reject(new SsrfBlockedError('Request timed out'));
      const lib = current.protocol === 'https:' ? https : http;
      const req = lib.request(
        current,
        {
          method: 'GET',
          // Caller headers are only sent to the origin that was originally requested, never to a redirect target
          headers: { 'User-Agent': 'NeogramFeedFetcher/1.0', Accept: 'application/json', ...(current.origin === originalOrigin ? opts.headers || {} : {}) },
          lookup: guardedLookup as any,
          timeout: timeoutMs,
        },
        (res) => {
          const declared = parseInt(String(res.headers['content-length'] || '0'), 10);
          if (declared > maxBytes) {
            res.destroy();
            return reject(new SsrfBlockedError('Response too large'));
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > maxBytes) {
              res.destroy();
              reject(new SsrfBlockedError('Response too large'));
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) }));
          res.on('error', reject);
        }
      );
      req.on('timeout', () => req.destroy(new Error('Request timed out')));
      const wallClock = setTimeout(() => req.destroy(new SsrfBlockedError('Request timed out')), remaining);
      req.on('close', () => clearTimeout(wallClock));
      req.on('error', reject);
      req.end();
    });

    if ([301, 302, 303, 307, 308].includes(result.status) && result.headers.location) {
      if (hop === maxRedirects) throw new SsrfBlockedError('Too many redirects');
      current = validatePublicUrl(new URL(String(result.headers.location), current).toString());
      continue;
    }

    const bodyText = result.body.toString('utf8');
    return {
      status: result.status,
      ok: result.status >= 200 && result.status < 300,
      headers: result.headers,
      text: () => bodyText,
      json: <T = any>() => JSON.parse(bodyText) as T,
    };
  }
  throw new SsrfBlockedError('Too many redirects');
}
