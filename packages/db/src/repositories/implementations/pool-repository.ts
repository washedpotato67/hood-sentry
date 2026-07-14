import type {
  LaunchpadGraduation,
  LaunchpadMigration,
  LaunchpadTokenCreated,
  LaunchpadTrade,
  NormalizedLiquidityEvent,
  NormalizedPool,
  NormalizedPoolState,
  NormalizedQuote,
  NormalizedSwap,
  ProtocolDefinition,
  ProtocolKind,
  ProtocolValidationResult,
} from '@hood-sentry/chain';
import { and, desc, eq, gte, lte, or } from 'drizzle-orm';
import { getAddress, isHash } from 'viem';
import type { Database } from '../../client.js';
import {
  dexProtocols,
  launchpadCreatorFeeEvents,
  launchpadGraduations,
  launchpadMigrations,
  launchpadTokens,
  launchpadTrades,
  liquidityEvents,
  poolTokens,
  pools,
  protocolContractVerifications,
  protocolContracts,
  protocolQuotes,
  swaps,
} from '../../schema/dex-market.js';
import type {
  ProtocolRepository as IProtocolRepository,
  ProtocolSummary,
  ProtocolVerificationRecord,
} from '../interfaces/pool-repository.js';

function parseHash(value: string): `0x${string}` {
  if (!isHash(value)) throw new Error(`Database contains an invalid hash: ${value}`);
  return value;
}

function stateRecord(state: NormalizedPoolState): Record<string, string | number> {
  if (state.poolType === 'constantProduct') {
    return {
      poolType: state.poolType,
      reserve0Raw: state.reserve0Raw.toString(),
      reserve1Raw: state.reserve1Raw.toString(),
      lpTotalSupplyRaw: state.lpTotalSupplyRaw.toString(),
    };
  }
  if (state.poolType === 'concentratedLiquidity') {
    return {
      poolType: state.poolType,
      sqrtPriceX96: state.sqrtPriceX96.toString(),
      currentTick: state.currentTick,
      activeLiquidityRaw: state.activeLiquidityRaw.toString(),
    };
  }
  return { poolType: state.poolType, liquidityRaw: state.liquidityRaw.toString(), ...state.state };
}

export class ProtocolRepository implements IProtocolRepository {
  constructor(private readonly db: Database['db']) {}

