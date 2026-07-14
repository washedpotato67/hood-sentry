import { type Hex, keccak256, stringToHex } from 'viem';

export type TransactionIntent = {
  intentId: string;
  userId: string;
  wallet: `0x${string}`;
  chainId: number;
  target: `0x${string}`;
  functionSelector: `0x${string}`;
  functionName: string;
  decodedArguments: readonly unknown[];
  calldata: Hex;
  nativeValue: bigint;
  tokenAmounts: readonly { token: `0x${string}`; amount: bigint }[];
  spender?: `0x${string}`;
  approvalAmount?: bigint;
  expectedResult: string;
  simulation: { success: boolean; gasUsed?: bigint; revertData?: Hex };
  warnings: readonly string[];
  createdAt: string;
  expiresAt: string;
  featureFlag: string;
  configurationVersion: string;
  quoteId?: string;
};
export type IntentRequest = Omit<
  TransactionIntent,
  'intentId' | 'createdAt' | 'expiresAt' | 'simulation' | 'warnings'
> & { calldata: Hex; ttlSeconds: number };
export type IntentAuditEvent = {
  intentId: string;
  action: 'created' | 'reviewed' | 'signed' | 'broadcast' | 'confirmed' | 'reorged' | 'rejected';
  at: string;
  metadata?: string;
};
export type IntentProvider = {
  simulate(intent: IntentRequest): Promise<TransactionIntent['simulation']>;
  isFeatureEnabled(flag: string): boolean;
  isTargetAllowed(target: `0x${string}`, chainId: number): boolean;
  isSelectorAllowed(target: `0x${string}`, selector: `0x${string}`): boolean;
  record(event: IntentAuditEvent): Promise<void>;
};

export class TransactionIntentService {
  public constructor(
    private readonly provider: IntentProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}
  public async create(request: IntentRequest): Promise<TransactionIntent> {
    if (!this.provider.isFeatureEnabled(request.featureFlag))
      throw new Error('Transaction feature is disabled');
    if (request.ttlSeconds < 1 || request.ttlSeconds > 300)
      throw new Error('Intent expiry is outside the allowed window');
    if (!this.provider.isTargetAllowed(request.target, request.chainId))
      throw new Error('Transaction target is not allowlisted');
    if (!this.provider.isSelectorAllowed(request.target, request.functionSelector))
      throw new Error('Function selector is not allowlisted');
    if (request.calldata.slice(0, 10).toLowerCase() !== request.functionSelector.toLowerCase())
      throw new Error('Calldata selector mismatch');
    if (request.nativeValue < 0n) throw new Error('Native value is invalid');
    const created = this.now();
    const expires = new Date(created.getTime() + request.ttlSeconds * 1000);
    const simulation = await this.provider.simulate(request);
    if (!simulation.success) throw new Error('Transaction simulation failed');
    const intent = {
      ...request,
      intentId: keccak256(
        stringToHex(
          `${request.userId}:${request.wallet}:${request.chainId}:${request.target}:${request.calldata}:${created.toISOString()}`,
        ),
      ),
      createdAt: created.toISOString(),
      expiresAt: expires.toISOString(),
      simulation,
      warnings: ['Review calldata and simulation before signing'],
    };
    await this.provider.record({
      intentId: intent.intentId,
      action: 'created',
      at: created.toISOString(),
    });
    return intent;
  }
  public validateForBroadcast(
    intent: TransactionIntent,
    wallet: `0x${string}`,
    chainId: number,
    calldata: Hex,
    now = this.now(),
  ): void {
    if (intent.wallet.toLowerCase() !== wallet.toLowerCase())
      throw new Error('Wallet does not match intent');
    if (intent.chainId !== chainId) throw new Error('Chain does not match intent');
    if (new Date(intent.expiresAt).getTime() <= now.getTime()) throw new Error('Intent expired');
    if (intent.calldata.toLowerCase() !== calldata.toLowerCase())
      throw new Error('Calldata changed');
  }
}
