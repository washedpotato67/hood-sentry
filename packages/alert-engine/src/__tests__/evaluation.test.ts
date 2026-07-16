import { describe, expect, it } from 'vitest';
import {
  evaluateChainAlertRule,
  evaluateMarketAlertRule,
  evaluateRiskScoreAlertRule,
} from '../evaluation.js';

const TOKEN = '0x1000000000000000000000000000000000000001';
const SENDER = '0x1000000000000000000000000000000000000002';
const RECIPIENT = '0x1000000000000000000000000000000000000003';

describe('chain alert evaluation', () => {
  it('matches large transfers with exact integer thresholds', () => {
    expect(
      evaluateChainAlertRule(
        {
          ruleType: 'large_transfer',
          targetAddress: TOKEN,
          condition: { minimumAmountRaw: '1000000000000000000' },
        },
        {
          eventType: 'tokenTransfer',
          targetAddresses: [TOKEN, SENDER, RECIPIENT],
          tokenAddress: TOKEN,
          fromAddress: SENDER,
          toAddress: RECIPIENT,
          valueRaw: '1000000000000000001',
        },
      ),
    ).toMatchObject({
      matched: true,
      evidence: { observedRaw: '1000000000000000001' },
    });
  });

  it('does not infer a contract event without an explicit event allowlist', () => {
    expect(
      evaluateChainAlertRule(
        { ruleType: 'contract_event', targetAddress: TOKEN, condition: {} },
        { eventType: 'liquidityRemoved', targetAddresses: [TOKEN] },
      ),
    ).toBeNull();
  });

  it('applies sender and recipient filters', () => {
    expect(
      evaluateChainAlertRule(
        {
          ruleType: 'large_transfer',
          targetAddress: TOKEN,
          condition: { minimumAmountRaw: '1', toAddresses: [SENDER] },
        },
        {
          eventType: 'tokenTransfer',
          targetAddresses: [TOKEN],
          fromAddress: SENDER,
          toAddress: RECIPIENT,
          valueRaw: '5',
        },
      ),
    ).toBeNull();
  });
});

describe('market alert evaluation', () => {
  it('matches a configured downward price move', () => {
    expect(
      evaluateMarketAlertRule(
        {
          ruleType: 'price_change',
          targetAddress: TOKEN,
          condition: { changeBps: '500', windowSeconds: '3600', direction: 'down' },
        },
        {
          tokenAddress: TOKEN,
          windowSeconds: 3600,
          priceChangeBps: -501n,
          volumeRaw: 0n,
          previousVolumeRaw: null,
        },
      ),
    ).toMatchObject({
      matched: true,
      evidence: { metric: 'price_change_bps', observedRaw: '-501' },
    });
  });

  it('requires both the volume floor and multiplier', () => {
    const rule = {
      ruleType: 'volume_spike',
      targetAddress: TOKEN,
      condition: {
        minimumVolumeRaw: '1000',
        multiplierBps: '20000',
        windowSeconds: '300',
      },
    };
    expect(
      evaluateMarketAlertRule(rule, {
        tokenAddress: TOKEN,
        windowSeconds: 300,
        priceChangeBps: null,
        volumeRaw: 1_999n,
        previousVolumeRaw: 1_000n,
      }),
    ).toBeNull();
    expect(
      evaluateMarketAlertRule(rule, {
        tokenAddress: TOKEN,
        windowSeconds: 300,
        priceChangeBps: null,
        volumeRaw: 2_000n,
        previousVolumeRaw: 1_000n,
      }),
    ).toMatchObject({
      matched: true,
      evidence: { metric: 'volume_multiplier_bps', observedRaw: '20000' },
    });
  });
});

describe('risk score alert evaluation', () => {
  it('matches an exact score decrease without floating point math', () => {
    expect(
      evaluateRiskScoreAlertRule(
        {
          ruleType: 'risk_score_change',
          targetAddress: TOKEN,
          condition: { minimumDeltaBps: '500', direction: 'decrease' },
        },
        {
          targetAddress: TOKEN,
          previousScoreBps: 8_500n,
          currentScoreBps: 8_000n,
          methodologyVersion: 'risk-v1',
        },
      ),
    ).toMatchObject({
      matched: true,
      evidence: { observedRaw: '-500', currentScoreBps: '8000' },
    });
  });
});