  async saveProtocolValidation(
    definition: ProtocolDefinition,
    result: ProtocolValidationResult,
    registryVersion: string,
  ): Promise<void> {
    const validationStatus = definition.enabled
      ? result.active
        ? 'active'
        : 'failed'
      : 'disabled';
    const factory = definition.contracts.find((contract) =>
      definition.kind === 'dex'
        ? contract.contractRole === 'factory'
        : contract.contractRole === 'tokenFactory',
    );
    const router = definition.contracts.find((contract) => contract.contractRole === 'router');
    const quoter = definition.contracts.find((contract) => contract.contractRole === 'quoter');
    const source = definition.contracts[0];
    if (source === undefined) throw new Error('Protocol definition has no contracts');
    const protocolRows = await this.db
      .insert(dexProtocols)
      .values({
        chain_id: definition.chainId,
        protocol_key: definition.protocolKey,
        protocol_name: definition.protocolName,
        version: definition.protocolVersion,
        kind: definition.kind,
        factory_address: factory?.address,
        router_address: router?.address,
        quoter_address: quoter?.address,
        verification_source: source.officialSourceUrl,
        verification_date: new Date(source.verifiedAt),
        registry_version: registryVersion,
        enabled: result.active,
        validation_status: validationStatus,
        validated_at: new Date(result.checkedAt),
        validation_expires_at: new Date(result.expiresAt),
      })
      .onConflictDoUpdate({
        target: [dexProtocols.chain_id, dexProtocols.protocol_key, dexProtocols.version],
        set: {
          protocol_name: definition.protocolName,
          kind: definition.kind,
          factory_address: factory?.address,
          router_address: router?.address,
          quoter_address: quoter?.address,
          verification_source: source.officialSourceUrl,
          verification_date: new Date(source.verifiedAt),
          registry_version: registryVersion,
          enabled: result.active,
          validation_status: validationStatus,
          validated_at: new Date(result.checkedAt),
          validation_expires_at: new Date(result.expiresAt),
          updated_at: new Date(),
        },
      })
      .returning({ id: dexProtocols.id });
    const protocolId = protocolRows[0]?.id;
    if (protocolId === undefined) throw new Error('Protocol validation upsert returned no row');

    for (const contract of definition.contracts) {
      const contractRows = await this.db
        .insert(protocolContracts)
        .values({
          protocol_id: protocolId,
          chain_id: contract.chainId,
          protocol_key: contract.protocolKey,
          protocol_version: contract.protocolVersion,
          contract_role: contract.contractRole,
          address: contract.address.toLowerCase(),
          official_source_url: contract.officialSourceUrl,
          explorer_url: contract.explorerUrl,
          verified_at: new Date(contract.verifiedAt),
          expected_runtime_bytecode_hash: contract.runtimeBytecodeHash,
          proxy_type: contract.proxyType,
          implementation_address: contract.implementationAddress?.toLowerCase(),
          admin_address: contract.adminAddress?.toLowerCase(),
          enabled: contract.enabled,
        })
        .onConflictDoUpdate({
          target: [
            protocolContracts.chain_id,
            protocolContracts.protocol_key,
            protocolContracts.protocol_version,
            protocolContracts.contract_role,
          ],
          set: {
            address: contract.address.toLowerCase(),
            official_source_url: contract.officialSourceUrl,
            explorer_url: contract.explorerUrl,
            verified_at: new Date(contract.verifiedAt),
            expected_runtime_bytecode_hash: contract.runtimeBytecodeHash,
            proxy_type: contract.proxyType,
            implementation_address: contract.implementationAddress?.toLowerCase(),
            admin_address: contract.adminAddress?.toLowerCase(),
            enabled: contract.enabled,
            updated_at: new Date(),
          },
        })
        .returning({ id: protocolContracts.id });
      const contractId = contractRows[0]?.id;
      const verification = result.contracts.find(
        (candidate) => candidate.config.contractRole === contract.contractRole,
      );
      if (contractId === undefined || verification === undefined) continue;
      await this.db.insert(protocolContractVerifications).values({
        protocol_contract_id: contractId,
        chain_id: result.chainId,
        observed_runtime_bytecode_hash: verification.observedRuntimeBytecodeHash,
        observed_implementation_address: verification.observedImplementationAddress?.toLowerCase(),
        observed_admin_address: verification.observedAdminAddress?.toLowerCase(),
        valid: verification.valid,
        failure_code: verification.valid ? null : result.failureCode,
        errors: verification.errors,
        checked_at: new Date(result.checkedAt),
        expires_at: new Date(result.expiresAt),
      });
    }
  }

  async upsertPool(pool: NormalizedPool): Promise<void> {
    const protocol = await this.findProtocol(pool.chainId, pool.protocolKey, pool.protocolVersion);
    await this.db
      .insert(pools)
      .values({
        chain_id: pool.chainId,
        address: pool.poolAddress.toLowerCase(),
        protocol_id: protocol.id,
        protocol_key: pool.protocolKey,
        protocol_version: pool.protocolVersion,
        factory_address: pool.factoryAddress.toLowerCase(),
        token0_address: pool.token0Address.toLowerCase(),
        token1_address: pool.token1Address.toLowerCase(),
        fee_tier: pool.feeTier?.toString(),
        tick_spacing: pool.tickSpacing,
        pool_type: pool.poolType,
        created_block: pool.createdBlockNumber,
        created_block_hash: pool.createdBlockHash,
        created_tx_hash: pool.creationTransactionHash,
        creation_log_index: pool.creationLogIndex,
        canonical: pool.canonical,
        active: pool.canonical,
      })
      .onConflictDoUpdate({
        target: [pools.chain_id, pools.address],
        set: {
          protocol_id: protocol.id,
          protocol_key: pool.protocolKey,
          protocol_version: pool.protocolVersion,
          factory_address: pool.factoryAddress.toLowerCase(),
          token0_address: pool.token0Address.toLowerCase(),
          token1_address: pool.token1Address.toLowerCase(),
          fee_tier: pool.feeTier?.toString(),
          tick_spacing: pool.tickSpacing,
          pool_type: pool.poolType,
          created_block: pool.createdBlockNumber,
          created_block_hash: pool.createdBlockHash,
          created_tx_hash: pool.creationTransactionHash,
          creation_log_index: pool.creationLogIndex,
          canonical: pool.canonical,
          active: pool.canonical,
          updated_at: new Date(),
        },
      });
    await this.upsertPoolTokens(pool);
  }

