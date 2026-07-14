import { spawn } from 'node:child_process';
import {
  type Hash,
  type Hex,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  stringToHex,
  zeroAddress,
} from 'viem';
import { z } from 'zod';
import type {
  AnvilForkLauncher,
  DisposableAccountAllocator,
  ForkConfiguration,
  SimulationBatchResult,
  SimulationExecution,
  SimulationFinding,
  SimulationProvider,
  SimulationRequest,
  SimulationResult,
} from './simulation-types.js';

const configurationSchema = z.object({
  chainId: z.number().int().positive(),
  rpcUrl: z.string().url(),
  blockNumber: z.bigint().nonnegative(),
  port: z.number().int().min(1024).max(65_535),
  host: z.literal('127.0.0.1'),
  timeoutMs: z.number().int().positive().max(120_000),
  methodologyVersion: z.string().trim().min(1).max(128),
});

function delta(before: bigint | null, after: bigint | null): bigint | null {
  return before === null || after === null ? null : after - before;
}

function simulationId(request: SimulationRequest, sourceBlockHash: string): string {
  return keccak256(
    stringToHex(
      [
        request.chainId,
        request.tokenAddress.toLowerCase(),
        request.sourceBlock.toString(),
        sourceBlockHash.toLowerCase(),
        request.action,
        request.sender.toLowerCase(),
        request.target.toLowerCase(),
        request.calldata.toLowerCase(),
      ].join(':'),
    ),
  );
}

function validateRequest(request: SimulationRequest, configuration: ForkConfiguration): void {
  if (request.chainId !== configuration.chainId) {
    throw new Error(
      `Simulation chain ${request.chainId} does not match fork ${configuration.chainId}`,
    );
  }
  if (request.sourceBlock !== configuration.blockNumber) {
    throw new Error('Simulation request is not pinned to the fork block');
  }
  if (!isAddress(request.target) || request.target.toLowerCase() === zeroAddress) {
    throw new Error('Simulation target is invalid');
  }
  if (!isAddress(request.sender) || request.sender.toLowerCase() === zeroAddress) {
    throw new Error('Simulation sender must be a disposable non-zero account');
  }
  if (request.route !== undefined && !request.route.verified) {
    throw new Error('Simulation route is not verified');
  }
}

function withDeltas(result: Awaited<ReturnType<SimulationProvider['execute']>>) {
  return {
    ...result,
    balanceChanges: result.balanceChanges.map((change) => ({
      ...change,
      deltaRaw: delta(change.beforeRaw, change.afterRaw),
    })),
    allowanceChanges: result.allowanceChanges.map((change) => ({
      ...change,
      deltaRaw: delta(change.beforeRaw, change.afterRaw),
    })),
  };
}

function executionWarnings(request: SimulationRequest): readonly string[] {
  const warnings: string[] = ['Simulation result is hypothetical and never broadcast'];
  if (request.hypotheticalStateOverride !== undefined) {
    warnings.push('Hypothetical state overrides were applied');
  }
  if (
    request.route?.verified !== true &&
    ['buy', 'sell', 'postGraduationSwap'].includes(request.action)
  ) {
    warnings.push('No verified route was supplied');
  }
  return warnings;
}

function finding(
  code: SimulationFinding['code'],
  severity: SimulationFinding['severity'],
  explanation: string,
  evidence: readonly SimulationExecution[],
  confidence: SimulationFinding['confidence'] = 'confirmed',
): SimulationFinding {
  return {
    code,
    status: severity === 'critical' || severity === 'high' ? 'fail' : 'warning',
    severity,
    explanation,
    evidence,
    confidence,
  };
}

