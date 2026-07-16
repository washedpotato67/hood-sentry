import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export type ApiKey = {
  id: string;
  prefix: string;
  hash: string;
  scopes: readonly string[];
  quota: number;
  revoked: boolean;
};
export function createApiKey(scopes: readonly string[], quota: number) {
  const secret = randomBytes(24).toString('hex');
  return {
    secret,
    key: {
      id: `key_${randomBytes(6).toString('hex')}`,
      prefix: secret.slice(0, 8),
      hash: createHash('sha256').update(secret).digest('hex'),
      scopes,
      quota,
      revoked: false,
    } as ApiKey,
  };
}
export function verifyApiKey(secret: string, key: ApiKey) {
  if (key.revoked) return false;
  const received = Buffer.from(createHash('sha256').update(secret).digest('hex'), 'hex');
  const expected = Buffer.from(key.hash, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export const API_KEY_SCOPES = [
  'tokens:read',
  'risk:read',
  'wallets:read',
  'alerts:write',
  'webhooks:write',
  'projects:write',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const tokenPattern = /^hs_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/;

export function hashApiKeyToken(token: string, signingSecret: string): string {
  return createHmac('sha256', signingSecret).update(`hood-sentry-api-key:${token}`).digest('hex');
}

export function issueApiKeyToken(signingSecret: string): {
  token: string;
  prefix: string;
  hash: string;
} {
  const prefix = randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  const token = `hs_${prefix}_${secret}`;
  return { token, prefix, hash: hashApiKeyToken(token, signingSecret) };
}

export function apiKeyPrefix(token: string): string | null {
  return tokenPattern.exec(token)?.[1] ?? null;
}

export function verifyApiKeyToken(
  token: string,
  expectedHash: string,
  signingSecret: string,
): boolean {
  if (apiKeyPrefix(token) === null || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const received = Buffer.from(hashApiKeyToken(token, signingSecret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