  async upsertPoolTokens(pool: NormalizedPool): Promise<void> {
    await this.db
      .insert(poolTokens)
      .values(
        [pool.token0Address, pool.token1Address].map((tokenAddress) => ({
          chain_id: pool.chainId,
          pool_address: pool.poolAddress.toLowerCase(),
          token_address: tokenAddress.toLowerCase(),
          reserve_raw: '0',
        })),
      )
      .onConflictDoNothing({
        target: [poolTokens.chain_id, poolTokens.pool_address, poolTokens.token_address],
      });
  }

  async updatePoolState(
    chainId: number,
    poolAddress: string,
    state: NormalizedPoolState,
    blockNumber: bigint,
  ): Promise<void> {
    await this.db
      .update(pools)
      .set({ state: stateRecord(state), state_block_number: blockNumber, updated_at: new Date() })
      .where(and(eq(pools.chain_id, chainId), eq(pools.address, poolAddress.toLowerCase())));
  }

  async insertSwap(swap: NormalizedSwap): Promise<void> {
    await this.db
      .insert(swaps)
      .values({
        chain_id: swap.chainId,
        protocol_key: swap.protocolKey,
        protocol_version: swap.protocolVersion,
        block_number: swap.blockNumber,
        block_hash: swap.blockHash,
        transaction_hash: swap.transactionHash,
        log_index: swap.logIndex,
        pool_address: swap.poolAddress.toLowerCase(),
        sender_address: swap.senderAddress?.toLowerCase(),
        recipient_address: swap.recipientAddress?.toLowerCase(),
        token_in_address: swap.tokenInAddress.toLowerCase(),
        token_out_address: swap.tokenOutAddress.toLowerCase(),
        amount_in_raw: swap.amountInRaw.toString(),
        amount_out_raw: swap.amountOutRaw.toString(),
        fee_raw: swap.feeRaw?.toString(),
        canonical: swap.canonical,
      })
      .onConflictDoUpdate({
        target: [swaps.chain_id, swaps.block_hash, swaps.transaction_hash, swaps.log_index],
        set: { canonical: swap.canonical, updated_at: new Date() },
      });
  }

  async insertLiquidityEvent(event: NormalizedLiquidityEvent): Promise<void> {
    await this.db
      .insert(liquidityEvents)
      .values({
        chain_id: event.chainId,
        protocol_key: event.protocolKey,
        protocol_version: event.protocolVersion,
        block_number: event.blockNumber,
        block_hash: event.blockHash,
        transaction_hash: event.transactionHash,
        log_index: event.logIndex,
        pool_address: event.poolAddress.toLowerCase(),
        event_type: event.eventType,
        provider_address: event.providerAddress?.toLowerCase(),
        owner_address: event.ownerAddress?.toLowerCase(),
        recipient_address: event.recipientAddress?.toLowerCase(),
        token0_address: event.token0Address.toLowerCase(),
        token1_address: event.token1Address.toLowerCase(),
        token0_amount_raw: event.amount0Raw.toString(),
        token1_amount_raw: event.amount1Raw.toString(),
        position_id: event.positionId?.toString(),
        tick_lower: event.tickLower,
        tick_upper: event.tickUpper,
        canonical: event.canonical,
      })
      .onConflictDoUpdate({
        target: [
          liquidityEvents.chain_id,
          liquidityEvents.block_hash,
          liquidityEvents.transaction_hash,
          liquidityEvents.log_index,
        ],
        set: { canonical: event.canonical, updated_at: new Date() },
      });
  }

