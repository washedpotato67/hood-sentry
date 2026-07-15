import { sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';

/** Mints originate here; it is a supply sink, not a holder. */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// biome-ignore lint/suspicious/noExplicitAny: drizzle's transaction generics are not exported in a usable form
type Tx = PgTransaction<any, any, any>;

/**
 * Recomputes `token_balances` for the given addresses from canonical transfer history.
 *
 * Recomputing rather than applying a delta is what makes this safe under
 * at-least-once delivery: a redelivered job recomputes the same sum instead of
 * double-counting, and a reorg that flips transfers non-canonical is picked up on the
 * next projection without any compensating write.
 *
 * `as_of_block` records the highest canonical transfer block that fed the balance, so
 * a risk scan can tell whether the balance describes the chain at its pinned block.
 */
export async function projectTokenBalances(
  tx: Tx,
  input: { chainId: number; tokenAddress: string; addresses: readonly string[] },
): Promise<void> {
  const token = input.tokenAddress.toLowerCase();
  const addresses = [
    ...new Set(
      input.addresses.map((address) => address.toLowerCase()).filter((a) => a !== ZERO_ADDRESS),
    ),
  ];
  if (addresses.length === 0) return;

  // Each address is bound individually: passing the array as one parameter makes the
  // driver hand Postgres a malformed array literal.
  const holders = sql.join(
    addresses.map((address) => sql`${address}`),
    sql`, `,
  );

  await tx.execute(sql`
    INSERT INTO token_balances (chain_id, token_address, wallet_address, balance_raw, as_of_block)
    SELECT
      ${input.chainId},
      ${token},
      holder.address,
      COALESCE(SUM(CASE WHEN t.to_address = holder.address THEN t.amount_raw ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN t.from_address = holder.address THEN t.amount_raw ELSE 0 END), 0),
      COALESCE(MAX(t.block_number), 0)
    FROM unnest(ARRAY[${holders}]::text[]) AS holder(address)
    LEFT JOIN token_transfers t
      ON t.chain_id = ${input.chainId}
     AND t.token_address = ${token}
     AND t.canonical = true
     AND (t.from_address = holder.address OR t.to_address = holder.address)
    GROUP BY holder.address
    ON CONFLICT (chain_id, token_address, wallet_address) DO UPDATE
      SET balance_raw = excluded.balance_raw,
          as_of_block = excluded.as_of_block,
          updated_at = NOW()
  `);
}
