import { schema } from '@hood-sentry/db';
import type { DerivedJobPayload } from '@hood-sentry/queue';
import { z } from 'zod';
import type { ProcessorContext } from './types.js';

const ADDRESS = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'expected a 20-byte address');
const HASH = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 32-byte hash');
const UINT = z.string().regex(/^[0-9]+$/, 'expected an unsigned decimal string');

const tokenTransferData = z.object({
  tokenAddress: ADDRESS,
  fromAddress: ADDRESS,
  toAddress: ADDRESS,
  transactionHash: HASH,
  logIndex: z.number().int().nonnegative(),
  valueRaw: UINT,
});

/**
 * Records an ERC-20 Transfer.
 *
 * (chain, transaction, log index) is the natural key of the emitting log, and the
 * table is unique on it, so a redelivered job collapses onto the existing row.
 */
export async function processTokenTransfer(
  payload: DerivedJobPayload,
  context: ProcessorContext,
): Promise<void> {
  const data = tokenTransferData.parse(payload.data);

  await context.database.db
    .insert(schema.tokenTransfers)
    .values({
      chain_id: Number(payload.chainId),
      block_number: BigInt(payload.blockNumber),
      block_hash: payload.blockHash,
      transaction_hash: data.transactionHash.toLowerCase(),
      log_index: data.logIndex,
      token_address: data.tokenAddress.toLowerCase(),
      from_address: data.fromAddress.toLowerCase(),
      to_address: data.toAddress.toLowerCase(),
      amount_raw: data.valueRaw,
    })
    .onConflictDoNothing();
}