  async insertLaunchpadToken(event: LaunchpadTokenCreated): Promise<void> {
    await this.db
      .insert(launchpadTokens)
      .values({
        chain_id: event.chainId,
        protocol_key: event.protocolKey,
        protocol_version: event.protocolVersion,
        token_address: event.tokenAddress.toLowerCase(),
        creator_address: event.creatorAddress.toLowerCase(),
        token_implementation_address: event.tokenImplementationAddress?.toLowerCase(),
        initial_supply_raw: event.initialSupplyRaw.toString(),
        bonding_curve_address: event.bondingCurveAddress?.toLowerCase(),
        block_number: event.blockNumber,
        block_hash: event.blockHash,
        transaction_hash: event.transactionHash,
        log_index: event.logIndex,
        canonical: event.canonical,
      })
      .onConflictDoUpdate({
        target: [
          launchpadTokens.chain_id,
          launchpadTokens.token_address,
          launchpadTokens.block_hash,
        ],
        set: { canonical: event.canonical, updated_at: new Date() },
      });
  }

  async insertLaunchpadTrade(event: LaunchpadTrade): Promise<void> {
    await this.db
      .insert(launchpadTrades)
      .values({
        chain_id: event.chainId,
        protocol_key: event.protocolKey,
        protocol_version: event.protocolVersion,
        token_address: event.tokenAddress.toLowerCase(),
        bonding_curve_address: event.bondingCurveAddress.toLowerCase(),
        trader_address: event.traderAddress.toLowerCase(),
        side: event.side,
        token_amount_raw: event.tokenAmountRaw.toString(),
        payment_amount_raw: event.paymentAmountRaw.toString(),
        creator_fee_raw: event.creatorFeeRaw?.toString(),
        protocol_fee_raw: event.protocolFeeRaw?.toString(),
        block_number: event.blockNumber,
        block_hash: event.blockHash,
        transaction_hash: event.transactionHash,
        log_index: event.logIndex,
        canonical: event.canonical,
      })
      .onConflictDoUpdate({
        target: [
          launchpadTrades.chain_id,
          launchpadTrades.block_hash,
          launchpadTrades.transaction_hash,
          launchpadTrades.log_index,
        ],
        set: { canonical: event.canonical, updated_at: new Date() },
      });
  }

  async insertCreatorFeeEvent(event: LaunchpadTrade): Promise<void> {
    if (event.creatorFeeRaw === undefined) return;
    await this.db
      .insert(launchpadCreatorFeeEvents)
      .values({
        chain_id: event.chainId,
        protocol_key: event.protocolKey,
        protocol_version: event.protocolVersion,
        token_address: event.tokenAddress.toLowerCase(),
        bonding_curve_address: event.bondingCurveAddress.toLowerCase(),
        trader_address: event.traderAddress.toLowerCase(),
        amount_raw: event.creatorFeeRaw.toString(),
        block_number: event.blockNumber,
        block_hash: event.blockHash,
        transaction_hash: event.transactionHash,
        log_index: event.logIndex,
        canonical: event.canonical,
      })
      .onConflictDoUpdate({
        target: [
          launchpadCreatorFeeEvents.chain_id,
          launchpadCreatorFeeEvents.block_hash,
          launchpadCreatorFeeEvents.transaction_hash,
          launchpadCreatorFeeEvents.log_index,
        ],
        set: { canonical: event.canonical, updated_at: new Date() },
      });
  }

