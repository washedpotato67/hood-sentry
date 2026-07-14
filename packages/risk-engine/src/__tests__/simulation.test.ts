import { describe, expect, it } from 'vitest';
import { getAddress, type Hash, type Hex } from 'viem';
import { DynamicSimulationService } from '../simulation.js';
import type {
  AnvilForkLauncher,
  AnvilForkProcess,
  DisposableAccountAllocator,
  ForkConfiguration,
  SimulationProvider,
  SimulationRequest,
  SimulationResult,
} from '../simulation-types.js';

const TOKEN = getAddress('0x1000000000000000000000000000000000000001');
const SENDER = getAddress('0x2000000000000000000000000000000000000002');
const TARGET = getAddress('0x3000000000000000000000000000000000000003');
const BLOCK_HASH = `0x${'44'.repeat(32)}` as Hash;
const CONFIG: ForkConfiguration = {
  chainId: 46630,
  rpcUrl: 'https://rpc.example.invalid',
  blockNumber: 100n,
  port: 18_545,
  host: '127.0.0.1',
  timeoutMs: 30,
  methodologyVersion: 'simulation-v1',
};

const calldata = '0x12345678' as Hex;

function result(overrides: Partial<SimulationResult> = {}): SimulationResult {
  return {
    success: true,
    returnData: '0x',
    revertData: null,
    decodedError: null,
    gasUsed: 100_000n,
    actualOutputRaw: 990n,
    balanceChanges: [],
    allowanceChanges: [],
    effectiveFeeRaw: 10n,
    ...overrides,
  };
}

function request(action: SimulationRequest['action']): SimulationRequest {
  return {
    chainId: CONFIG.chainId,
    tokenAddress: TOKEN,
    sourceBlock: CONFIG.blockNumber,
    sender: SENDER,
    action,
    target: TARGET,
    calldata,
    amountOutExpectedRaw: action === 'buy' || action === 'sell' ? 1_000n : undefined,
  };
}

class Launcher implements AnvilForkLauncher {
  stopped = false;
  async start(): Promise<AnvilForkProcess> {
    return {
      endpoint: 'http://127.0.0.1:18545',
      pid: 123,
      stop: async () => {
        this.stopped = true;
      },
    };
  }
}

class Accounts implements DisposableAccountAllocator {
  allocate(count: number): readonly `0x${string}`[] {
    return Array.from({ length: count }, () => SENDER);
  }
}

class Provider implements SimulationProvider {
  readonly results = new Map<
    SimulationRequest['action'],
    SimulationResult | Promise<SimulationResult>
  >();
  resetCount = 0;

  async getBlockHash(): Promise<Hash> {
    return BLOCK_HASH;
  }

  async execute(request: SimulationRequest): Promise<SimulationResult> {
    const value = this.results.get(request.action);
    if (value === undefined) throw new Error('missing fixture result');
    return await value;
  }

  async reset(): Promise<void> {
    this.resetCount += 1;
  }
}

describe('Anvil dynamic simulation service', () => {
  it('records a reproducible pinned-block standard transfer', async () => {
    const launcher = new Launcher();
    const provider = new Provider();
    provider.results.set('transfer', result({ actualOutputRaw: null }));
    const batch = await new DynamicSimulationService(launcher, provider, new Accounts()).run(
      CONFIG,
      [request('transfer')],
    );

    expect(batch.status).toBe('complete');
    expect(batch.sourceBlock).toBe(CONFIG.blockNumber);
    expect(batch.sourceBlockHash).toBe(BLOCK_HASH);
    expect(batch.executions[0]).toMatchObject({
      tokenAddress: TOKEN,
      action: 'transfer',
      hypothetical: false,
    });
    expect(batch.executions[0]?.warnings).toContain(
      'Simulation result is hypothetical and never broadcast',
    );
    expect(launcher.stopped).toBe(true);
    expect(provider.resetCount).toBe(1);
  });

  it('detects buy success with sell failure and extreme fees', async () => {
    const provider = new Provider();
    provider.results.set('buy', result({ actualOutputRaw: 800n }));
    provider.results.set(
      'sell',
      result({ success: false, actualOutputRaw: null, revertData: '0xdeadbeef' }),
    );
    const batch = await new DynamicSimulationService(new Launcher(), provider, new Accounts()).run(
      CONFIG,
      [request('buy'), request('sell')],
    );

    expect(batch.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['BUY_SUCCEEDS_SELL_FAILS', 'EXTREME_BUY_TAX']),
    );
    expect(batch.executions[1]?.result.revertData).toBe('0xdeadbeef');
  });

  it('records balance and allowance deltas, including hypothetical overrides', async () => {
    const provider = new Provider();
    provider.results.set(
      'approve',
      result({
        actualOutputRaw: null,
        balanceChanges: [
          {
            address: SENDER,
            asset: TOKEN,
            beforeRaw: 100n,
            afterRaw: 80n,
            deltaRaw: null,
            hypothetical: true,
          },
        ],
        allowanceChanges: [
          {
            owner: SENDER,
            spender: TARGET,
            asset: TOKEN,
            beforeRaw: 0n,
            afterRaw: 50n,
            deltaRaw: null,
            hypothetical: true,
          },
        ],
      }),
    );
    const input = request('approve');
    const batch = await new DynamicSimulationService(new Launcher(), provider, new Accounts()).run(
      CONFIG,
      [{ ...input, hypotheticalStateOverride: { storage: 'fixture' } }],
    );

    expect(batch.executions[0]?.hypothetical).toBe(true);
    expect(batch.executions[0]?.result.balanceChanges[0]?.deltaRaw).toBe(-20n);
    expect(batch.executions[0]?.result.allowanceChanges[0]?.deltaRaw).toBe(50n);
    expect(batch.executions[0]?.warnings).toContain('Hypothetical state overrides were applied');
  });

  it('quarantines a timed-out target and never broadcasts', async () => {
    const provider = new Provider();
    provider.results.set('buy', new Promise<never>(() => undefined));
    const batch = await new DynamicSimulationService(new Launcher(), provider, new Accounts()).run(
      CONFIG,
      [request('buy')],
    );

    expect(batch.status).toBe('quarantined');
    expect(batch.warnings).toContain('buy: SIMULATION_TIMEOUT');
  });

  it('rejects unverified routes before execution', async () => {
    const provider = new Provider();
    provider.results.set('buy', result());
    const input = request('buy');
    const batch = await new DynamicSimulationService(new Launcher(), provider, new Accounts()).run(
      CONFIG,
      [
        {
          ...input,
          route: {
            protocolKey: 'unknown',
            protocolVersion: '0',
            poolAddresses: [],
            quoteAsset: null,
            verified: false,
          },
        },
      ],
    );

    expect(batch.status).toBe('partial');
    expect(batch.warnings[0]).toContain('route is not verified');
    expect(batch.executions).toHaveLength(0);
  });
});
