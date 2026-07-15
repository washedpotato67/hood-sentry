import { schema } from '@hood-sentry/db';
import type { DerivedJobPayload } from '@hood-sentry/queue';
import { z } from 'zod';
import type { ProcessorContext } from './types.js';

const ADDRESS = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'expected a 20-byte address');
const HASH = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 32-byte hash');

const contractCreationData = z.object({
  contractAddress: ADDRESS,
  creatorAddress: ADDRESS,
  transactionHash: HASH,
});

/**
 * Records a newly deployed contract.
 *
 * Creation is immutable for an address, so a replay must not overwrite the row:
 * later enrichment (bytecode, proxy analysis, verification) owns those columns.
 */
export async function processContractCreation(
  payload: DerivedJobPayload,
  context: ProcessorContext,
): Promise<void> {
  const data = contractCreationData.parse(payload.data);

  await context.database.db
    .insert(schema.contracts)
    .values({
      chain_id: Number(payload.chainId),
      address: data.contractAddress.toLowerCase(),
      creator_address: data.creatorAddress.toLowerCase(),
      creation_tx_hash: data.transactionHash.toLowerCase(),
      creation_block: BigInt(payload.blockNumber),
    })
    .onConflictDoNothing();
}