  async insertGraduation(event: LaunchpadGraduation): Promise<void> {
    await this.db
      .insert(launchpadGraduations)
      .values({
        chain_id: event.chainId,
        protocol_key: event.protocolKey,
        protocol_version: event.protocolVersion,
        token_address: event.tokenAddress.toLowerCase(),
        bonding_curve_address: event.bondingCurveAddress.toLowerCase(),
        graduation_threshold_raw: event.graduationThresholdRaw?.toString(),
        block_number: event.blockNumber,
        block_hash: event.blockHash,
        transaction_hash: event.transactionHash,
        log_index: event.logIndex,
        canonical: event.canonical,
      })
      .onConflictDoUpdate({
        target: [
          launchpadGraduations.chain_id,
          launchpadGraduations.block_hash,
          launchpadGraduations.transaction_hash,
          launchpadGraduations.log_index,
        ],
        set: { canonical: event.canonical, updated_at: new Date() },
      });
  }

  async insertMigration(event: LaunchpadMigration): Promise<void> {
    await this.db
      .insert(launchpadMigrations)
      .values({
        chain_id: event.chainId,
        protocol_key: event.protocolKey,
        protocol_version: event.protocolVersion,
        token_address: event.tokenAddress.toLowerCase(),
        migration_address: event.migrationAddress.toLowerCase(),
        destination_protocol_key: event.destinationProtocolKey,
        destination_pool_address: event.destinationPoolAddress.toLowerCase(),
        token_liquidity_raw: event.tokenLiquidityRaw?.toString(),
        paired_liquidity_raw: event.pairedLiquidityRaw?.toString(),
        block_number: event.blockNumber,
        block_hash: event.blockHash,
        transaction_hash: event.transactionHash,
        log_index: event.logIndex,
        canonical: event.canonical,
      })
      .onConflictDoUpdate({
        target: [
          launchpadMigrations.chain_id,
          launchpadMigrations.block_hash,
          launchpadMigrations.transaction_hash,
          launchpadMigrations.log_index,
        ],
        set: { canonical: event.canonical, updated_at: new Date() },
      });
  }

  async saveQuote(quote: NormalizedQuote): Promise<void> {
    await this.db
      .insert(protocolQuotes)
      .values({
        quote_id: quote.quoteId,
        chain_id: quote.chainId,
        protocol_key: quote.protocolKey,
        protocol_version: quote.protocolVersion,
        input_token_address: quote.inputTokenAddress.toLowerCase(),
        output_token_address: quote.outputTokenAddress.toLowerCase(),
        amount_in_raw: quote.amountInRaw.toString(),
        expected_amount_out_raw: quote.expectedAmountOutRaw.toString(),
        minimum_amount_out_raw: quote.minimumAmountOutRaw.toString(),
        source_block_number: quote.sourceBlockNumber,
        route: quote.route,
        warnings: quote.warnings,
        transaction_target: quote.transactionTarget.toLowerCase(),
        transaction_selector: quote.transactionSelector,
        spender_address: quote.spenderAddress?.toLowerCase(),
        expires_at: new Date(quote.expiresAt),
      })
      .onConflictDoNothing({ target: protocolQuotes.quote_id });
  }

