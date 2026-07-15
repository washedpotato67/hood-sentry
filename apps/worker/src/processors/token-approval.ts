import { schema } from '@hood-sentry/db';
import type { DerivedJobPayload } from '@hood-sentry/queue';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ProcessorContext } from './types.js';

const ADDRESS = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'expected a 20-byte address');
const HASH = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 32-byte hash');
const UINT = z.string().regex(/^[0-9]+$/, 'expected an unsigned decimal string');

const tokenApprovalData = z.object({
  tokenAddress: ADDRESS,
  ownerAddress: ADDRESS,
  spenderAddress: ADDRESS,
  transactionHash: HASH,
  logIndex: z.number().int().nonnegative(),
  valueRaw: UINT,
});

/**
 * Records the current ERC-20 allowance for an (owner, token, spender).
 *
 * Unlike a transfer, an approval is state rather than an event: the row holds the
 * latest allowance. Jobs are delivered at least once and processed concurrently, so
 * the write only lands when it is strictly newer in (block, log_index) order. A
 * redelivered or out-of-order job is therefore a no-op rather than a rollback to a
 * stale allowance.
 */
export async function processTokenApproval(
  payload: DerivedJobPayload,
  context: ProcessorContext,
): Promise<void> {
  const data = tokenApprovalData.parse(payload.data);

  await context.database.db
    .insert(schema.tokenApprovals)
    .values({
      chain_id: Number(payload.chainId),
      owner_address: data.ownerAddress.toLowerCase(),
      token_address: data.tokenAddress.toLowerCase(),
      spender_address: data.spenderAddress.toLowerCase(),
      allowance_raw: data.valueRaw,
      last_updated_block: BigInt(payload.blockNumber),
      last_updated_log_index: data.logIndex,
    })
    .onConflictDoUpdate({
      target: [
        schema.tokenApprovals.chain_id,
        schema.tokenApprovals.owner_address,
        schema.tokenApprovals.token_address,
        schema.tokenApprovals.spender_address,
      ],
      set: {
        allowance_raw: sql`excluded.allowance_raw`,
        last_updated_block: sql`excluded.last_updated_block`,
        last_updated_log_index: sql`excluded.last_updated_log_index`,
        updated_at: sql`NOW()`,
      },
      setWhere: sql`(${schema.tokenApprovals.last_updated_block}, ${schema.tokenApprovals.last_updated_log_index}) < (excluded.last_updated_block, excluded.last_updated_log_index)`,
    });
}
