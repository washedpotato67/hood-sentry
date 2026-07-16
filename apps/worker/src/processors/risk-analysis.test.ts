import type { DerivedJobPayload } from '@hood-sentry/queue';
import { describe, expect, it } from 'vitest';
import type { RiskAnalysisRunResult, RiskAnalysisRunner } from '../jobs/risk-runtime.js';
import type { RiskScanJobInput } from '../jobs/risk-scan.js';
import { processRiskAnalysis } from './risk-analysis.js';

const POOL = '0x1000000000000000000000000000000000000001';
const TOKEN0 = '0x2000000000000000000000000000000000000001';
const TOKEN1 = '0x2000000000000000000000000000000000000002';
const HASH = `0x${'a'.repeat(64)}`;

class CapturingRunner implements RiskAnalysisRunner {
  readonly inputs: RiskScanJobInput[] = [];

  async run(input: RiskScanJobInput): Promise<RiskAnalysisRunResult> {
    this.inputs.push(input);
    return {
      scanRunId: `scan-${this.inputs.length.toString()}`,
      idempotencyKey: `0x${'b'.repeat(64)}`,
      duplicate: false,
      result: null,
    };
  }
}

const riskAlerts = {
  async evaluate() {},
};

function payload(data: Record<string, unknown>): DerivedJobPayload {
  return {
    type: 'risk-analysis',
    chainId: '4663',
    blockNumber: '100',
    blockHash: HASH,
    data: { protocolKey: 'fixture', protocolVersion: '1.0.0', ...data },
  };
}

describe('risk-analysis processor', () => {
  it('scans a new pool and both pool assets', async () => {
    const riskAnalysis = new CapturingRunner();
    await processRiskAnalysis(
      payload({ poolAddress: POOL, token0Address: TOKEN0, token1Address: TOKEN1 }),
      { riskAnalysis, riskAlerts },
    );

    expect(riskAnalysis.inputs.map((input) => input.target)).toEqual([
      { type: 'pool', chainId: 4663, address: POOL },
      { type: 'token', chainId: 4663, address: TOKEN0 },
      { type: 'token', chainId: 4663, address: TOKEN1 },
    ]);
    expect(riskAnalysis.inputs.every((input) => input.trigger === 'pool_creation')).toBe(true);
  });

  it('scans a launchpad token as a new token', async () => {
    const riskAnalysis = new CapturingRunner();
    await processRiskAnalysis(payload({ tokenAddress: TOKEN0 }), { riskAnalysis, riskAlerts });

    expect(riskAnalysis.inputs).toMatchObject([
      {
        target: { type: 'launchpad_token', chainId: 4663, address: TOKEN0 },
        sourceBlock: 100n,
        sourceBlockHash: HASH,
        trigger: 'new_token',
      },
    ]);
  });

  it('uses the liquidity-removal trigger for removal events', async () => {
    const riskAnalysis = new CapturingRunner();
    await processRiskAnalysis(
      payload({
        poolAddress: POOL,
        token0Address: TOKEN0,
        token1Address: TOKEN1,
        eventType: 'liquidityRemoved',
      }),
      { riskAnalysis, riskAlerts },
    );

    expect(riskAnalysis.inputs.every((input) => input.trigger === 'liquidity_removal')).toBe(true);
  });

  it('rejects malformed targets before starting a scan', async () => {
    const riskAnalysis = new CapturingRunner();
    await expect(
      processRiskAnalysis(payload({ poolAddress: 'invalid' }), { riskAnalysis, riskAlerts }),
    ).rejects.toThrow();
    expect(riskAnalysis.inputs).toHaveLength(0);
  });

  it('propagates runtime failures for queue retry and dead-letter handling', async () => {
    const riskAnalysis: RiskAnalysisRunner = {
      async run() {
        throw new Error('provider unavailable');
      },
    };
    await expect(
      processRiskAnalysis(payload({ tokenAddress: TOKEN0 }), { riskAnalysis, riskAlerts }),
    ).rejects.toThrow('provider unavailable');
  });
});