function deriveFindings(executions: readonly SimulationExecution[]): readonly SimulationFinding[] {
  const successful = new Map(executions.map((execution) => [execution.action, execution]));
  const findings: SimulationFinding[] = [];
  const buy = successful.get('buy');
  const sell = successful.get('sell');
  if (buy?.result.success === true && sell?.result.success === false) {
    findings.push(
      finding('BUY_SUCCEEDS_SELL_FAILS', 'critical', 'Buy succeeded while sell failed.', [
        buy,
        sell,
      ]),
    );
  }
  for (const transferAction of ['transfer', 'transferAfterBuy', 'sellAfterTransfer'] as const) {
    const execution = successful.get(transferAction);
    if (execution?.result.success === false) {
      findings.push(
        finding(
          'ORDINARY_TRANSFER_FAILS',
          'high',
          `The ${transferAction} path reverted for the disposable account.`,
          [execution],
        ),
      );
    }
  }
  const fees = executions.filter(
    (execution) =>
      execution.result.success &&
      execution.expectedOutputRaw !== null &&
      execution.result.actualOutputRaw !== null,
  );
  const buyFees = fees.filter((execution) => execution.action === 'buy');
  const sellFees = fees.filter((execution) => execution.action === 'sell');
  const tax = (execution: SimulationExecution): bigint | null => {
    if (execution.expectedOutputRaw === null || execution.result.actualOutputRaw === null)
      return null;
    if (execution.expectedOutputRaw === 0n) return null;
    return (
      ((execution.expectedOutputRaw - execution.result.actualOutputRaw) * 10_000n) /
      execution.expectedOutputRaw
    );
  };
  if (buyFees.some((execution) => (tax(execution) ?? 0n) >= 1_000n)) {
    findings.push(
      finding(
        'EXTREME_BUY_TAX',
        'high',
        'Buy output lost at least 10 percent versus expected output.',
        buyFees,
      ),
    );
  }
  if (sellFees.some((execution) => (tax(execution) ?? 0n) >= 1_000n)) {
    findings.push(
      finding(
        'EXTREME_SELL_TAX',
        'high',
        'Sell output lost at least 10 percent versus expected output.',
        sellFees,
      ),
    );
  }
  const outputs = fees
    .map((execution) => tax(execution))
    .filter((value): value is bigint => value !== null);
  if (outputs.length > 1 && new Set(outputs.map((value) => value.toString())).size > 1) {
    findings.push(
      finding(
        'ADDRESS_DEPENDENT_TAX',
        'medium',
        'Effective fee differs across simulated paths.',
        fees,
        'high',
      ),
    );
  }
  for (const execution of executions) {
    const unexpected = execution.result.balanceChanges.some(
      (change) =>
        change.asset.toLowerCase() !== execution.tokenAddress.toLowerCase() &&
        change.deltaRaw !== 0n,
    );
    if (unexpected) {
      findings.push(
        finding(
          'UNEXPECTED_BALANCE_CHANGE',
          'high',
          'Simulation changed an unrequested asset balance.',
          [execution],
        ),
      );
    }
    if (execution.expectedOutputRaw !== null && execution.result.actualOutputRaw !== null) {
      const difference = execution.expectedOutputRaw - execution.result.actualOutputRaw;
      if (difference < 0n || difference * 100n > execution.expectedOutputRaw) {
        findings.push(
          finding(
            'QUOTE_OUTPUT_DIVERGENCE',
            'high',
            'Actual output diverged materially from the expected output.',
            [execution],
          ),
        );
      }
    }
  }
  return findings;
}

export class DynamicSimulationService {
  constructor(
    private readonly launcher: AnvilForkLauncher,
    private readonly provider: SimulationProvider,
    private readonly accounts: DisposableAccountAllocator,
  ) {}

