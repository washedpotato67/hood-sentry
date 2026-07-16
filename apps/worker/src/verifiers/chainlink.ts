import type { OracleClient } from '@hood-sentry/chain';
import type {
  PriceSourceConfig,
  SourceContractVerification,
  SourceContractVerifier,
} from '@hood-sentry/market-engine';

export interface ChainlinkSourceVerifierOptions {
  oracleClient: OracleClient;
}

/**
 * Verifies a Chainlink price feed source before it is activated.
 *
 * Checks performed:
 * - the configured feed contract has non-zero runtime code;
 * - `decimals()` and `latestRoundData()` are callable without reverting;
 * - the source is on the expected chain (enforced by the OracleClient/RPCClient).
 *
 * A future enhancement can compare the runtime bytecode hash against an independently
 * verified Chainlink aggregator template once one is published. Until then, callability
 * and non-zero code are the deterministic gates.
 */
export class ChainlinkSourceVerifier implements SourceContractVerifier {
  constructor(private readonly options: ChainlinkSourceVerifierOptions) {}

  async verify(config: PriceSourceConfig): Promise<SourceContractVerification> {
    const checkedAt = new Date().toISOString();

    if (config.sourceContractAddress === null) {
      return {
        verified: false,
        checkedAt,
        reason: 'Chainlink source requires a verified feed contract address',
      };
    }

    try {
      const code = await this.options.oracleClient.getCode(config.sourceContractAddress);
      if (code === '0x' || code.length <= 2) {
        return {
          verified: false,
          checkedAt,
          reason: `No runtime code at feed address ${config.sourceContractAddress}`,
        };
      }

      // Attempting to read the feed proves the selectors and return shapes match
      // the Chainlink AggregatorV3Interface. Any revert or malformed response fails activation.
      await this.options.oracleClient.readPriceFeed(config.sourceContractAddress);

      if (config.sequencerFeedAddress !== undefined && config.sequencerFeedAddress !== null) {
        const sequencerCode = await this.options.oracleClient.getCode(config.sequencerFeedAddress);
        if (sequencerCode === '0x' || sequencerCode.length <= 2) {
          return {
            verified: false,
            checkedAt,
            reason: `No runtime code at sequencer feed address ${config.sequencerFeedAddress}`,
          };
        }
        await this.options.oracleClient.readSequencerFeed(config.sequencerFeedAddress);
      }

      return {
        verified: true,
        checkedAt,
        reason: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        verified: false,
        checkedAt,
        reason: `Feed verification call failed: ${message}`,
      };
    }
  }
}
