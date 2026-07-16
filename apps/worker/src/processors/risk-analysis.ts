import type { DerivedJobPayload } from '@hood-sentry/queue';
import { getAddress, isAddress } from 'viem';
import { z } from 'zod';
import type { ProcessorContext } from './types.js';

const addressSchema = z
  .string()
  .refine(isAddress, 'expected a 20-byte address')
  .transform((address) => getAddress(address));

const riskAnalysisPayloadSchema = z.object({
  type: z.literal('risk-analysis'),
  chainId: z.coerce.number().int().positive().safe(),
  blockNumber: z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/, 'expected an unsigned decimal string')
    .transform((value) => BigInt(value)),
  blockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'expected a 32-byte hash'),
  data: z
    .object({
      protocolKey: z.string().trim().min(1),
      protocolVersion: z.string().trim().min(1),
      poolAddress: addressSchema.optional(),
      tokenAddress: addressSchema.optional(),
      token0Address: addressSchema.optional(),
      token1Address: addressSchema.optional(),
      eventType: z.string().trim().min(1).optional(),
    })
    .superRefine((data, context) => {
      if (data.poolAddress === undefined && data.tokenAddress === undefined) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: 'risk target is missing' });
      }
      if ((data.token0Address === undefined) !== (data.token1Address === undefined)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'pool token addresses must be supplied together',
        });
      }
    }),
});

type Target = {
  type: 'token' | 'pool' | 'launchpad_token';
  chainId: number;
  address: `0x${string}`;
};

function targets(input: z.infer<typeof riskAnalysisPayloadSchema>): readonly Target[] {
  const values: Target[] = [];
  if (input.data.poolAddress !== undefined) {
    values.push({ type: 'pool', chainId: input.chainId, address: input.data.poolAddress });
  }
  if (input.data.tokenAddress !== undefined) {
    values.push({
      type: 'launchpad_token',
      chainId: input.chainId,
      address: input.data.tokenAddress,
    });
  }
  for (const address of [input.data.token0Address, input.data.token1Address]) {
    if (address !== undefined) values.push({ type: 'token', chainId: input.chainId, address });
  }

  const unique = new Map(values.map((target) => [`${target.type}:${target.address}`, target]));
  return [...unique.values()];
}

export async function processRiskAnalysis(
  payload: DerivedJobPayload,
  context: Pick<ProcessorContext, 'riskAnalysis' | 'riskAlerts'>,
): Promise<void> {
  const input = riskAnalysisPayloadSchema.parse(payload);
  const trigger = ['liquidityRemoved', 'lpBurned', 'positionDecreased'].includes(
    input.data.eventType ?? '',
  )
    ? 'liquidity_removal'
    : input.data.poolAddress !== undefined
      ? 'pool_creation'
      : 'new_token';

  for (const target of targets(input)) {
    const run = await context.riskAnalysis.run({
      target,
      sourceBlock: input.blockNumber,
      sourceBlockHash: input.blockHash,
      trigger,
    });
    await context.riskAlerts.evaluate({
      chainId: target.chainId,
      targetAddress: target.address,
      sourceBlock: input.blockNumber,
      sourceBlockHash: input.blockHash,
      run,
    });
  }
}