  async run(
    rawConfiguration: ForkConfiguration,
    requests: readonly SimulationRequest[],
    signal?: AbortSignal,
  ): Promise<SimulationBatchResult> {
    const configuration = configurationSchema.parse(rawConfiguration);
    if (requests.length === 0) throw new Error('Simulation requires at least one request');
    const fork = await this.launcher.start(configuration);
    const executions: SimulationExecution[] = [];
    const warnings: string[] = [];
    try {
      const sourceBlockHash = await this.provider.getBlockHash(
        configuration.blockNumber,
        fork.endpoint,
      );
      this.accounts.allocate(Math.max(1, requests.length));
      for (const request of requests) {
        if (signal?.aborted)
          return {
            tokenAddress: request.tokenAddress,
            sourceBlock: request.sourceBlock,
            sourceBlockHash,
            executions,
            findings: deriveFindings(executions),
            status: 'cancelled',
            warnings: [...warnings, 'Simulation cancelled'],
          };
        const startedAt = new Date().toISOString();
        try {
          validateRequest(request, configuration);
          const result = await Promise.race([
            this.provider.execute(request, fork.endpoint),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('SIMULATION_TIMEOUT')), configuration.timeoutMs),
            ),
          ]);
          executions.push({
            simulationId: simulationId(request, sourceBlockHash),
            tokenAddress: getAddress(request.tokenAddress),
            chainId: request.chainId,
            sourceBlock: request.sourceBlock,
            sourceBlockHash,
            fork: configuration,
            calldata: request.calldata,
            target: getAddress(request.target),
            sender: getAddress(request.sender),
            route: request.route ?? null,
            action: request.action,
            result: withDeltas(result),
            expectedOutputRaw: request.amountOutExpectedRaw ?? null,
            warnings: executionWarnings(request),
            hypothetical: request.hypotheticalStateOverride !== undefined,
            startedAt,
            completedAt: new Date().toISOString(),
          });
        } catch (error) {
          warnings.push(
            `${request.action}: ${error instanceof Error ? error.message : 'simulation failed'}`,
          );
        }
      }
      const status = warnings.some((warning) => warning.includes('TIMEOUT'))
        ? 'quarantined'
        : warnings.length > 0
          ? 'partial'
          : 'complete';
      return {
        tokenAddress: getAddress(requests[0]?.tokenAddress ?? zeroAddress),
        sourceBlock: configuration.blockNumber,
        sourceBlockHash,
        executions,
        findings: deriveFindings(executions),
        status,
        warnings,
      };
    } finally {
      await fork.stop();
      await this.provider.reset();
    }
  }
}
export class ProcessAnvilForkLauncher implements AnvilForkLauncher {
  async start(configuration: ForkConfiguration) {
    const child = spawn(
      'anvil',
      [
        '--fork-url',
        configuration.rpcUrl,
        '--fork-block-number',
        configuration.blockNumber.toString(),
        '--host',
        configuration.host,
        '--port',
        configuration.port.toString(),
        '--accounts',
        '20',
      ],
      { stdio: 'ignore' },
    );
    return {
      endpoint: `http://${configuration.host}:${configuration.port}`,
      pid: child.pid ?? null,
      stop: async (): Promise<void> => {
        if (child.exitCode !== null || child.killed) return;
        child.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 2_000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      },
    };
  }
}

interface RpcResponse {
  readonly result?: unknown;
  readonly error?: { readonly message?: string; readonly data?: unknown };
}

const balanceAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);
const allowanceAbi = parseAbi(['function allowance(address,address) view returns (uint256)']);

function isRpcRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRpcResponse(value: unknown): value is RpcResponse {
  return isRpcRecord(value) && ('result' in value || 'error' in value);
}

function rpcErrorData(value: unknown): unknown {
  if (value instanceof Error && 'data' in value) return value.data;
  return null;
}

function rpcErrorMessage(value: unknown): string {
  if (isRpcRecord(value) && typeof value.message === 'string') return value.message;
  return 'Anvil RPC error';
}

function asHex(value: unknown, label: string): Hex {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`${label} returned malformed hex`);
  }
  return `0x${value.slice(2)}`;
}

function asQuantity(value: unknown, label: string): bigint {
  return BigInt(asHex(value, label));
}

export class AnvilJsonRpcSimulationProvider implements SimulationProvider {
  private requestId = 0;

  constructor(
    private readonly fetcher: typeof globalThis.fetch = globalThis.fetch,
    private readonly requestTimeoutMs = 30_000,
  ) {}

  private async rpc(
    endpoint: string,
    method: string,
    params: readonly unknown[],
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++this.requestId, method, params }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Anvil RPC returned HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (!isRpcRecord(payload)) throw new Error('Anvil RPC returned a malformed response');
      if (!isRpcResponse(payload)) throw new Error('Anvil RPC returned a malformed envelope');
      const parsed = payload;
      if (parsed.error !== undefined) {
        const error = new Error(rpcErrorMessage(parsed.error));
        const errorData = isRpcRecord(parsed.error) ? parsed.error.data : undefined;
        Object.defineProperty(error, 'data', { value: errorData });
        throw error;
      }
      return parsed.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async getBlockHash(blockNumber: bigint, endpoint = 'http://127.0.0.1:8545'): Promise<Hash> {
    const block = await this.rpc(endpoint, 'eth_getBlockByNumber', [
      `0x${blockNumber.toString(16)}`,
      false,
    ]);
    if (!isRpcRecord(block)) throw new Error('Anvil returned no block');
    const hash = asHex(block.hash, 'eth_getBlockByNumber');
    if (hash.length !== 66) throw new Error('Anvil returned an invalid block hash');
    return hash;
  }

