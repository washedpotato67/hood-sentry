import type { PricingRepository } from '@hood-sentry/db';
import type { Logger } from '@hood-sentry/observability';
import { type DerivedJobPublisher, derivedJobIdempotencyKey } from '@hood-sentry/queue';
import type { Hash } from 'viem';
import type { DerivedJob } from './types.js';

export interface ChainlinkJobProducerDependencies {
  chainId: number;
  repository: PricingRepository;
  publisher: DerivedJobPublisher;
  logger: Pick<Logger, 'warn' | 'debug'>;
}

/**
 * Emits `new-price-observation` derived jobs for every enabled Chainlink feed
 * on each indexed block. This keeps oracle-backed prices fresh independently of
 * on-chain DEX activity.
 */
export class ChainlinkJobProducer {
  constructor(private readonly deps: ChainlinkJobProducerDependencies) {}

  async publishJobsForBlock(blockNumber: bigint, blockHash: Hash): Promise<void> {
    const configs = await this.deps.repository.listSourceConfigs(this.deps.chainId);
    const enabledChainlink = configs.filter(
      (config): config is typeof config & { sourceContractAddress: `0x${string}` } =>
        config.enabled &&
        config.sourceType === 'chainlink' &&
        config.sourceContractAddress !== null &&
        config.oracleHeartbeatSeconds !== undefined,
    );

    if (enabledChainlink.length === 0) {
      this.deps.logger.debug('No enabled Chainlink sources to publish', {
        blockNumber: blockNumber.toString(),
      });
      return;
    }

    for (const config of enabledChainlink) {
      const job: DerivedJob = {
        type: 'new-price-observation',
        chainId: BigInt(this.deps.chainId),
        blockNumber,
        blockHash,
        data: {
          sourceKey: config.sourceKey,
          sourceContractAddress: config.sourceContractAddress,
          sourceAssetAddress: config.sourceAssetAddress,
          quoteAssetAddress: config.quoteAssetAddress,
          oracleHeartbeatSeconds: config.oracleHeartbeatSeconds,
          sequencerFeedAddress: config.sequencerFeedAddress,
        },
      };

      const idempotencyKey = derivedJobIdempotencyKey({
        type: job.type,
        chainId: job.chainId,
        blockHash: job.blockHash,
        sourceKey: config.sourceKey,
      });

      try {
        await this.deps.publisher.publish(job, idempotencyKey);
      } catch (error) {
        this.deps.logger.warn('Failed to publish Chainlink price observation job', {
          sourceKey: config.sourceKey,
          blockNumber: blockNumber.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  }
}
