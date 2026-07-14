import { createHash, randomBytes } from 'node:crypto';
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
  return !key.revoked && createHash('sha256').update(secret).digest('hex') === key.hash;
}