  private async readProbe(
    endpoint: string,
    request: SimulationRequest,
  ): Promise<{
    readonly balances: readonly bigint[];
    readonly allowance: bigint | null;
  }> {
    const balances: bigint[] = [];
    for (const asset of request.balanceProbes ?? []) {
      const data = encodeFunctionData({
        abi: balanceAbi,
        functionName: 'balanceOf',
        args: [request.sender],
      });
      balances.push(
        asQuantity(
          await this.rpc(endpoint, 'eth_call', [{ to: asset, data }, 'latest']),
          'balanceOf',
        ),
      );
    }
    let allowance: bigint | null = null;
    if (request.allowanceProbe !== undefined) {
      const probe = request.allowanceProbe;
      const data = encodeFunctionData({
        abi: allowanceAbi,
        functionName: 'allowance',
        args: [probe.owner, probe.spender],
      });
      allowance = asQuantity(
        await this.rpc(endpoint, 'eth_call', [{ to: probe.asset, data }, 'latest']),
        'allowance',
      );
    }
    return { balances, allowance };
  }

  async execute(request: SimulationRequest, endpoint: string): Promise<SimulationResult> {
    const snapshot = await this.rpc(endpoint, 'evm_snapshot', []);
    try {
      const before = await this.readProbe(endpoint, request);
      const txHash = asHex(
        await this.rpc(endpoint, 'eth_sendTransaction', [
          {
            from: request.sender,
            to: request.target,
            data: request.calldata,
            value: `0x${(request.valueRaw ?? 0n).toString(16)}`,
          },
        ]),
        'eth_sendTransaction',
      );
      let receipt: Record<string, unknown> | null = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const candidate = await this.rpc(endpoint, 'eth_getTransactionReceipt', [txHash]);
        if (isRpcRecord(candidate)) {
          receipt = candidate;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (receipt === null) throw new Error('Anvil receipt timeout');
      const after = await this.readProbe(endpoint, request);
      const balanceChanges = (request.balanceProbes ?? []).map((asset, index) => ({
        address: request.sender,
        asset,
        beforeRaw: before.balances[index] ?? null,
        afterRaw: after.balances[index] ?? null,
        deltaRaw: null,
        hypothetical: request.hypotheticalStateOverride !== undefined,
      }));
      const allowanceChanges =
        request.allowanceProbe === undefined
          ? []
          : [
              {
                owner: request.allowanceProbe.owner,
                spender: request.allowanceProbe.spender,
                asset: request.allowanceProbe.asset,
                beforeRaw: before.allowance,
                afterRaw: after.allowance,
                deltaRaw: null,
                hypothetical: request.hypotheticalStateOverride !== undefined,
              },
            ];
      return {
        success: receipt.status === '0x1',
        returnData: '0x',
        revertData: null,
        decodedError: receipt.status === '0x1' ? null : 'Transaction reverted on Anvil fork',
        gasUsed: receipt.gasUsed === undefined ? null : asQuantity(receipt.gasUsed, 'gasUsed'),
        actualOutputRaw: null,
        balanceChanges,
        allowanceChanges,
        effectiveFeeRaw: null,
      };
    } catch (error) {
      const data = rpcErrorData(error);
      return {
        success: false,
        returnData: '0x',
        revertData:
          typeof data === 'string' && /^0x[0-9a-fA-F]*$/.test(data) ? `0x${data.slice(2)}` : null,
        decodedError: error instanceof Error ? error.message : 'Anvil execution failed',
        gasUsed: null,
        actualOutputRaw: null,
        balanceChanges: [],
        allowanceChanges: [],
        effectiveFeeRaw: null,
      };
    } finally {
      await this.rpc(endpoint, 'evm_revert', [snapshot]);
    }
  }

  async reset(): Promise<void> {
    return Promise.resolve();
  }
}
