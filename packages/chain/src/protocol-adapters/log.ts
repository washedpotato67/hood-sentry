import { getAddress, isAddress, isHash, isHex } from 'viem';
import { z } from 'zod';
import { MalformedProtocolLogError } from './errors.js';
import type { BlockProvenance, RawChainLog } from './types.js';

const rawChainLogSchema = z.object({
  chainId: z.number().int().positive().safe(),
  blockNumber: z.bigint().nonnegative(),
  blockHash: z.string().refine(isHash),
  transactionHash: z.string().refine(isHash),
  transactionIndex: z.number().int().nonnegative(),
  logIndex: z.number().int().nonnegative(),
  address: z
    .string()
    .refine(isAddress)
    .transform((address) => getAddress(address)),
  topics: z.array(z.string().refine(isHex)).min(1).max(4),
  data: z.string().refine(isHex),
  removed: z.boolean(),
  canonical: z.boolean(),
});

export function parseRawChainLog(value: unknown): RawChainLog {
  const result = rawChainLogSchema.safeParse(value);
  if (!result.success) {
    throw new MalformedProtocolLogError('Protocol log failed structural validation');
  }
  return result.data;
}

export function getProvenance(log: RawChainLog): BlockProvenance {
  return {
    chainId: log.chainId,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    transactionIndex: log.transactionIndex,
    logIndex: log.logIndex,
    canonical: log.canonical && !log.removed,
  };
}