  async markDerivedNonCanonical(
    chainId: number,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<void> {
    const tables = [
      swaps,
      liquidityEvents,
      launchpadTokens,
      launchpadTrades,
      launchpadCreatorFeeEvents,
      launchpadGraduations,
      launchpadMigrations,
    ] as const;
    for (const table of tables) {
      await this.db
        .update(table)
        .set({ canonical: false, updated_at: new Date() })
        .where(
          and(
            eq(table.chain_id, chainId),
            gte(table.block_number, fromBlock),
            lte(table.block_number, toBlock),
            eq(table.canonical, true),
          ),
        );
    }
    await this.db
      .update(pools)
      .set({ canonical: false, active: false, updated_at: new Date() })
      .where(
        and(
          eq(pools.chain_id, chainId),
          gte(pools.created_block, fromBlock),
          lte(pools.created_block, toBlock),
          eq(pools.canonical, true),
        ),
      );
  }

  async listProtocols(chainId: number, kind?: ProtocolKind): Promise<readonly ProtocolSummary[]> {
    const conditions = [eq(dexProtocols.chain_id, chainId)];
    if (kind !== undefined) conditions.push(eq(dexProtocols.kind, kind));
    const rows = await this.db
      .select()
      .from(dexProtocols)
      .where(and(...conditions));
    return rows.map((row) => ({
      chainId: row.chain_id,
      protocolKey: row.protocol_key,
      protocolName: row.protocol_name,
      protocolVersion: row.version,
      kind: row.kind,
      enabled: row.enabled,
      validationStatus: row.validation_status,
      validatedAt: row.validated_at,
      validationExpiresAt: row.validation_expires_at,
    }));
  }

  async listProtocolVerifications(chainId: number): Promise<readonly ProtocolVerificationRecord[]> {
    const rows = await this.db
      .select({ contract: protocolContracts, verification: protocolContractVerifications })
      .from(protocolContractVerifications)
      .innerJoin(
        protocolContracts,
        eq(protocolContractVerifications.protocol_contract_id, protocolContracts.id),
      )
      .where(eq(protocolContractVerifications.chain_id, chainId))
      .orderBy(desc(protocolContractVerifications.checked_at));
    return rows.map(({ contract, verification }) => ({
      chainId: verification.chain_id,
      protocolKey: contract.protocol_key,
      protocolVersion: contract.protocol_version,
      contractRole: contract.contract_role,
      address: contract.address,
      expectedRuntimeBytecodeHash: contract.expected_runtime_bytecode_hash,
      observedRuntimeBytecodeHash: verification.observed_runtime_bytecode_hash,
      valid: verification.valid,
      failureCode: verification.failure_code,
      errors: verification.errors,
      checkedAt: verification.checked_at,
      expiresAt: verification.expires_at,
    }));
  }

  async getPoolsByToken(chainId: number, tokenAddress: string): Promise<readonly NormalizedPool[]> {
    const address = tokenAddress.toLowerCase();
    const rows = await this.db
      .select()
      .from(pools)
      .where(
        and(
          eq(pools.chain_id, chainId),
          eq(pools.canonical, true),
          or(eq(pools.token0_address, address), eq(pools.token1_address, address)),
        ),
      );
    return rows.map((row) => ({
      chainId: row.chain_id,
      protocolKey: row.protocol_key,
      protocolVersion: row.protocol_version,
      poolAddress: getAddress(row.address),
      factoryAddress: getAddress(row.factory_address),
      token0Address: getAddress(row.token0_address),
      token1Address: getAddress(row.token1_address),
      feeTier: row.fee_tier === null ? undefined : BigInt(row.fee_tier),
      tickSpacing: row.tick_spacing ?? undefined,
      poolType: this.poolType(row.pool_type),
      createdBlockNumber: row.created_block,
      createdBlockHash: parseHash(row.created_block_hash),
      creationTransactionHash: parseHash(row.created_tx_hash),
      creationLogIndex: row.creation_log_index,
      canonical: row.canonical,
    }));
  }

  async getActivePools(chainId: number): Promise<readonly NormalizedPool[]> {
    const rows = await this.db
      .select()
      .from(pools)
      .where(and(eq(pools.chain_id, chainId), eq(pools.canonical, true), eq(pools.active, true)));
    return rows.map((row) => ({
      chainId: row.chain_id,
      protocolKey: row.protocol_key,
      protocolVersion: row.protocol_version,
      poolAddress: getAddress(row.address),
      factoryAddress: getAddress(row.factory_address),
      token0Address: getAddress(row.token0_address),
      token1Address: getAddress(row.token1_address),
      feeTier: row.fee_tier === null ? undefined : BigInt(row.fee_tier),
      tickSpacing: row.tick_spacing ?? undefined,
      poolType: this.poolType(row.pool_type),
      createdBlockNumber: row.created_block,
      createdBlockHash: parseHash(row.created_block_hash),
      creationTransactionHash: parseHash(row.created_tx_hash),
      creationLogIndex: row.creation_log_index,
      canonical: row.canonical,
    }));
  }

  async getSwapsByPool(chainId: number, poolAddress: string): Promise<readonly NormalizedSwap[]> {
    const rows = await this.db
      .select()
      .from(swaps)
      .where(
        and(
          eq(swaps.chain_id, chainId),
          eq(swaps.pool_address, poolAddress.toLowerCase()),
          eq(swaps.canonical, true),
        ),
      )
      .orderBy(desc(swaps.block_number), desc(swaps.log_index));
    return rows.map((row) => ({
      chainId: row.chain_id,
      protocolKey: row.protocol_key,
      protocolVersion: row.protocol_version,
      poolAddress: getAddress(row.pool_address),
      transactionHash: parseHash(row.transaction_hash),
      blockNumber: row.block_number,
      blockHash: parseHash(row.block_hash),
      logIndex: row.log_index,
      senderAddress: row.sender_address === null ? undefined : getAddress(row.sender_address),
      recipientAddress:
        row.recipient_address === null ? undefined : getAddress(row.recipient_address),
      tokenInAddress: getAddress(row.token_in_address),
      tokenOutAddress: getAddress(row.token_out_address),
      amountInRaw: BigInt(row.amount_in_raw),
      amountOutRaw: BigInt(row.amount_out_raw),
      feeRaw: row.fee_raw === null ? undefined : BigInt(row.fee_raw),
      canonical: row.canonical,
    }));
  }

  async getLiquidityHistory(
    chainId: number,
    poolAddress: string,
  ): Promise<readonly NormalizedLiquidityEvent[]> {
    const rows = await this.db
      .select()
      .from(liquidityEvents)
      .where(
        and(
          eq(liquidityEvents.chain_id, chainId),
          eq(liquidityEvents.pool_address, poolAddress.toLowerCase()),
          eq(liquidityEvents.canonical, true),
        ),
      )
      .orderBy(desc(liquidityEvents.block_number), desc(liquidityEvents.log_index));
    return rows.map((row) => ({
      chainId: row.chain_id,
      protocolKey: row.protocol_key,
      protocolVersion: row.protocol_version,
      eventType: row.event_type,
      poolAddress: getAddress(row.pool_address),
      ownerAddress: row.owner_address === null ? undefined : getAddress(row.owner_address),
      providerAddress: row.provider_address === null ? undefined : getAddress(row.provider_address),
      recipientAddress:
        row.recipient_address === null ? undefined : getAddress(row.recipient_address),
      token0Address: getAddress(row.token0_address),
      token1Address: getAddress(row.token1_address),
      amount0Raw: BigInt(row.token0_amount_raw),
      amount1Raw: BigInt(row.token1_amount_raw),
      positionId: row.position_id === null ? undefined : BigInt(row.position_id),
      tickLower: row.tick_lower ?? undefined,
      tickUpper: row.tick_upper ?? undefined,
      blockNumber: row.block_number,
      blockHash: parseHash(row.block_hash),
      transactionHash: parseHash(row.transaction_hash),
      logIndex: row.log_index,
      canonical: row.canonical,
    }));
  }

  async getLaunchpadToken(
    chainId: number,
    tokenAddress: string,
  ): Promise<LaunchpadTokenCreated | null> {
    const rows = await this.db
      .select()
      .from(launchpadTokens)
      .where(
        and(
          eq(launchpadTokens.chain_id, chainId),
          eq(launchpadTokens.token_address, tokenAddress.toLowerCase()),
          eq(launchpadTokens.canonical, true),
        ),
      )
      .orderBy(desc(launchpadTokens.block_number))
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? null
      : {
          chainId: row.chain_id,
          protocolKey: row.protocol_key,
          protocolVersion: row.protocol_version,
          tokenAddress: getAddress(row.token_address),
          creatorAddress: getAddress(row.creator_address),
          tokenImplementationAddress:
            row.token_implementation_address === null
              ? undefined
              : getAddress(row.token_implementation_address),
          initialSupplyRaw: BigInt(row.initial_supply_raw),
          bondingCurveAddress:
            row.bonding_curve_address === null ? undefined : getAddress(row.bonding_curve_address),
          blockNumber: row.block_number,
          blockHash: parseHash(row.block_hash),
          transactionHash: parseHash(row.transaction_hash),
          logIndex: row.log_index,
          canonical: row.canonical,
        };
  }

  async getGraduation(chainId: number, tokenAddress: string): Promise<LaunchpadGraduation | null> {
    const rows = await this.db
      .select()
      .from(launchpadGraduations)
      .where(
        and(
          eq(launchpadGraduations.chain_id, chainId),
          eq(launchpadGraduations.token_address, tokenAddress.toLowerCase()),
          eq(launchpadGraduations.canonical, true),
        ),
      )
      .orderBy(desc(launchpadGraduations.block_number))
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? null
      : {
          chainId: row.chain_id,
          protocolKey: row.protocol_key,
          protocolVersion: row.protocol_version,
          tokenAddress: getAddress(row.token_address),
          bondingCurveAddress: getAddress(row.bonding_curve_address),
          graduationThresholdRaw:
            row.graduation_threshold_raw === null
              ? undefined
              : BigInt(row.graduation_threshold_raw),
          blockNumber: row.block_number,
          blockHash: parseHash(row.block_hash),
          transactionHash: parseHash(row.transaction_hash),
          logIndex: row.log_index,
          canonical: row.canonical,
        };
  }

  async getMigration(chainId: number, tokenAddress: string): Promise<LaunchpadMigration | null> {
    const rows = await this.db
      .select()
      .from(launchpadMigrations)
      .where(
        and(
          eq(launchpadMigrations.chain_id, chainId),
          eq(launchpadMigrations.token_address, tokenAddress.toLowerCase()),
          eq(launchpadMigrations.canonical, true),
        ),
      )
      .orderBy(desc(launchpadMigrations.block_number))
      .limit(1);
    const row = rows[0];
    return row === undefined
      ? null
      : {
          chainId: row.chain_id,
          protocolKey: row.protocol_key,
          protocolVersion: row.protocol_version,
          tokenAddress: getAddress(row.token_address),
          migrationAddress: getAddress(row.migration_address),
          destinationProtocolKey: row.destination_protocol_key,
          destinationPoolAddress: getAddress(row.destination_pool_address),
          tokenLiquidityRaw:
            row.token_liquidity_raw === null ? undefined : BigInt(row.token_liquidity_raw),
          pairedLiquidityRaw:
            row.paired_liquidity_raw === null ? undefined : BigInt(row.paired_liquidity_raw),
          blockNumber: row.block_number,
          blockHash: parseHash(row.block_hash),
          transactionHash: parseHash(row.transaction_hash),
          logIndex: row.log_index,
          canonical: row.canonical,
        };
  }

  private async findProtocol(chainId: number, protocolKey: string, protocolVersion: string) {
    const rows = await this.db
      .select({ id: dexProtocols.id })
      .from(dexProtocols)
      .where(
        and(
          eq(dexProtocols.chain_id, chainId),
          eq(dexProtocols.protocol_key, protocolKey),
          eq(dexProtocols.version, protocolVersion),
          eq(dexProtocols.enabled, true),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row === undefined)
      throw new Error(`Protocol ${protocolKey} ${protocolVersion} is inactive`);
    return row;
  }

  private poolType(value: string): NormalizedPool['poolType'] {
    if (
      value === 'constantProduct' ||
      value === 'concentratedLiquidity' ||
      value === 'stableSwap' ||
      value === 'bondingCurve' ||
      value === 'rfq'
    ) {
      return value;
    }
    return 'unknown';
  }
}

export { ProtocolRepository as PoolRepository, ProtocolRepository as SwapRepository };
