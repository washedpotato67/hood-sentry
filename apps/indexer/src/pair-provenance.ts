import type { Logger } from '@hood-sentry/observability';

/** keccak256("PairCreated(address,address,address,uint256)") */
export const PAIR_CREATED_TOPIC =
  '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9';

/** The explorer answers at most ten addresses per request. */
const ADDRESSES_PER_REQUEST = 10;

export interface PairProvenance {
  address: `0x${string}`;
  createdBlock: bigint;
  createdTxHash: string;
  createdBlockHash: string;
  creationLogIndex: number;
  factoryAddress: string;
}

interface ReceiptReader {
  getTransactionReceipt(hash: string): Promise<unknown>;
}

interface CreationRecord {
  contractAddress: string;
  blockNumber: string;
  txHash: string;
  contractFactory: string | null;
}

interface ReceiptRecord {
  blockHash: string;
  logs: { address: string; topics: string[]; logIndex: number }[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function readCreations(payload: unknown): CreationRecord[] {
  const body = asRecord(payload);
  const result = body?.result;
  if (!Array.isArray(result)) return [];
  const records: CreationRecord[] = [];
  for (const entry of result) {
    const row = asRecord(entry);
    if (row === null) continue;
    const { contractAddress, blockNumber, txHash, contractFactory } = row;
    if (
      typeof contractAddress !== 'string' ||
      typeof blockNumber !== 'string' ||
      typeof txHash !== 'string'
    ) {
      continue;
    }
    records.push({
      contractAddress,
      blockNumber,
      txHash,
      contractFactory: typeof contractFactory === 'string' ? contractFactory : null,
    });
  }
  return records;
}

function readReceipt(payload: unknown): ReceiptRecord | null {
  const row = asRecord(payload);
  if (row === null || typeof row.blockHash !== 'string' || !Array.isArray(row.logs)) return null;
  const logs: ReceiptRecord['logs'] = [];
  for (const entry of row.logs) {
    const log = asRecord(entry);
    if (log === null || typeof log.address !== 'string' || !Array.isArray(log.topics)) continue;
    const topics = log.topics.filter((topic): topic is string => typeof topic === 'string');
    const logIndex = Number(log.logIndex);
    if (!Number.isFinite(logIndex)) continue;
    logs.push({ address: log.address, topics, logIndex });
  }
  return { blockHash: row.blockHash, logs };
}

/**
 * Recovers where a pool came from, for pools the indexer never watched being
 * created.
 *
 * The factory's registry lists which pairs exist but not when any of them
 * appeared, and the creating block is required to record one. The chain's
 * explorer already indexes contract creation, and the transaction it names is
 * checked against the chain itself: the receipt supplies the block hash and the
 * position of the creation event. Nothing here is inferred from a timestamp or
 * filled with a placeholder, so a pair the explorer cannot account for is left
 * out rather than recorded with invented provenance.
 */
export class BlockscoutPairProvenance {
  constructor(
    private readonly explorer: { apiBaseUrl: string; apiKey?: string; fetchRequest?: typeof fetch },
    private readonly receipts: ReceiptReader,
    private readonly logger: Pick<Logger, 'warn'>,
  ) {}

  async lookup(addresses: readonly `0x${string}`[]): Promise<ReadonlyMap<string, PairProvenance>> {
    const found = new Map<string, PairProvenance>();
    const fetchRequest = this.explorer.fetchRequest ?? fetch;

    for (let offset = 0; offset < addresses.length; offset += ADDRESSES_PER_REQUEST) {
      const chunk = addresses.slice(offset, offset + ADDRESSES_PER_REQUEST);
      const url = new URL(this.explorer.apiBaseUrl);
      url.searchParams.set('module', 'contract');
      url.searchParams.set('action', 'getcontractcreation');
      url.searchParams.set('contractaddresses', chunk.join(','));
      if (this.explorer.apiKey !== undefined) url.searchParams.set('apikey', this.explorer.apiKey);

      let creations: CreationRecord[];
      try {
        const response = await fetchRequest(url.toString(), {
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`explorer responded ${response.status}`);
        creations = readCreations(await response.json());
      } catch (error) {
        this.logger.warn('Could not read pair creation from the explorer', {
          count: chunk.length,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      for (const creation of creations) {
        const resolved = await this.resolve(creation);
        if (resolved !== null) found.set(resolved.address.toLowerCase(), resolved);
      }
    }

    return found;
  }

  private async resolve(creation: CreationRecord): Promise<PairProvenance | null> {
    try {
      const receipt = readReceipt(await this.receipts.getTransactionReceipt(creation.txHash));
      if (receipt === null) return null;
      const factory = (creation.contractFactory ?? '').toLowerCase();
      const event = receipt.logs.find(
        (log) =>
          log.topics[0]?.toLowerCase() === PAIR_CREATED_TOPIC &&
          (factory === '' || log.address.toLowerCase() === factory),
      );
      if (event === undefined) {
        // Without the creation event there is no honest log index to record.
        this.logger.warn('Creation transaction carries no pair creation event', {
          address: creation.contractAddress,
          txHash: creation.txHash,
        });
        return null;
      }
      return {
        address: creation.contractAddress as `0x${string}`,
        createdBlock: BigInt(creation.blockNumber),
        createdTxHash: creation.txHash,
        createdBlockHash: receipt.blockHash,
        creationLogIndex: event.logIndex,
        factoryAddress: factory,
      };
    } catch (error) {
      this.logger.warn('Could not confirm pair creation against the chain', {
        address: creation.contractAddress,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
