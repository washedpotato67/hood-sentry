import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  REDACTED_PII,
  hashIdentifier,
  redactSecrets,
  sanitizeProviderUrl,
  truncateAddress,
} from '../redact.js';

describe('redactSecrets', () => {
  it('returns null for null input', () => {
    expect(redactSecrets(null)).toBeNull();
  });

  it('returns undefined for undefined input', () => {
    expect(redactSecrets(undefined)).toBeUndefined();
  });

  it('returns primitives unchanged', () => {
    expect(redactSecrets('hello')).toBe('hello');
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(true)).toBe(true);
    expect(redactSecrets(100n)).toBe(100n);
  });

  describe('secret key redaction', () => {
    it('redacts password fields', () => {
      const result = redactSecrets({ password: 'secret123', username: 'user' }) as Record<
        string,
        unknown
      >;
      expect(result.password).toBe(REDACTED);
      expect(result.username).toBe('user');
    });

    it('redacts secret fields', () => {
      const result = redactSecrets({ sessionSecret: 'abc', name: 'test' }) as Record<
        string,
        unknown
      >;
      expect(result.sessionSecret).toBe(REDACTED);
      expect(result.name).toBe('test');
    });

    it('redacts token fields', () => {
      const result = redactSecrets({ accessToken: 'tok_123', userId: 'u1' }) as Record<
        string,
        unknown
      >;
      expect(result.accessToken).toBe(REDACTED);
      expect(result.userId).toBe('u1');
    });

    it('redacts apiKey fields', () => {
      const result = redactSecrets({
        apiKey: 'key_abc',
        endpoint: 'https://api.example.com',
      }) as Record<string, unknown>;
      expect(result.apiKey).toBe(REDACTED);
      expect(result.endpoint).toBe('https://api.example.com');
    });

    it('redacts privateKey fields', () => {
      const result = redactSecrets({ privateKey: '0xdeadbeef', address: '0x1234' }) as Record<
        string,
        unknown
      >;
      expect(result.privateKey).toBe(REDACTED);
      expect(result.address).toBe('0x1234');
    });

    it('redacts authorization fields', () => {
      const result = redactSecrets({ authorization: 'Bearer xyz', method: 'GET' }) as Record<
        string,
        unknown
      >;
      expect(result.authorization).toBe(REDACTED);
      expect(result.method).toBe('GET');
    });

    it('redacts cookie fields', () => {
      const result = redactSecrets({ cookie: 'session=abc', path: '/' }) as Record<string, unknown>;
      expect(result.cookie).toBe(REDACTED);
      expect(result.path).toBe('/');
    });

    it('redacts mnemonic and seed phrase fields', () => {
      const result = redactSecrets({ mnemonic: 'word1 word2', seedPhrase: 'phrase' }) as Record<
        string,
        unknown
      >;
      expect(result.mnemonic).toBe(REDACTED);
      expect(result.seedPhrase).toBe(REDACTED);
    });

    it('redacts signing key fields', () => {
      const result = redactSecrets({ signingKey: 'key123', name: 'test' }) as Record<
        string,
        unknown
      >;
      expect(result.signingKey).toBe(REDACTED);
    });

    it('redacts webhook secret fields', () => {
      const result = redactSecrets({
        webhookSecret: 'secret',
        url: 'https://hook.example.com',
      }) as Record<string, unknown>;
      expect(result.webhookSecret).toBe(REDACTED);
      expect(result.url).toBe('https://hook.example.com');
    });

    it('redacts bearer token fields', () => {
      const result = redactSecrets({ bearer: 'token123', name: 'test' }) as Record<string, unknown>;
      expect(result.bearer).toBe(REDACTED);
    });

    it('handles case-insensitive patterns', () => {
      const result = redactSecrets({ PASSWORD: 'secret', ApiKey: 'key', TOKEN: 'tok' }) as Record<
        string,
        unknown
      >;
      expect(result.PASSWORD).toBe(REDACTED);
      expect(result.ApiKey).toBe(REDACTED);
      expect(result.TOKEN).toBe(REDACTED);
    });
  });

  describe('PII redaction', () => {
    it('redacts email fields', () => {
      const result = redactSecrets({ email: 'user@example.com', name: 'test' }) as Record<
        string,
        unknown
      >;
      expect(result.email).toBe(REDACTED_PII);
      expect(result.name).toBe('test');
    });

    it('redacts phone fields', () => {
      const result = redactSecrets({ phone: '+1234567890', name: 'test' }) as Record<
        string,
        unknown
      >;
      expect(result.phone).toBe(REDACTED_PII);
    });

    it('redacts SSN fields', () => {
      const result = redactSecrets({ ssn: '123-45-6789', name: 'test' }) as Record<string, unknown>;
      expect(result.ssn).toBe(REDACTED_PII);
    });

    it('redacts IP address fields', () => {
      const result = redactSecrets({ ipAddress: '192.168.1.1', name: 'test' }) as Record<
        string,
        unknown
      >;
      expect(result.ipAddress).toBe(REDACTED_PII);
    });
  });

  describe('signature redaction', () => {
    it('truncates signature values in non-secret fields', () => {
      const sig = `0x${'a'.repeat(130)}`;
      const result = redactSecrets({ signature: sig, name: 'test' }) as Record<string, unknown>;
      expect(result.signature).toContain('…');
      expect(result.signature).toContain('[sig]');
      expect(result.signature).not.toBe(sig);
    });

    it('truncates long hex values in message fields', () => {
      const sig = `0x${'a'.repeat(130)}`;
      const result = redactSecrets({ message: sig, name: 'test' }) as Record<string, unknown>;
      expect(result.message).toContain('…');
      expect(result.message).toContain('[sig]');
    });
  });

  describe('session cookie redaction', () => {
    it('redacts session cookie strings', () => {
      const result = redactSecrets({
        headers: 'connect.sid=s%3Aabc123; Path=/',
      }) as Record<string, unknown>;
      expect(result.headers).toBe(REDACTED);
    });

    it('redacts session_id cookie strings', () => {
      const result = redactSecrets({
        data: 'session_id=abc123; Path=/',
      }) as Record<string, unknown>;
      expect(result.data).toBe(REDACTED);
    });
  });

  describe('provider URL redaction', () => {
    it('redacts API keys in provider URLs', () => {
      const result = redactSecrets({
        rpcUrl: 'https://eth-mainnet.alchemyapi.io/v2/key=abc123secret',
      }) as Record<string, unknown>;
      expect(result.rpcUrl).toContain('[REDACTED]');
      expect(result.rpcUrl).not.toContain('abc123secret');
    });

    it('redacts token parameters in URLs', () => {
      const result = redactSecrets({
        url: 'https://api.example.com?token=secret123&other=value',
      }) as Record<string, unknown>;
      expect(result.url).toContain('[REDACTED]');
      expect(result.url).not.toContain('secret123');
    });
  });

  describe('nested object redaction', () => {
    it('redacts nested objects', () => {
      const input = {
        config: {
          database: {
            password: 'db_pass',
            host: 'localhost',
          },
        },
      };
      const result = redactSecrets(input) as {
        config: { database: { password: string; host: string } };
      };
      expect(result.config.database.password).toBe(REDACTED);
      expect(result.config.database.host).toBe('localhost');
    });

    it('redacts arrays of objects', () => {
      const input = [{ token: 'tok1' }, { token: 'tok2', name: 'test' }];
      const result = redactSecrets(input) as Array<Record<string, unknown>>;
      expect(result[0]?.token).toBe(REDACTED);
      expect(result[1]?.token).toBe(REDACTED);
      expect(result[1]?.name).toBe('test');
    });

    it('redacts deeply nested secrets', () => {
      const input = {
        level1: {
          level2: {
            level3: {
              apiKey: 'secret',
              name: 'test',
            },
          },
        },
      };
      const result = redactSecrets(input) as {
        level1: { level2: { level3: { apiKey: string; name: string } } };
      };
      expect(result.level1.level2.level3.apiKey).toBe(REDACTED);
      expect(result.level1.level2.level3.name).toBe('test');
    });
  });
});

