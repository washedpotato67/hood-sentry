import type { ProxyAnalysisClient, RiskScanContext } from '@hood-sentry/risk-engine';
import { type Address, type Hash, type Hex, getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { ContractAnalysisContextLoader } from './contract-analysis-context.js';
import type { RiskContextLoader, RiskScanJobInput } from './risk-scan.js';

const ADDRESS = getAddress('0x1000000000000000000000000000000000000001');
const BLOCK_HASH = `0x${'33'.repeat(32)}` as Hash;

class ChainFixture implements ProxyAnalysisClient {
  async getCode(address: Address): Promise<Hex> {
    return Promise.resolve(address === ADDRESS ? '0x6001600055' : '0x');
  }

  async getStorageAt(): Promise<Hex> {
    return Promise.resolve('0x');
  }

  async call(): Promise<Hex> {
    throw new Error('call unavailable');
  }

  async getLogs(): Promise<[]> {
    return Promise.resolve([]);
  }
}

class BaseLoader implements RiskContextLoader {
  async loadContext(input: RiskScanJobInput, methodologyVersion: string): Promise<RiskScanContext> {
    return Promise.resolve({
      target: input.target,
      sourceBlock: input.sourceBlock,
      sourceBlockHash: input.sourceBlockHash,
      methodologyVersion,
      data: {},
      dataSources: [],
    });
  }
}

describe('contract analysis risk context', () => {
  it('stays operational when Blockscout is unavailable', async () => {
    const loader = new ContractAnalysisContextLoader(new BaseLoader(), new ChainFixture(), {
      enrichContract: async () => ({
        status: 'unavailable',
        metadata: null,
        warnings: [
          {
            code: 'PROVIDER_UNAVAILABLE',
            message: 'fixture outage',
            provider: 'blockscout',
          },
        ],
        cacheStatus: 'miss',
      }),
    });
    const context = await loader.loadContext(
      {
        target: { type: 'token', chainId: 46630, address: ADDRESS },
        sourceBlock: 100n,
        sourceBlockHash: BLOCK_HASH,
        trigger: 'new_token',
      },
      'risk-1.0.0',
    );

    expect(context.data.proxyAnalysis).toMatchObject({ proxyKind: 'none' });
    expect(context.data.privilegeAnalysis).toMatchObject({ sourceVerified: false });
    expect(context.dataSources.find((source) => source.key === 'contract_source')).toMatchObject({
      provider: 'blockscout',
      status: 'unavailable',
      reason: 'PROVIDER_UNAVAILABLE',
    });
  });
});
