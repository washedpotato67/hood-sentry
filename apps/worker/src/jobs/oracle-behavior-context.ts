import type { PricingRepository } from '@hood-sentry/db';
import {
  ORACLE_OBSERVATION_SOURCE,
  type OracleBehaviorResult,
  type RiskDataSource,
  type RiskScanContext,
  serializeOracleResult,
} from '@hood-sentry/risk-engine';
import type { RiskContextLoader, RiskScanJobInput } from './risk-scan.js';

/** Targets whose address is a token that may carry a pinned oracle price feed. */
const ORACLE_TARGETS = new Set(['token', 'launchpad_token']);

export interface OracleObservationLoadInput {
  chainId: number;
  tokenAddress: string;
  sourceBlock: bigint;
  scanTimeSeconds: bigint;
}

/**
 * Maps the pinned price-source configuration plus the latest Chainlink observation
 * into the risk engine's oracle behavior result. Kept as a port so the loader can be
 * tested without a database.
 */
export interface OracleObservationSource {
  load(input: OracleObservationLoadInput): Promise<OracleBehaviorResult>;
}

function baseResult(input: OracleObservationLoadInput): OracleBehaviorResult {
  return {
    applicable: false,
    sourceKey: null,
    answerRaw: null,
    decimals: null,
    roundId: null,
    answeredInRound: null,
    updatedAtSeconds: null,
    scanTimeSeconds: input.scanTimeSeconds,
    heartbeatSeconds: null,
    oraclePaused: false,
    sequencerConfigured: false,
    sequencerUp: null,
    sequencerRecoveredAtSeconds: null,
    sourceBlock: input.sourceBlock,
  };
}

/**
 * Reads the pinned Chainlink price-source config for a token and, when one exists,
 * the latest oracle observation on record for it.
 *
 * `findLatestOracleStatus` returns the most recently observed row rather than one
 * filtered to `sourceBlock`, so an observation recorded at a block after the scan's
 * pinned block is not yet canonical evidence for this scan: it is treated the same
 * as "no observation yet" rather than surfaced as the answer. The oracle *is* still
 * reported applicable in that case, since the source config was read successfully;
 * only the answer fields (round, price, pause/sequencer state) are withheld.
 */
export class DrizzleOracleObservationSource implements OracleObservationSource {
  constructor(
    private readonly repository: Pick<
      PricingRepository,
      'listSourceConfigs' | 'findLatestOracleStatus'
    >,
  ) {}

  async load(input: OracleObservationLoadInput): Promise<OracleBehaviorResult> {
    const configs = await this.repository.listSourceConfigs(input.chainId, input.tokenAddress);
    const oracleConfig = configs.find(
      (config) =>
        config.sourceType === 'chainlink' &&
        config.enabled &&
        config.sourceContractAddress !== null,
    );
    const base = baseResult(input);
    if (oracleConfig === undefined) return base;

    const heartbeatSeconds = oracleConfig.oracleHeartbeatSeconds ?? null;
    const sequencerConfigured =
      oracleConfig.sequencerFeedAddress !== undefined && oracleConfig.sequencerFeedAddress !== null;
    const configured: OracleBehaviorResult = {
      ...base,
      applicable: true,
      sourceKey: oracleConfig.sourceKey,
      heartbeatSeconds,
      sequencerConfigured,
    };

    const observation = await this.repository.findLatestOracleStatus(
      input.chainId,
      input.tokenAddress,
      oracleConfig.quoteAssetAddress,
    );
    if (observation === null) return configured;
    if (
      observation.sourceBlockNumber !== null &&
      observation.sourceBlockNumber > input.sourceBlock
    ) {
      return configured;
    }

    return {
      ...configured,
      answerRaw: observation.priceRaw,
      decimals: observation.priceDecimals,
      roundId: observation.roundId ?? null,
      answeredInRound: observation.answeredInRound ?? null,
      updatedAtSeconds: BigInt(Math.floor(Date.parse(observation.sourceTimestamp) / 1000)),
      oraclePaused: observation.oraclePaused ?? false,
      sequencerUp: observation.sequencerUp ?? null,
      sequencerRecoveredAtSeconds: observation.sequencerRecoveredAt ?? null,
    };
  }
}

/**
 * Appends the pinned oracle behavior result to the risk context so the oracle rule
 * family has round/pause/sequencer evidence to evaluate.
 */
export class OracleBehaviorContextLoader implements RiskContextLoader {
  constructor(
    private readonly inner: RiskContextLoader,
    private readonly source: OracleObservationSource,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async loadContext(input: RiskScanJobInput, methodologyVersion: string): Promise<RiskScanContext> {
    const context = await this.inner.loadContext(input, methodologyVersion);
    if (!ORACLE_TARGETS.has(context.target.type)) return context;

    const result = await this.source.load({
      chainId: context.target.chainId,
      tokenAddress: context.target.address,
      sourceBlock: context.sourceBlock,
      scanTimeSeconds: BigInt(Math.floor(this.now().getTime() / 1_000)),
    });
    const dataSource: RiskDataSource = {
      key: ORACLE_OBSERVATION_SOURCE,
      kind: 'database',
      provider: 'pricing_repository',
      status: 'available',
      sourceBlock: context.sourceBlock,
      sourceBlockHash: context.sourceBlockHash,
      fetchedAt: this.now().toISOString(),
      reason: null,
    };
    return {
      ...context,
      data: { ...context.data, [ORACLE_OBSERVATION_SOURCE]: serializeOracleResult(result) },
      dataSources: [
        ...context.dataSources.filter((source) => source.key !== ORACLE_OBSERVATION_SOURCE),
        dataSource,
      ],
    };
  }
}
