import type { Block, BlockRepository } from '@hood-sentry/db';
import { describe, expect, it } from 'vitest';
import { BaseRiskContextLoader, CanonicalRiskContextLoader } from './pinned-risk-context.js';
import type { RiskScanJobInput } from './risk-scan.js';

const ADDRESS = '0x1000000000000000000000000000000000000001';
const HASH = `0x${'a'.repeat(64)}` as const;
const REPLACEMENT_HASH = `0x${'b'.repeat(64)}` as const;

const input: RiskScanJobInput = {
  target: { type: 'token', chainId: 4663, address: ADDRESS },
  sourceBlock: 100n,
  sourceBlockHash: HASH,
  trigger: 'new_token',
};

function block(hash = HASH): Block {
  const date = new Date('2026-07-15T12:00:00.000Z');
  return {
    chainId: 4663n,
    number: 100n,
    hash,
    parentHash: `0x${'c'.repeat(64)}`,
    timestamp: date,
    finalityState: 'safe',
    canonical: true,
    createdAt: date,
    updatedAt: date,
  };
}

function blockSource(values: readonly (Block | null)[]): Pick<BlockRepository, 'getBlock'> {
  let index = 0;
  return {
    async getBlock() {
      const value = values[Math.min(index, values.length - 1)] ?? null;
      index += 1;
      return value;
    },
  };
}

describe('canonical risk context', () => {
  it('pins context to matching indexed and provider block hashes', async () => {
    const loader = new CanonicalRiskContextLoader(
      new BaseRiskContextLoader(),
      4663,
      blockSource([block(), block()]),
      {
        async getChainId() {
          return 4663;
        },
        async getBlock() {
          return { hash: HASH };
        },
      },
    );

    const context = await loader.loadContext(input, 'risk-partial-1.0.0');
    expect(context.dataSources).toContainEqual(
      expect.objectContaining({ key: 'indexed_canonical_block', status: 'available' }),
    );
  });

  it('rejects a provider connected to another chain', async () => {
    const loader = new CanonicalRiskContextLoader(
      new BaseRiskContextLoader(),
      4663,
      blockSource([block()]),
      {
        async getChainId() {
          return 1;
        },
        async getBlock() {
          return { hash: HASH };
        },
      },
    );

    await expect(loader.loadContext(input, 'risk-partial-1.0.0')).rejects.toThrow(
      'RISK_PROVIDER_CHAIN_ID_MISMATCH',
    );
  });

  it('rejects an orphaned or missing indexed block', async () => {
    const loader = new CanonicalRiskContextLoader(
      new BaseRiskContextLoader(),
      4663,
      blockSource([null]),
      {
        async getChainId() {
          return 4663;
        },
        async getBlock() {
          return { hash: HASH };
        },
      },
    );

    await expect(loader.loadContext(input, 'risk-partial-1.0.0')).rejects.toThrow(
      'RISK_INDEXED_BLOCK_NOT_CANONICAL',
    );
  });

  it('detects a reorg while context sources are loading', async () => {
    const loader = new CanonicalRiskContextLoader(
      new BaseRiskContextLoader(),
      4663,
      blockSource([block(), block(REPLACEMENT_HASH)]),
      {
        async getChainId() {
          return 4663;
        },
        async getBlock() {
          return { hash: HASH };
        },
      },
    );

    await expect(loader.loadContext(input, 'risk-partial-1.0.0')).rejects.toThrow(
      'RISK_INDEXED_BLOCK_HASH_MISMATCH',
    );
  });
});
