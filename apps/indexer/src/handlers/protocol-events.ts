import type {
  LaunchpadGraduation,
  LaunchpadMigration,
  LaunchpadTokenCreated,
  LaunchpadTrade,
  NormalizedLiquidityEvent,
  NormalizedPool,
  NormalizedProtocolEvent,
  NormalizedSwap,
  ProtocolAdapterManager,
} from '@hood-sentry/chain';
import type { ProtocolRepository } from '@hood-sentry/db';
import type { Logger } from '@hood-sentry/observability';
import type { DerivedJob } from '../types.js';
import { launchpadDerivedJobs } from './launchpad-events.js';
import { liquidityDerivedJobs } from './liquidity-events.js';
import { poolInitializationJobs } from './pool-events.js';
import { swapDerivedJobs } from './swap-events.js';

export interface DerivedJobPublisher {
  publish(job: DerivedJob, idempotencyKey: string): Promise<void>;
}

export class ProtocolEventsHandler {
  constructor(
    private readonly manager: ProtocolAdapterManager,
    private readonly repository: ProtocolRepository,
    private readonly publisher: DerivedJobPublisher,
    private readonly logger: Pick<Logger, 'warn' | 'error'>,
  ) {}

  async handle(rawLog: unknown): Promise<void> {
    try {
      const routed = await this.manager.routeLog(rawLog);
      if (routed?.normalized === null || routed === null) return;
      await this.persist(routed.normalized);
      await this.publishJobs(routed.normalized, this.jobs(routed.normalized));
    } catch (error) {
      this.logger.warn('Skipping malformed or unsupported protocol event', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async persist(event: NormalizedProtocolEvent): Promise<void> {
    if (isPool(event)) return this.repository.upsertPool(event);
    if (isSwap(event)) return this.repository.insertSwap(event);
    if (isLiquidity(event)) return this.repository.insertLiquidityEvent(event);
    if (isLaunchpadToken(event)) return this.repository.insertLaunchpadToken(event);
    if (isLaunchpadTrade(event)) {
      await this.repository.insertLaunchpadTrade(event);
      await this.repository.insertCreatorFeeEvent(event);
      return;
    }
    if (isGraduation(event)) return this.repository.insertGraduation(event);
    if (isMigration(event)) return this.repository.insertMigration(event);
  }

  private jobs(event: NormalizedProtocolEvent): readonly DerivedJob[] {
    if (isPool(event)) return poolInitializationJobs(event);
    if (isSwap(event)) return swapDerivedJobs(event);
    if (isLiquidity(event)) return liquidityDerivedJobs(event);
    if (
      isLaunchpadToken(event) ||
      isLaunchpadTrade(event) ||
      isGraduation(event) ||
      isMigration(event)
    ) {
      return launchpadDerivedJobs(event);
    }
    return [];
  }

  private async publishJobs(
    event: NormalizedProtocolEvent,
    jobs: readonly DerivedJob[],
  ): Promise<void> {
    const transactionHash = isPool(event) ? event.creationTransactionHash : event.transactionHash;
    const logIndex = isPool(event) ? event.creationLogIndex : event.logIndex;
    const blockHash = isPool(event) ? event.createdBlockHash : event.blockHash;
    for (const job of jobs) {
      const key = `${event.chainId}:${blockHash}:${transactionHash}:${logIndex}:${job.type}`;
      try {
        await this.publisher.publish(job, key);
      } catch (error) {
        this.logger.error('Failed to publish protocol-derived job', {
          jobType: job.type,
          idempotencyKey: key,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  }
}

function isPool(event: NormalizedProtocolEvent): event is NormalizedPool {
  return 'createdBlockNumber' in event;
}

function isSwap(event: NormalizedProtocolEvent): event is NormalizedSwap {
  return 'amountInRaw' in event && 'tokenInAddress' in event;
}

function isLiquidity(event: NormalizedProtocolEvent): event is NormalizedLiquidityEvent {
  return 'eventType' in event;
}

function isLaunchpadToken(event: NormalizedProtocolEvent): event is LaunchpadTokenCreated {
  return 'initialSupplyRaw' in event;
}

function isLaunchpadTrade(event: NormalizedProtocolEvent): event is LaunchpadTrade {
  return 'side' in event;
}

function isGraduation(event: NormalizedProtocolEvent): event is LaunchpadGraduation {
  return 'graduationThresholdRaw' in event;
}

function isMigration(event: NormalizedProtocolEvent): event is LaunchpadMigration {
  return 'destinationPoolAddress' in event;
}
