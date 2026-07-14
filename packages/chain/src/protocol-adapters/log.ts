import { getAddress, isAddress, isHash, isHex } from 'viem';
import { z } from 'zod';
import { MalformedProtocolLogError } from './errors.js';
import type { BlockProvenance, ProtocolLog } from './types.js';

const protocolLogSchema = z.object({
  chainId: z.number().int().positive().safe(),
  blockNumber: z.bigint().nonnegative(),
  blockHash: z.string().refine(isHash),
  transactionHash: z.string().refine(isHash),
  logIndex: z.number().int().nonnegative(),
  address: z
    .string()
    .refine(isAddress)
    .transform((address) => getAddress(address)),
  topics: z.array(z.string().refine(isHex)).min(1),
  data: z.string().refine(isHex),
});

export function parseProtocolLog(value: unknown): ProtocolLog {
  const result = protocolLogSchema.safeParse(value);
  if (!result.success) {
    throw new MalformedProtocolLogError('Protocol log failed structural validation');
  }
  return result.data;
}

export function getProvenance(log: ProtocolLog): BlockProvenance {
  return {
    chainId: log.chainId,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
  };
}
