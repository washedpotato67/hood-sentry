import type { NormalizedPoolState } from '@hood-sentry/chain';
import type { DerivedJobPayload } from '@hood-sentry/queue';
import { describe, expect, it } from 'vitest';
import type { PoolRefreshJobData } from '../jobs/pool-refresh.js';
import { processPoolRefresh } from './pool-refresh.js';

const POOL = '0x1000000000000000000000000000000000000001';
const HASH = `0x${'a'.repeat(64)}`;

function payload(overrides: Partial<DerivedJobPayload> = {}): DerivedJobPayload {
  return {
    type: 'pool-refresh',
    chainId: '4663',
    blockNumber: '100',
    blockHash: HASH,
    data: {
      protocolKey: 'fixture-dex',
      protocolVersion: 'v1',
      poolAddress: POOL,
    },
    ...overrides,
  };
}

describe('pool-refresh processor', () => {
  it('passes validated block provenance to the refresh job', async () => {
    const inputs: PoolRefreshJobData[] = [];
    await processPoolRefresh(payload(), {
      poolRefresh: {
        async run(input): Promise<{ state: NormalizedPoolState; idempotencyKey: string }> {
          inputs.push(input);
          return {
            state: {
              poolType: 'constantProduct',
              reserve0Raw: 1n,
              reserve1Raw: 2n,
              lpTotalSupplyRaw: 3n,
            },
            idempotencyKey: 'fixture',
          };
        },
      },
    });

    expect(inputs).toEqual([
      {
        chainId: 4663,
        protocolKey: 'fixture-dex',
        protocolVersion: 'v1',
        poolAddress: POOL,
        blockNumber: 100n,
        blockHash: HASH,
      },
    ]);
  });

  it('rejects malformed block provenance before starting a refresh', async () => {
    let called = false;
    await expect(
      processPoolRefresh(payload({ blockHash: 'invalid' }), {
        poolRefresh: {
          async run() {
            called = true;
            throw new Error('unexpected');
          },
        },
      }),
    ).rejects.toThrow('block hash');
    expect(called).toBe(false);
  });
});
