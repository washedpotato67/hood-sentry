import { z } from 'zod';

export const ORACLE_OBSERVATION_SOURCE = 'oracle_observation_state';

export interface OracleBehaviorResult {
  readonly applicable: boolean;
  readonly sourceKey: string | null;
  readonly answerRaw: bigint | null;
  readonly decimals: number | null;
  readonly roundId: bigint | null;
  readonly answeredInRound: bigint | null;
  readonly updatedAtSeconds: bigint | null;
  readonly scanTimeSeconds: bigint | null;
  readonly heartbeatSeconds: number | null;
  readonly oraclePaused: boolean;
  readonly sequencerConfigured: boolean;
  readonly sequencerUp: boolean | null;
  readonly sequencerRecoveredAtSeconds: bigint | null;
  readonly sourceBlock: bigint;
}

const bigintString = z
  .string()
  .regex(/^-?\d+$/)
  .transform((v) => BigInt(v));

const serializedSchema = z.object({
  applicable: z.boolean(),
  sourceKey: z.string().nullable(),
  answerRaw: bigintString.nullable(),
  decimals: z.number().int().nullable(),
  roundId: bigintString.nullable(),
  answeredInRound: bigintString.nullable(),
  updatedAtSeconds: bigintString.nullable(),
  scanTimeSeconds: bigintString.nullable(),
  heartbeatSeconds: z.number().int().nullable(),
  oraclePaused: z.boolean(),
  sequencerConfigured: z.boolean(),
  sequencerUp: z.boolean().nullable(),
  sequencerRecoveredAtSeconds: bigintString.nullable(),
  sourceBlock: bigintString,
});

export type SerializedOracleBehaviorResult = z.input<typeof serializedSchema>;

const s = (v: bigint | null): string | null => (v === null ? null : v.toString());

export function serializeOracleResult(r: OracleBehaviorResult): SerializedOracleBehaviorResult {
  return {
    applicable: r.applicable,
    sourceKey: r.sourceKey,
    answerRaw: s(r.answerRaw),
    decimals: r.decimals,
    roundId: s(r.roundId),
    answeredInRound: s(r.answeredInRound),
    updatedAtSeconds: s(r.updatedAtSeconds),
    scanTimeSeconds: s(r.scanTimeSeconds),
    heartbeatSeconds: r.heartbeatSeconds,
    oraclePaused: r.oraclePaused,
    sequencerConfigured: r.sequencerConfigured,
    sequencerUp: r.sequencerUp,
    sequencerRecoveredAtSeconds: s(r.sequencerRecoveredAtSeconds),
    sourceBlock: r.sourceBlock.toString(),
  };
}

export function deserializeOracleResult(v: unknown): OracleBehaviorResult {
  return serializedSchema.parse(v);
}
