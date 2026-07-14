export interface BondingCurveTransitionRepository {
  disableCurveSource(
    chainId: number,
    tokenAddress: `0x${string}`,
    migrationBlock: bigint,
  ): Promise<void>;
  enableMigratedPoolSource(
    chainId: number,
    tokenAddress: `0x${string}`,
    poolAddress: `0x${string}`,
    migrationBlock: bigint,
  ): Promise<boolean>;
}

export class BondingCurveMigrationTransitionJob {
  constructor(private readonly repository: BondingCurveTransitionRepository) {}

  async run(input: {
    chainId: number;
    tokenAddress: `0x${string}`;
    destinationPoolAddress: `0x${string}`;
    migrationBlock: bigint;
    destinationPoolVerified: boolean;
  }): Promise<{ dexSourceEnabled: boolean; idempotencyKey: string }> {
    await this.repository.disableCurveSource(
      input.chainId,
      input.tokenAddress,
      input.migrationBlock,
    );
    const dexSourceEnabled = input.destinationPoolVerified
      ? await this.repository.enableMigratedPoolSource(
          input.chainId,
          input.tokenAddress,
          input.destinationPoolAddress,
          input.migrationBlock,
        )
      : false;
    return {
      dexSourceEnabled,
      idempotencyKey: `bonding-curve-transition:${input.chainId}:${input.tokenAddress}:${input.migrationBlock.toString()}`,
    };
  }
}
