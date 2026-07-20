import { describe, expect, it } from 'vitest';
import { jobIdFromKey } from '../job-id.js';
import { serializeBigints, toPayload } from '../serialization.js';
import {
  derivedJobIdempotencyKey,
  isTokenScopedJobType,
  tokenScopedIdempotencyKey,
} from '../types.js';

describe('jobIdFromKey', () => {
  it('produces a deterministic, colon-free BullMQ job id from a colon-delimited key', () => {
    const key = '4663:0xabc:0xtx:2:log';
    const id = jobIdFromKey(key);
    expect(id).not.toContain(':');
    expect(id).toBe(jobIdFromKey(key));
    expect(jobIdFromKey('4663:0xabc:0xtx:3:log')).not.toBe(id);
  });
});

describe('serializeBigints', () => {
  it('converts nested bigints to decimal strings', () => {
    const result = serializeBigints({
      a: 1n,
      b: [2n, { c: 3n }],
      d: 'x',
      e: 4,
      f: null,
    });
    expect(result).toEqual({ a: '1', b: ['2', { c: '3' }], d: 'x', e: 4, f: null });
  });
});

describe('toPayload', () => {
  it('renders bigint chain fields as strings and preserves data', () => {
    const payload = toPayload({
      type: 'token-transfer',
      chainId: 4663n,
      blockNumber: 100n,
      blockHash: '0xabc',
      data: { transactionHash: '0xtx', amountRaw: 1000n },
    });
    expect(payload).toEqual({
      type: 'token-transfer',
      chainId: '4663',
      blockNumber: '100',
      blockHash: '0xabc',
      data: { transactionHash: '0xtx', amountRaw: '1000' },
    });
  });
});

describe('tokenScopedIdempotencyKey', () => {
  it('is the same key wherever the token is seen, so one job covers every sighting', () => {
    const inBlockOne = tokenScopedIdempotencyKey({
      type: 'token-metadata',
      chainId: 4663n,
      tokenAddress: '0xAbC0000000000000000000000000000000000001',
    });
    const inBlockTwoThousand = tokenScopedIdempotencyKey({
      type: 'token-metadata',
      chainId: 4663n,
      tokenAddress: '0xabc0000000000000000000000000000000000001',
    });

    expect(inBlockOne).toBe(inBlockTwoThousand);
    expect(inBlockOne).toBe('4663:token-metadata:0xabc0000000000000000000000000000000000001');
  });

  it('keeps different job types for the same token apart', () => {
    const token = { chainId: 4663n, tokenAddress: '0xabc0000000000000000000000000000000000001' };

    expect(tokenScopedIdempotencyKey({ ...token, type: 'token-metadata' })).not.toBe(
      tokenScopedIdempotencyKey({ ...token, type: 'discovery-refresh' }),
    );
  });

  it('scopes only the job types whose work is about a token, not a block', () => {
    expect(isTokenScopedJobType('token-metadata')).toBe(true);
    expect(isTokenScopedJobType('discovery-refresh')).toBe(true);
    expect(isTokenScopedJobType('token-transfer')).toBe(false);
  });
});

describe('derivedJobIdempotencyKey', () => {
  it('is deterministic and collapses identical chain positions', () => {
    const base = {
      type: 'token-transfer' as const,
      chainId: 4663n,
      blockHash: '0xabc',
      transactionHash: '0xtx',
      logIndex: 2,
    };
    expect(derivedJobIdempotencyKey(base)).toBe('4663:0xabc:0xtx:2:token-transfer');
    expect(derivedJobIdempotencyKey(base)).toBe(derivedJobIdempotencyKey({ ...base }));
  });

  it('distinguishes job types at the same position', () => {
    const position = { chainId: 1n, blockHash: '0xh', transactionHash: '0xt', logIndex: 0 };
    expect(derivedJobIdempotencyKey({ ...position, type: 'token-transfer' })).not.toBe(
      derivedJobIdempotencyKey({ ...position, type: 'token-approval' }),
    );
  });
});
