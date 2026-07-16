import { evaluateChainAlertRule } from '@hood-sentry/alert-engine';
import { schema } from '@hood-sentry/db';
import type { DerivedJobPayload } from '@hood-sentry/queue';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { ProcessorContext } from './types.js';

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const unsignedIntegerSchema = z.string().regex(/^[0-9]+$/);
const eventDataSchema = z
  .object({
    eventType: z.string().min(1).max(100),
    transactionHash: hashSchema,
    logIndex: z.number().int().nonnegative(),
    tokenAddress: addressSchema.optional(),
    token0Address: addressSchema.optional(),
    token1Address: addressSchema.optional(),
    poolAddress: addressSchema.optional(),
    fromAddress: addressSchema.optional(),
    toAddress: addressSchema.optional(),
    ownerAddress: addressSchema.optional(),
    spenderAddress: addressSchema.optional(),
    valueRaw: unsignedIntegerSchema.optional(),
    protocolKey: z.string().min(1).max(100).optional(),
    protocolVersion: z.string().min(1).max(100).optional(),
  })
  .passthrough();

function targetAddresses(data: z.infer<typeof eventDataSchema>): readonly string[] {
  return [
    data.tokenAddress,
    data.token0Address,
    data.token1Address,
    data.poolAddress,
    data.fromAddress,
    data.toAddress,
    data.ownerAddress,
    data.spenderAddress,
  ]
    .filter((value): value is string => value !== undefined)
    .map((value) => value.toLowerCase());
}

export async function processAlertEvaluation(
  payload: DerivedJobPayload,
  context: ProcessorContext,
): Promise<void> {
  const data = eventDataSchema.parse(payload.data);
  const chainId = z.coerce.number().int().positive().parse(payload.chainId);
  const blockNumber = BigInt(unsignedIntegerSchema.parse(payload.blockNumber));
  const blockHash = hashSchema.parse(payload.blockHash).toLowerCase();
  const targets = [...new Set(targetAddresses(data))];
  if (targets.length === 0) return;

  const blocks = await context.database.db
    .select({ timestamp: schema.blocks.timestamp })
    .from(schema.blocks)
    .where(
      and(
        eq(schema.blocks.chainId, BigInt(chainId)),
        eq(schema.blocks.number, blockNumber),
        eq(schema.blocks.hash, blockHash),
        eq(schema.blocks.canonical, true),
      ),
    )
    .limit(1);
  const sourceBlock = blocks[0];
  if (sourceBlock === undefined) return;

  const rules = await context.database.db
    .select()
    .from(schema.alertRules)
    .where(
      and(
        eq(schema.alertRules.chainId, chainId),
        inArray(schema.alertRules.targetAddress, targets),
        eq(schema.alertRules.enabled, true),
        isNull(schema.alertRules.deletedAt),
      ),
    );

  for (const rule of rules) {
    let decision: ReturnType<typeof evaluateChainAlertRule>;
    try {
      decision = evaluateChainAlertRule(
        {
          ruleType: rule.ruleType,
          targetAddress: rule.targetAddress,
          condition: rule.condition,
        },
        {
          eventType: data.eventType,
          targetAddresses: targets,
          tokenAddress: data.tokenAddress,
          fromAddress: data.fromAddress,
          toAddress: data.toAddress,
          valueRaw: data.valueRaw,
        },
      );
    } catch {
      context.logger.warn('Skipping alert rule with an invalid condition', {
        alertRuleId: rule.id,
      });
      continue;
    }
    if (decision === null) continue;
    await context.database.db
      .insert(schema.alertEvents)
      .values({
        alertRuleId: rule.id,
        chainId,
        blockNumber,
        blockHash,
        transactionHash: data.transactionHash.toLowerCase(),
        logIndex: data.logIndex,
        triggeredAt: sourceBlock.timestamp,
        severity: decision.severity,
        metadata: {
          methodologyVersion: 'alert-evaluator-v1',
          evidence: decision.evidence,
          eventType: data.eventType,
          tokenAddress: data.tokenAddress?.toLowerCase() ?? null,
          poolAddress: data.poolAddress?.toLowerCase() ?? null,
          protocolKey: data.protocolKey ?? null,
          protocolVersion: data.protocolVersion ?? null,
          blockHash,
          logIndex: data.logIndex,
        },
        resolvedAt: null,
      })
      .onConflictDoNothing();

    const events = await context.database.db
      .select()
      .from(schema.alertEvents)
      .where(
        and(
          eq(schema.alertEvents.alertRuleId, rule.id),
          eq(schema.alertEvents.chainId, chainId),
          eq(schema.alertEvents.blockHash, blockHash),
          eq(schema.alertEvents.transactionHash, data.transactionHash.toLowerCase()),
          eq(schema.alertEvents.logIndex, data.logIndex),
        ),
      )
      .limit(1);
    const event = events[0];
    if (event !== undefined) {
      if (context.alertDelivery === undefined) {
        throw new Error('ALERT_DELIVERY_SERVICE_NOT_CONFIGURED');
      }
      await context.alertDelivery.deliver(event, rule);
    }
  }
}
