import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import { z } from 'zod';

const responseLimit = 4_096;

export type HttpsDeliveryResponse = {
  status: number;
  body: string;
};

export class HttpsDeliveryError extends Error {
  constructor(
    readonly code: 'DESTINATION_INVALID' | 'DESTINATION_PRIVATE' | 'DELIVERY_HTTP' | 'DELIVERY_IO',
    message: string,
    readonly status: number | null = null,
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = 'HttpsDeliveryError';
  }
}

function ipv4Number(address: string): number | null {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }
  return (
    (((parts[0] ?? 0) << 24) >>> 0) +
    ((parts[1] ?? 0) << 16) +
    ((parts[2] ?? 0) << 8) +
    (parts[3] ?? 0)
  );
}

function inIpv4Range(value: number, base: number, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    if (value === null) return false;
    const blocked: readonly [string, number][] = [
      ['0.0.0.0', 8],
      ['10.0.0.0', 8],
      ['100.64.0.0', 10],
      ['127.0.0.0', 8],
      ['169.254.0.0', 16],
      ['172.16.0.0', 12],
      ['192.0.0.0', 24],
      ['192.0.2.0', 24],
      ['192.168.0.0', 16],
      ['198.18.0.0', 15],
      ['198.51.100.0', 24],
      ['203.0.113.0', 24],
      ['224.0.0.0', 4],
      ['240.0.0.0', 4],
    ];
    return !blocked.some(([base, prefix]) => {
      const numericBase = ipv4Number(base);
      return numericBase !== null && inIpv4Range(value, numericBase, prefix);
    });
  }
  if (family !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    return isPublicAddress(normalized.slice('::ffff:'.length));
  }
  return !(
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8:')
  );
}

type Resolver = (hostname: string) => Promise<readonly { address: string; family: number }[]>;

export class PinnedHttpsClient {
  constructor(
    private readonly timeoutMs = 10_000,
    private readonly resolve: Resolver = (hostname) => lookup(hostname, { all: true }),
  ) {}

  async post(
    rawUrl: string,
    headers: Readonly<Record<string, string>>,
    body: string | Buffer,
  ): Promise<HttpsDeliveryResponse> {
    const url = this.parseUrl(rawUrl);
    const addresses = await this.resolve(url.hostname);
    if (addresses.length === 0 || addresses.some((entry) => !isPublicAddress(entry.address))) {
      throw new HttpsDeliveryError(
        'DESTINATION_PRIVATE',
        'Delivery destination did not resolve to public addresses',
      );
    }
    const selected = addresses[0];
    if (selected === undefined) {
      throw new HttpsDeliveryError('DESTINATION_INVALID', 'Delivery destination has no address');
    }
    const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address: selected.address, family: selected.family }]);
      } else {
        callback(null, selected.address, selected.family);
      }
    };

    return await new Promise<HttpsDeliveryResponse>((resolve, reject) => {
      const outgoing = request(
        url,
        {
          method: 'POST',
          headers: { ...headers, 'content-length': Buffer.byteLength(body).toString() },
          lookup: pinnedLookup,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on('data', (chunk: unknown) => {
            const buffer =
              typeof chunk === 'string'
                ? Buffer.from(chunk)
                : chunk instanceof Uint8Array
                  ? Buffer.from(chunk)
                  : Buffer.alloc(0);
            if (bytes >= responseLimit) return;
            const remaining = responseLimit - bytes;
            chunks.push(buffer.subarray(0, remaining));
            bytes += Math.min(buffer.byteLength, remaining);
          });
          response.on('end', () => {
            const status = response.statusCode ?? 0;
            const responseBody = Buffer.concat(chunks).toString('utf8');
            if (status < 200 || status >= 300) {
              reject(
                new HttpsDeliveryError(
                  'DELIVERY_HTTP',
                  `Delivery endpoint returned HTTP ${status.toString()}`,
                  status,
                  status === 408 || status === 429 || status >= 500,
                ),
              );
              return;
            }
            resolve({ status, body: responseBody });
          });
        },
      );
      outgoing.setTimeout(this.timeoutMs, () => {
        outgoing.destroy(
          new HttpsDeliveryError('DELIVERY_IO', 'Delivery request timed out', null, true),
        );
      });
      outgoing.on('error', (error) => {
        reject(
          error instanceof HttpsDeliveryError
            ? error
            : new HttpsDeliveryError('DELIVERY_IO', 'Delivery request failed', null, true),
        );
      });
      outgoing.end(body);
    });
  }

  private parseUrl(rawUrl: string): URL {
    const parsed = z.string().url().safeParse(rawUrl);
    if (!parsed.success) {
      throw new HttpsDeliveryError('DESTINATION_INVALID', 'Delivery destination is invalid');
    }
    const url = new URL(parsed.data);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) {
      throw new HttpsDeliveryError(
        'DESTINATION_INVALID',
        'Delivery destination must use standard HTTPS',
      );
    }
    return url;
  }
}
