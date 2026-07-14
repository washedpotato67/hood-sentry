import { describe, expect, it, vi } from 'vitest';
import {
  type IntentProvider,
  type IntentRequest,
  TransactionIntentService,
} from '../transaction-intent.js';
const request: IntentRequest = {
  userId: 'u1',
  wallet: '0x1111111111111111111111111111111111111111',
  chainId: 1,
  target: '0x2222222222222222222222222222222222222222',
  functionSelector: '0xa9059cbb',
  functionName: 'transfer',
  decodedArguments: [],
  calldata:
    '0xa9059cbb00000000000000000000000033333333333333333333333333333333333333330000000000000000000000000000000000000000000000000000000000000001',
  nativeValue: 0n,
  tokenAmounts: [],
  expectedResult: 'success',
  featureFlag: 'writes',
  configurationVersion: 'v1',
  ttlSeconds: 60,
};
const provider: IntentProvider = {
  simulate: vi.fn(async () => ({ success: true, gasUsed: 1n })),
  isFeatureEnabled: () => true,
  isTargetAllowed: () => true,
  isSelectorAllowed: () => true,
  record: vi.fn(async () => undefined),
};
describe('transaction intents', () => {
  it('creates and binds an intent', async () => {
    const service = new TransactionIntentService(provider, () => new Date('2026-01-01T00:00:00Z'));
    const intent = await service.create(request);
    expect(intent.intentId).toMatch(/^0x/);
    service.validateForBroadcast(
      intent,
      request.wallet,
      1,
      request.calldata,
      new Date('2026-01-01T00:00:10Z'),
    );
  });
  it('rejects altered calldata, wrong wallet, expiry, disabled feature, and failed simulation', async () => {
    const service = new TransactionIntentService(provider, () => new Date('2026-01-01T00:00:00Z'));
    const intent = await service.create(request);
    expect(() =>
      service.validateForBroadcast(
        intent,
        '0x4444444444444444444444444444444444444444',
        1,
        request.calldata,
      ),
    ).toThrow();
    expect(() =>
      service.validateForBroadcast(intent, request.wallet, 1, '0xa9059cbb' as `0x${string}`),
    ).toThrow();
    expect(() =>
      service.validateForBroadcast(
        intent,
        request.wallet,
        1,
        request.calldata,
        new Date('2026-01-01T00:01:00Z'),
      ),
    ).toThrow();
    await expect(
      new TransactionIntentService({ ...provider, isFeatureEnabled: () => false }).create(request),
    ).rejects.toThrow();
    await expect(
      new TransactionIntentService({
        ...provider,
        simulate: vi.fn(async () => ({ success: false })),
      }).create(request),
    ).rejects.toThrow();
  });
});