describe('hashIdentifier', () => {
  it('produces consistent hashes', () => {
    const hash1 = hashIdentifier('user@example.com');
    const hash2 = hashIdentifier('user@example.com');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different inputs', () => {
    const hash1 = hashIdentifier('user1@example.com');
    const hash2 = hashIdentifier('user2@example.com');
    expect(hash1).not.toBe(hash2);
  });

  it('returns hex-prefixed string', () => {
    const hash = hashIdentifier('test');
    expect(hash).toMatch(/^0x[a-f0-9]{8}$/);
  });
});

describe('truncateAddress', () => {
  it('truncates long addresses', () => {
    const address = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
    const result = truncateAddress(address);
    expect(result).toBe('0x0Bd7…AD73');
  });

  it('returns short strings unchanged', () => {
    expect(truncateAddress('0x1234')).toBe('0x1234');
  });
});

describe('sanitizeProviderUrl', () => {
  it('redacts API keys in URLs', () => {
    const url = 'https://eth-mainnet.alchemyapi.io/v2/key=abc123secret';
    const result = sanitizeProviderUrl(url);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('abc123secret');
  });

  it('redacts token parameters', () => {
    const url = 'https://api.example.com?token=secret123&other=value';
    const result = sanitizeProviderUrl(url);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('secret123');
    expect(result).toContain('other=value');
  });

  it('leaves clean URLs unchanged', () => {
    const url = 'https://rpc.mainnet.chain.robinhood.com';
    expect(sanitizeProviderUrl(url)).toBe(url);
  });
});
