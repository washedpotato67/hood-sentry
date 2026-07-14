import { describe, expect, it } from 'vitest';
import { createApiKey, verifyApiKey } from '../api-customer.js';
import { validateSiwe } from '../siwe.js';
describe('auth: SIWE and API keys', () => {
  it('consumes a valid SIWE nonce and rejects replay', () => {
    const nonce = { nonce: 'abc', expiresAt: Date.now() + 10000, consumed: false };
    const m = {
      domain: 'app.test',
      address: '0x1111111111111111111111111111111111111111' as const,
      uri: 'https://app.test/login',
      chainId: 1,
      nonce: 'abc',
      issuedAt: new Date(Date.now() - 1000).toISOString(),
    };
    validateSiwe(
      m,
      { domain: 'app.test', uri: m.uri, chainId: 1, now: Math.floor(Date.now() / 1000) },
      nonce,
      true,
    );
    expect(() =>
      validateSiwe(
        m,
        { domain: 'app.test', uri: m.uri, chainId: 1, now: Math.floor(Date.now() / 1000) },
        nonce,
        true,
      ),
    ).toThrow();
    expect(() =>
      validateSiwe(
        { ...m, nonce: 'different' },
        { domain: 'app.test', uri: m.uri, chainId: 1, now: Math.floor(Date.now() / 1000) },
        { nonce: 'abc', expiresAt: Date.now() + 10_000, consumed: false },
        true,
      ),
    ).toThrow();
  });
  it('hashes API secrets and verifies them', () => {
    const k = createApiKey(['tokens:read'], 10);
    expect(verifyApiKey(k.secret, k.key)).toBe(true);
  });
});
