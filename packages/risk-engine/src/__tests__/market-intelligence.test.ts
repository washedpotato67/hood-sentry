import { describe, expect, it } from 'vitest';
import { analyzeLiquidityRisk } from '../liquidity-risk.js';
import { buildRelationshipGraph } from '../relationships.js';
const hash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const edge = (from: `0x${string}`, to: `0x${string}`) => ({
  from,
  to,
  kind: 'CREATED' as const,
  chainId: 1,
  blockNumber: 1n,
  blockHash: hash,
  transactionHash: hash,
  confidence: 'high' as const,
  provenance: 'chain',
  evidence: 'creation transaction',
  canonical: true,
});
describe('market intelligence', () => {
  it('keeps unsupported liquidity unknown and exposes ownership evidence', () => {
    const result = analyzeLiquidityRisk({
      chainId: 1,
      poolAddress: '0x1111111111111111111111111111111111111111',
      protocolKey: 'unknown',
      poolType: 'unknown',
      quoteAsset: '0x2222222222222222222222222222222222222222',
      verifiedProtocol: false,
      sourceBlock: 1n,
      sourceBlockHash: hash,
      poolAgeBlocks: 1n,
      tokenLiquidityRaw: 1n,
      quoteLiquidityRaw: 1n,
      currentLiquidityRaw: 1n,
      priceImpactBps: 5000n,
      providers: [{ address: '0x3333333333333333333333333333333333333333', liquidityRaw: 1n }],
      ownership: { kind: 'unknown', verified: false },
      removalsRaw: 0n,
      additionsRaw: 1n,
    });
    expect(result.status).toBe('unknown');
    expect(result.findings).toContain('UNKNOWN_PROTOCOL');
  });
  it('bounds relationship traversal and preserves chain provenance', () => {
    const graph = buildRelationshipGraph(
      [
        edge(
          '0x1111111111111111111111111111111111111111',
          '0x2222222222222222222222222222222222222222',
        ),
        edge(
          '0x2222222222222222222222222222222222222222',
          '0x3333333333333333333333333333333333333333',
        ),
      ],
      ['0x1111111111111111111111111111111111111111'],
      1,
      1,
    );
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]?.provenance).toBe('chain');
  });
});
