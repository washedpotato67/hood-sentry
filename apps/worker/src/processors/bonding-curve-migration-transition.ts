import { schema } from '@hood-sentry/db';
import type { DerivedJobPayload } from '@hood-sentry/queue';
import { and, eq, inArray } from 'drizzle-orm';
import { getAddress, isAddress, isHash } from 'viem';
import { z } from 'zod';
import {
  BondingCurveMigrationTransitionJob,
  type BondingCurveTransitionRepository,
} from '../jobs/bonding-curve-transition.js';
import type { ProcessorContext } from './types.js';

const addressSchema = z
  .string()
  .refine(isAddress, 'expected a 20-byte address')
  .transform((value) => getAddress(value));

const transitionDataSchema = z.object({
  tokenAddress: addressSchema,
  destinationProtocolKey: z.string().trim().min(1).max(100),
  destinationPoolAddress: addressSchema,
  transactionHash: z.string().refine(isHash, 'expected a 32-byte transaction hash'),
  logIndex: z.number().int().nonnegative(),
  eventType: z.literal('launchpadMigration'),
});

class DrizzleBondingCurveTransitionRepository implements BondingCurveTransitionRepository {
  constructor(private readonly context: Pick<ProcessorContext, 'database'>) {}

  async disableCurveSource(chainId: number, tokenAddress: `0x${string}`): Promise<void> {
    await this.context.database.db
      .update(schema.priceSourceConfigs)
      .set({ enabled: false, updated_at: new Date() })
      .where(
        and(
          eq(schema.priceSourceConfigs.chain_id, chainId),
          eq(schema.priceSourceConfigs.source_asset_address, tokenAddress.toLowerCase()),
          eq(schema.priceSourceConfigs.source_type, 'launchpadBondingCurve'),
        ),
      );
  }

  async enableMigratedPoolSource(
    chainId: number,
    tokenAddress: `0x${string}`,
    poolAddress: `0x${string}`,
  ): Promise<boolean> {
    const rows = await this.context.database.db
      .update(schema.priceSourceConfigs)
      .set({ enabled: true, updated_at: new Date() })
      .where(
        and(
          eq(schema.priceSourceConfigs.chain_id, chainId),
          eq(schema.priceSourceConfigs.source_asset_address, tokenAddress.toLowerCase()),
          eq(schema.priceSourceConfigs.source_contract_address, poolAddress.toLowerCase()),
          inArray(schema.priceSourceConfigs.source_type, [
            'stablecoinPool',
            'wethRoute',
            'directDex',
          ]),
        ),
      )
      .returning({ sourceKey: schema.priceSourceConfigs.source_key });
    return rows.length > 0;
  }
}

export async function processBondingCurveMigrationTransition(
  payload: DerivedJobPayload,
  context: Pick<ProcessorContext, 'database' | 'logger'>,
): Promise<void> {
  const data = transitionDataSchema.parse(payload.data);
  const chainId = z.coerce.number().int().positive().safe().parse(payload.chainId);
  const migrationBlock = z.coerce.bigint().nonnegative().parse(payload.blockNumber);
  if (!isHash(payload.blockHash)) throw new Error('Migration block hash is malformed');

  const migrations = await context.database.db
    .select({
      tokenAddress: schema.launchpadMigrations.token_address,
      destinationProtocolKey: schema.launchpadMigrations.destination_protocol_key,
      destinationPoolAddress: schema.launchpadMigrations.destination_pool_address,
    })
    .from(schema.launchpadMigrations)
    .where(
      and(
        eq(schema.launchpadMigrations.chain_id, chainId),
        eq(schema.launchpadMigrations.block_number, migrationBlock),
        eq(schema.launchpadMigrations.block_hash, payload.blockHash.toLowerCase()),
        eq(schema.launchpadMigrations.transaction_hash, data.transactionHash.toLowerCase()),
        eq(schema.launchpadMigrations.log_index, data.logIndex),
        eq(schema.launchpadMigrations.canonical, true),
      ),
    )
    .limit(1);
  const migration = migrations[0];
  if (
    migration === undefined ||
    migration.tokenAddress.toLowerCase() !== data.tokenAddress.toLowerCase() ||
    migration.destinationProtocolKey !== data.destinationProtocolKey ||
    migration.destinationPoolAddress.toLowerCase() !== data.destinationPoolAddress.toLowerCase()
  ) {
    throw new Error('CANONICAL_LAUNCHPAD_MIGRATION_NOT_READY');
  }

  const verifiedPools = await context.database.db
    .select({
      poolAddress: schema.pools.address,
      validationExpiresAt: schema.dexProtocols.validation_expires_at,
      blockTimestamp: schema.blocks.timestamp,
    })
    .from(schema.pools)
    .innerJoin(schema.dexProtocols, eq(schema.pools.protocol_id, schema.dexProtocols.id))
    .innerJoin(
      schema.blocks,
      and(
        eq(schema.blocks.chainId, BigInt(chainId)),
        eq(schema.blocks.number, migrationBlock),
        eq(schema.blocks.hash, payload.blockHash.toLowerCase()),
      ),
    )
    .where(
      and(
        eq(schema.pools.chain_id, chainId),
        eq(schema.pools.address, data.destinationPoolAddress.toLowerCase()),
        eq(schema.pools.protocol_key, data.destinationProtocolKey),
        eq(schema.pools.canonical, true),
        eq(schema.pools.active, true),
        eq(schema.dexProtocols.enabled, true),
        eq(schema.dexProtocols.validation_status, 'active'),
        eq(schema.blocks.canonical, true),
      ),
    )
    .limit(1);

  const verifiedPool = verifiedPools[0];
  const destinationPoolVerified =
    verifiedPool !== undefined &&
    verifiedPool.validationExpiresAt !== null &&
    verifiedPool.validationExpiresAt > verifiedPool.blockTimestamp;
  const result = await new BondingCurveMigrationTransitionJob(
    new DrizzleBondingCurveTransitionRepository(context),
  ).run({
    chainId,
    tokenAddress: data.tokenAddress,
    destinationPoolAddress: data.destinationPoolAddress,
    migrationBlock,
    destinationPoolVerified,
  });
  if (!result.dexSourceEnabled) {
    context.logger.warn('Migrated pool price source is not active yet', {
      chainId,
      tokenAddress: data.tokenAddress,
      destinationPoolAddress: data.destinationPoolAddress,
      migrationBlock: migrationBlock.toString(),
    });
  }
}
