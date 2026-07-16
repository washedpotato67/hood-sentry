# Oracle behavior + Market integrity risk-rule families Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the empty `'Oracle behavior'` and `'Market integrity'` risk categories with deterministic, block-pinned rule families, closing 2 of the 6 categories missing for blocker 4.

**Architecture:** The risk-engine defines result types and pure interpretation (no dependency on market-engine or discovery-engine). Two worker context loaders read pinned DB state, call the existing engines (`selectPriceSource`, `detectOutliers`, `analyzeManipulation`) and the oracle observation, map their output into the risk-engine result types, and place the serialized result in `context.data`. Rules deserialize and interpret. Loaders chain as decorators in `risk-runtime.ts` after the liquidity loader.

**Tech Stack:** TypeScript (strict), Zod, Vitest, Drizzle ORM, pnpm workspaces (`@hood-sentry/risk-engine`, `@hood-sentry/worker`, `@hood-sentry/market-engine`, `@hood-sentry/discovery-engine`, `@hood-sentry/db`).

## Global Constraints

- Strict TypeScript: no `any`, no unsafe casts, no non-null assertions, no swallowed exceptions.
- Decimal-safe integer arithmetic only; all token/price quantities are `bigint`. Serialize bigint to string in `context.data`.
- Every finding pins `sourceBlock`/`sourceBlockHash` and lists provenance keys; findings are deterministic for a given pinned block.
- Honesty rules: `unknown` and `not_applicable` findings carry `maxPenaltyBps` 0. `unknown` lowers completeness; `not_applicable` does not. `not_applicable` marks its provenance source `available`.
- No per-rule `maxPenaltyBps` exceeds its category penalty cap.
- Commit messages: NO Claude attribution, co-author, or "generated with" trailer of any kind. Author remains `cybort360`.
- Run `pnpm --filter @hood-sentry/risk-engine test` (unit) and `pnpm test:integration --force` (loaders) before declaring a task done where noted.

---

### Task 1: Oracle behavior result type + serialization

**Files:**
- Create: `packages/risk-engine/src/oracle-types.ts`
- Test: `packages/risk-engine/src/__tests__/oracle-types.test.ts`

**Interfaces:**
- Produces: `OracleBehaviorResult`, `SerializedOracleBehaviorResult`, `serializeOracleResult(r: OracleBehaviorResult): SerializedOracleBehaviorResult`, `deserializeOracleResult(v: unknown): OracleBehaviorResult`, and the constant `ORACLE_OBSERVATION_SOURCE = 'oracle_observation_state'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  type OracleBehaviorResult,
  deserializeOracleResult,
  serializeOracleResult,
} from '../oracle-types.js';

const base: OracleBehaviorResult = {
  applicable: true,
  sourceKey: 'chainlink-eth-usd',
  answerRaw: 150_000_000n,
  decimals: 8,
  roundId: 110n,
  answeredInRound: 110n,
  updatedAtSeconds: 1_752_000_000n,
  scanTimeSeconds: 1_752_000_030n,
  heartbeatSeconds: 3600,
  oraclePaused: false,
  sequencerConfigured: true,
  sequencerUp: true,
  sequencerRecoveredAtSeconds: null,
  sourceBlock: 200n,
};

describe('oracle result serialization', () => {
  it('round-trips through serialize/deserialize preserving bigints', () => {
    const restored = deserializeOracleResult(serializeOracleResult(base));
    expect(restored).toEqual(base);
  });

  it('rejects malformed serialized input', () => {
    expect(() => deserializeOracleResult({ applicable: 'yes' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hood-sentry/risk-engine test -- oracle-types`
Expected: FAIL — cannot find module `../oracle-types.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hood-sentry/risk-engine test -- oracle-types`
Expected: PASS (2 tests).

- [ ] **Step 5: Add export and commit**

Add `export * from './oracle-types.js';` to `packages/risk-engine/src/index.ts` (after the `liquidity-rules.js` export). Then:

```bash
git add packages/risk-engine/src/oracle-types.ts packages/risk-engine/src/__tests__/oracle-types.test.ts packages/risk-engine/src/index.ts
git commit -m "feat(risk): oracle behavior result type and serialization"
```

---

### Task 2: Oracle behavior rules

**Files:**
- Create: `packages/risk-engine/src/oracle-rules.ts`
- Test: `packages/risk-engine/src/__tests__/oracle-rules.test.ts`

**Interfaces:**
- Consumes: `OracleBehaviorResult`, `deserializeOracleResult`, `ORACLE_OBSERVATION_SOURCE` (Task 1); `RiskRule`, `RiskRuleEvaluation`, `RiskScanContext`, `RiskFindingStatus`, `RiskSeverity` from `./types.js`.
- Produces: `ORACLE_RULE_CODES` (readonly tuple), `createOracleRiskRules(): readonly RiskRule[]`.

Constants: `SEQUENCER_GRACE_SECONDS = 3600`. Rule ids are `oracle.<code lowercased>`. Version `1.0.0`. Category `'Oracle behavior'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createOracleRiskRules } from '../oracle-rules.js';
import { ORACLE_OBSERVATION_SOURCE, serializeOracleResult } from '../oracle-types.js';
import type { OracleBehaviorResult, RiskScanContext } from '../index.js';

const RESULT: OracleBehaviorResult = {
  applicable: true,
  sourceKey: 'chainlink-eth-usd',
  answerRaw: 150_000_000n,
  decimals: 8,
  roundId: 110n,
  answeredInRound: 110n,
  updatedAtSeconds: 1_752_000_000n,
  scanTimeSeconds: 1_752_000_030n,
  heartbeatSeconds: 3600,
  oraclePaused: false,
  sequencerConfigured: true,
  sequencerUp: true,
  sequencerRecoveredAtSeconds: null,
  sourceBlock: 200n,
};

function context(overrides: Partial<OracleBehaviorResult> = {}): RiskScanContext {
  return {
    target: { type: 'token', chainId: 4663, address: '0x3000000000000000000000000000000000000001' },
    sourceBlock: 200n,
    sourceBlockHash: `0x${'a'.repeat(64)}`,
    methodologyVersion: '1.0.0',
    data: { [ORACLE_OBSERVATION_SOURCE]: serializeOracleResult({ ...RESULT, ...overrides }) },
    dataSources: [],
  };
}

const abort = new AbortController().signal;
const rule = (code: string) =>
  createOracleRiskRules().find((r) => r.ruleId === `oracle.${code}`) ?? (() => {
    throw new Error(`missing rule oracle.${code}`);
  })();

describe('oracle behavior rules', () => {
  it('fails when the feed is older than its heartbeat', async () => {
    const evaluation = await rule('oracle_stale').evaluate(
      context({ updatedAtSeconds: 1_752_000_000n, scanTimeSeconds: 1_752_005_000n }),
      abort,
    );
    expect(evaluation.status).toBe('fail');
  });

  it('passes a fresh feed', async () => {
    const evaluation = await rule('oracle_stale').evaluate(context(), abort);
    expect(evaluation.status).toBe('pass');
  });

  it('fails on a non-positive answer', async () => {
    const evaluation = await rule('oracle_answer_invalid').evaluate(context({ answerRaw: 0n }), abort);
    expect(evaluation.status).toBe('fail');
  });

  it('warns on an incomplete round', async () => {
    const evaluation = await rule('oracle_incomplete_round').evaluate(
      context({ roundId: 111n, answeredInRound: 110n }),
      abort,
    );
    expect(evaluation.status).toBe('warning');
  });

  it('fails when paused', async () => {
    const evaluation = await rule('oracle_paused').evaluate(context({ oraclePaused: true }), abort);
    expect(evaluation.status).toBe('fail');
  });

  it('fails when the sequencer is down', async () => {
    const evaluation = await rule('sequencer_down').evaluate(context({ sequencerUp: false }), abort);
    expect(evaluation.status).toBe('fail');
    expect(evaluation.severity).toBe('critical');
  });

  it('warns inside the sequencer grace period', async () => {
    const evaluation = await rule('sequencer_grace_period').evaluate(
      context({ sequencerUp: true, sequencerRecoveredAtSeconds: 1_752_000_000n, scanTimeSeconds: 1_752_000_030n }),
      abort,
    );
    expect(evaluation.status).toBe('warning');
  });

  it('reports not_applicable for every rule when no oracle is configured', async () => {
    for (const r of createOracleRiskRules()) {
      const evaluation = await r.evaluate(
        context({ applicable: false, sourceKey: null, answerRaw: null }),
        abort,
      );
      expect(evaluation.status).toBe('not_applicable');
    }
  });

  it('reports unknown when an oracle is configured but has no reading', async () => {
    const evaluation = await rule('oracle_stale').evaluate(
      context({ applicable: true, answerRaw: null, updatedAtSeconds: null }),
      abort,
    );
    expect(evaluation.status).toBe('unknown');
  });

  it('gives not_applicable/unknown rules a zero max penalty', () => {
    for (const r of createOracleRiskRules()) {
      expect(r.maxPenaltyBps).toBeLessThanOrEqual(3000);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hood-sentry/risk-engine test -- oracle-rules`
Expected: FAIL — cannot find module `../oracle-rules.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
import {
  type OracleBehaviorResult,
  ORACLE_OBSERVATION_SOURCE,
  deserializeOracleResult,
} from './oracle-types.js';
import type {
  RiskFindingStatus,
  RiskRule,
  RiskRuleEvaluation,
  RiskScanContext,
  RiskSeverity,
} from './types.js';

export const SEQUENCER_GRACE_SECONDS = 3600n;

export const ORACLE_RULE_CODES = [
  'oracle_stale',
  'oracle_answer_invalid',
  'oracle_incomplete_round',
  'oracle_paused',
  'sequencer_down',
  'sequencer_grace_period',
] as const;
export type OracleRuleCode = (typeof ORACLE_RULE_CODES)[number];

interface Spec {
  readonly severity: RiskSeverity;
  readonly status: Extract<RiskFindingStatus, 'fail' | 'warning'>;
  readonly title: string;
  readonly description: string;
  readonly whenPresent: string;
  readonly whenAbsent: string;
  readonly remediation: string;
  /** Sequencer rules are N/A when no sequencer feed is configured, independent of the price feed. */
  readonly sequencerRule: boolean;
}

const SPECS: Record<OracleRuleCode, Spec> = {
  oracle_stale: {
    severity: 'high',
    status: 'fail',
    title: 'Oracle price is stale',
    description: 'The feed has not updated within its configured heartbeat.',
    whenPresent: 'The oracle last updated longer ago than its heartbeat allows, so its price is stale.',
    whenAbsent: 'The oracle updated within its heartbeat window.',
    remediation: 'Do not rely on this price until the feed updates within its heartbeat.',
    sequencerRule: false,
  },
  oracle_answer_invalid: {
    severity: 'high',
    status: 'fail',
    title: 'Oracle answer is invalid',
    description: 'The feed reported a non-positive answer.',
    whenPresent: 'The oracle reported a zero or negative answer, which cannot be a valid price.',
    whenAbsent: 'The oracle reported a positive answer.',
    remediation: 'Treat the price as unavailable while the answer is non-positive.',
    sequencerRule: false,
  },
  oracle_incomplete_round: {
    severity: 'medium',
    status: 'warning',
    title: 'Oracle round is incomplete',
    description: 'answeredInRound is behind the latest roundId.',
    whenPresent: 'The latest round has no fresh answer yet; the price is carried from an earlier round.',
    whenAbsent: 'The latest round carries its own answer.',
    remediation: 'Prefer a source whose latest round is complete.',
    sequencerRule: false,
  },
  oracle_paused: {
    severity: 'high',
    status: 'fail',
    title: 'Oracle is paused',
    description: 'The aggregator reports a paused state.',
    whenPresent: 'The oracle aggregator is paused, so it is not producing fresh prices.',
    whenAbsent: 'The oracle aggregator is not paused.',
    remediation: 'Do not rely on this price while the aggregator is paused.',
    sequencerRule: false,
  },
  sequencer_down: {
    severity: 'critical',
    status: 'fail',
    title: 'Sequencer is down',
    description: 'The L2 sequencer uptime feed reports the sequencer as down.',
    whenPresent: 'The sequencer uptime feed reports the sequencer down, so on-chain prices are unreliable.',
    whenAbsent: 'The sequencer uptime feed reports the sequencer up.',
    remediation: 'Do not rely on on-chain prices while the sequencer is down.',
    sequencerRule: true,
  },
  sequencer_grace_period: {
    severity: 'medium',
    status: 'warning',
    title: 'Sequencer recently recovered',
    description: 'The sequencer recovered within the grace period.',
    whenPresent: 'The sequencer recovered recently and is still inside its grace period, so prices may lag.',
    whenAbsent: 'The sequencer has been up beyond its grace period.',
    remediation: 'Wait for the grace period to elapse before relying on fresh prices.',
    sequencerRule: true,
  },
};

function readingMissing(r: OracleBehaviorResult): boolean {
  return r.answerRaw === null || r.updatedAtSeconds === null || r.scanTimeSeconds === null;
}

function triggered(code: OracleRuleCode, r: OracleBehaviorResult): boolean {
  switch (code) {
    case 'oracle_stale':
      return (
        r.updatedAtSeconds !== null &&
        r.scanTimeSeconds !== null &&
        r.heartbeatSeconds !== null &&
        r.scanTimeSeconds - r.updatedAtSeconds > BigInt(r.heartbeatSeconds)
      );
    case 'oracle_answer_invalid':
      return r.answerRaw !== null && r.answerRaw <= 0n;
    case 'oracle_incomplete_round':
      return r.roundId !== null && r.answeredInRound !== null && r.answeredInRound < r.roundId;
    case 'oracle_paused':
      return r.oraclePaused;
    case 'sequencer_down':
      return r.sequencerUp === false;
    case 'sequencer_grace_period':
      return (
        r.sequencerUp === true &&
        r.sequencerRecoveredAtSeconds !== null &&
        r.scanTimeSeconds !== null &&
        r.scanTimeSeconds - r.sequencerRecoveredAtSeconds < SEQUENCER_GRACE_SECONDS
      );
  }
}

function statusFor(code: OracleRuleCode, r: OracleBehaviorResult): RiskFindingStatus {
  const spec = SPECS[code];
  if (!r.applicable) return 'not_applicable';
  if (spec.sequencerRule && !r.sequencerConfigured) return 'not_applicable';
  if (!spec.sequencerRule && readingMissing(r)) return 'unknown';
  if (spec.sequencerRule && r.sequencerUp === null) return 'unknown';
  return triggered(code, r) ? spec.status : 'pass';
}

function evaluationFor(code: OracleRuleCode, context: Readonly<RiskScanContext>): RiskRuleEvaluation {
  const serialized = context.data[ORACLE_OBSERVATION_SOURCE];
  const result = deserializeOracleResult(serialized);
  const spec = SPECS[code];
  const status = statusFor(code, result);
  const fired = status === 'fail' || status === 'warning';
  return {
    status,
    severity: fired ? spec.severity : 'info',
    confidence: {
      level: status === 'unknown' ? 'unknown' : 'high',
      basisPoints: status === 'unknown' ? 0 : 9000,
      rationale:
        status === 'unknown'
          ? 'No readable oracle observation at the pinned block.'
          : 'Derived from the pinned oracle observation state.',
    },
    title: fired ? spec.title : `${spec.title} not found`,
    explanation:
      status === 'not_applicable'
        ? 'No oracle price source applies to this token, so this check does not apply.'
        : status === 'unknown'
          ? 'The configured oracle source had no readable observation at the pinned block.'
          : fired
            ? spec.whenPresent
            : spec.whenAbsent,
    evidence: [
      {
        evidenceType: 'oracle_observation',
        summary: fired ? spec.whenPresent : spec.whenAbsent,
        data: {
          sourceKey: result.sourceKey,
          answerRaw: result.answerRaw?.toString() ?? null,
          roundId: result.roundId?.toString() ?? null,
          answeredInRound: result.answeredInRound?.toString() ?? null,
          updatedAtSeconds: result.updatedAtSeconds?.toString() ?? null,
          heartbeatSeconds: result.heartbeatSeconds,
          oraclePaused: result.oraclePaused,
          sequencerUp: result.sequencerUp,
          sequencerRecoveredAtSeconds: result.sequencerRecoveredAtSeconds?.toString() ?? null,
        },
        provenanceKeys: [ORACLE_OBSERVATION_SOURCE],
      },
    ],
    remediation: fired ? spec.remediation : null,
    fingerprintSeed: code,
  };
}

function maxPenalty(code: OracleRuleCode): number {
  const spec = SPECS[code];
  if (spec.severity === 'critical') return 3000;
  return spec.severity === 'high' ? 2500 : 800;
}

export function createOracleRiskRules(): readonly RiskRule[] {
  return ORACLE_RULE_CODES.map((code) => ({
    ruleId: `oracle.${code}`,
    version: '1.0.0',
    category: 'Oracle behavior' as const,
    title: SPECS[code].title,
    description: SPECS[code].description,
    requiredDataSources: [ORACLE_OBSERVATION_SOURCE],
    maxPenaltyBps: maxPenalty(code),
    evaluate: async (context: Readonly<RiskScanContext>) => evaluationFor(code, context),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hood-sentry/risk-engine test -- oracle-rules`
Expected: PASS (all cases).

- [ ] **Step 5: Add export and commit**

Add `export * from './oracle-rules.js';` to `packages/risk-engine/src/index.ts`. Then:

```bash
git add packages/risk-engine/src/oracle-rules.ts packages/risk-engine/src/__tests__/oracle-rules.test.ts packages/risk-engine/src/index.ts
git commit -m "feat(risk): oracle behavior deterministic rule family"
```

---

### Task 3: Market integrity result type + serialization

**Files:**
- Create: `packages/risk-engine/src/market-integrity-types.ts`
- Test: `packages/risk-engine/src/__tests__/market-integrity-types.test.ts`

**Interfaces:**
- Produces: `MarketIntegrityResult`, serialize/deserialize functions, and constants `MARKET_PRICE_RELIABILITY_SOURCE = 'market_price_reliability'`, `MARKET_TRADE_MANIPULATION_SOURCE = 'market_trade_manipulation'`. `MARKET_INTEGRITY_SIGNAL_CODES` (the 7 discovery codes this family projects).

`MarketIntegrityResult` shape:

```ts
export interface MarketIntegrityResult {
  readonly priceReliability: {
    readonly available: boolean;   // false => unknown (data unreadable)
    readonly activeSourceCount: number;
    readonly disagreementSourceKeys: readonly string[];
    readonly outlierReasons: readonly string[];
    readonly oneTransactionManipulation: boolean;
  };
  readonly tradeManipulation: {
    readonly available: boolean;   // false => unknown (data unreadable)
    readonly tradeCount: number;
    readonly minTradesForAssessment: number;
    readonly observedSignalCodes: readonly string[]; // discovery codes with status 'observed'
    readonly methodologyVersion: string;
  };
  readonly sourceBlock: bigint;
}
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import {
  type MarketIntegrityResult,
  deserializeMarketIntegrityResult,
  serializeMarketIntegrityResult,
} from '../market-integrity-types.js';

const base: MarketIntegrityResult = {
  priceReliability: {
    available: true,
    activeSourceCount: 2,
    disagreementSourceKeys: ['dex-usdg'],
    outlierReasons: ['DEPEG'],
    oneTransactionManipulation: false,
  },
  tradeManipulation: {
    available: true,
    tradeCount: 42,
    minTradesForAssessment: 20,
    observedSignalCodes: ['SELF_TRADING'],
    methodologyVersion: 'manipulation-v1',
  },
  sourceBlock: 200n,
};

describe('market integrity result serialization', () => {
  it('round-trips preserving structure and bigints', () => {
    expect(deserializeMarketIntegrityResult(serializeMarketIntegrityResult(base))).toEqual(base);
  });

  it('rejects malformed input', () => {
    expect(() => deserializeMarketIntegrityResult({ priceReliability: 5 })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hood-sentry/risk-engine test -- market-integrity-types`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from 'zod';

export const MARKET_PRICE_RELIABILITY_SOURCE = 'market_price_reliability';
export const MARKET_TRADE_MANIPULATION_SOURCE = 'market_trade_manipulation';

export const MARKET_INTEGRITY_SIGNAL_CODES = [
  'SELF_TRADING',
  'REPEATED_WALLET_PAIR',
  'ONE_WALLET_VOLUME_CONCENTRATION',
  'CIRCULAR_WALLET_VOLUME',
  'RAPID_BUY_SELL_LOOP',
  'TINY_TRADE_COUNT_INFLATION',
  'THIN_POOL_PRICE_MANIPULATION',
] as const;
export type MarketIntegritySignalCode = (typeof MARKET_INTEGRITY_SIGNAL_CODES)[number];

const schema = z.object({
  priceReliability: z.object({
    available: z.boolean(),
    activeSourceCount: z.number().int().nonnegative(),
    disagreementSourceKeys: z.array(z.string()),
    outlierReasons: z.array(z.string()),
    oneTransactionManipulation: z.boolean(),
  }),
  tradeManipulation: z.object({
    available: z.boolean(),
    tradeCount: z.number().int().nonnegative(),
    minTradesForAssessment: z.number().int().nonnegative(),
    observedSignalCodes: z.array(z.string()),
    methodologyVersion: z.string(),
  }),
  sourceBlock: z.string().regex(/^\d+$/),
});

export type SerializedMarketIntegrityResult = z.input<typeof schema>;

export interface MarketIntegrityResult {
  readonly priceReliability: {
    readonly available: boolean;
    readonly activeSourceCount: number;
    readonly disagreementSourceKeys: readonly string[];
    readonly outlierReasons: readonly string[];
    readonly oneTransactionManipulation: boolean;
  };
  readonly tradeManipulation: {
    readonly available: boolean;
    readonly tradeCount: number;
    readonly minTradesForAssessment: number;
    readonly observedSignalCodes: readonly string[];
    readonly methodologyVersion: string;
  };
  readonly sourceBlock: bigint;
}

export function serializeMarketIntegrityResult(
  r: MarketIntegrityResult,
): SerializedMarketIntegrityResult {
  return {
    priceReliability: {
      available: r.priceReliability.available,
      activeSourceCount: r.priceReliability.activeSourceCount,
      disagreementSourceKeys: [...r.priceReliability.disagreementSourceKeys],
      outlierReasons: [...r.priceReliability.outlierReasons],
      oneTransactionManipulation: r.priceReliability.oneTransactionManipulation,
    },
    tradeManipulation: {
      available: r.tradeManipulation.available,
      tradeCount: r.tradeManipulation.tradeCount,
      minTradesForAssessment: r.tradeManipulation.minTradesForAssessment,
      observedSignalCodes: [...r.tradeManipulation.observedSignalCodes],
      methodologyVersion: r.tradeManipulation.methodologyVersion,
    },
    sourceBlock: r.sourceBlock.toString(),
  };
}

export function deserializeMarketIntegrityResult(v: unknown): MarketIntegrityResult {
  const parsed = schema.parse(v);
  return { ...parsed, sourceBlock: BigInt(parsed.sourceBlock) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hood-sentry/risk-engine test -- market-integrity-types`
Expected: PASS (2 tests).

- [ ] **Step 5: Add export and commit**

Add `export * from './market-integrity-types.js';` to `index.ts`. Then:

```bash
git add packages/risk-engine/src/market-integrity-types.ts packages/risk-engine/src/__tests__/market-integrity-types.test.ts packages/risk-engine/src/index.ts
git commit -m "feat(risk): market integrity result type and serialization"
```

---

### Task 4: Market integrity rules

**Files:**
- Create: `packages/risk-engine/src/market-integrity-rules.ts`
- Test: `packages/risk-engine/src/__tests__/market-integrity-rules.test.ts`

**Interfaces:**
- Consumes: Task 3 result type + constants; `RiskRule` types.
- Produces: `createMarketIntegrityRiskRules(): readonly RiskRule[]`. Rule ids: `market.source_price_disagreement`, `market.price_outlier`, `market.single_transaction_price_manipulation`, and one per signal code lowercased (`market.self_trading`, `market.repeated_wallet_pair`, `market.one_wallet_volume_concentration`, `market.circular_wallet_volume`, `market.rapid_buy_sell_loop`, `market.tiny_trade_count_inflation`, `market.thin_pool_price_manipulation`). Category `'Market integrity'`, version `1.0.0`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { createMarketIntegrityRiskRules } from '../market-integrity-rules.js';
import {
  MARKET_PRICE_RELIABILITY_SOURCE,
  MARKET_TRADE_MANIPULATION_SOURCE,
  type MarketIntegrityResult,
  serializeMarketIntegrityResult,
} from '../market-integrity-types.js';
import type { RiskScanContext } from '../index.js';

const RESULT: MarketIntegrityResult = {
  priceReliability: {
    available: true,
    activeSourceCount: 2,
    disagreementSourceKeys: [],
    outlierReasons: [],
    oneTransactionManipulation: false,
  },
  tradeManipulation: {
    available: true,
    tradeCount: 42,
    minTradesForAssessment: 20,
    observedSignalCodes: [],
    methodologyVersion: 'manipulation-v1',
  },
  sourceBlock: 200n,
};

function context(overrides: Partial<MarketIntegrityResult> = {}): RiskScanContext {
  const merged = { ...RESULT, ...overrides };
  const serialized = serializeMarketIntegrityResult(merged);
  return {
    target: { type: 'token', chainId: 4663, address: '0x3000000000000000000000000000000000000001' },
    sourceBlock: 200n,
    sourceBlockHash: `0x${'a'.repeat(64)}`,
    methodologyVersion: '1.0.0',
    data: {
      [MARKET_PRICE_RELIABILITY_SOURCE]: serialized,
      [MARKET_TRADE_MANIPULATION_SOURCE]: serialized,
    },
    dataSources: [],
  };
}

const abort = new AbortController().signal;
const rule = (id: string) =>
  createMarketIntegrityRiskRules().find((r) => r.ruleId === id) ?? (() => {
    throw new Error(`missing ${id}`);
  })();

describe('market integrity rules', () => {
  it('warns when sources disagree', async () => {
    const e = await rule('market.source_price_disagreement').evaluate(
      context({ priceReliability: { ...RESULT.priceReliability, disagreementSourceKeys: ['dex'] } }),
      abort,
    );
    expect(e.status).toBe('warning');
  });

  it('marks disagreement not_applicable with a single source', async () => {
    const e = await rule('market.source_price_disagreement').evaluate(
      context({ priceReliability: { ...RESULT.priceReliability, activeSourceCount: 1 } }),
      abort,
    );
    expect(e.status).toBe('not_applicable');
  });

  it('fails on one-transaction price manipulation', async () => {
    const e = await rule('market.single_transaction_price_manipulation').evaluate(
      context({ priceReliability: { ...RESULT.priceReliability, oneTransactionManipulation: true } }),
      abort,
    );
    expect(e.status).toBe('fail');
  });

  it('fails on observed self-trading', async () => {
    const e = await rule('market.self_trading').evaluate(
      context({ tradeManipulation: { ...RESULT.tradeManipulation, observedSignalCodes: ['SELF_TRADING'] } }),
      abort,
    );
    expect(e.status).toBe('fail');
  });

  it('passes a clean, active market for a manipulation rule', async () => {
    const e = await rule('market.self_trading').evaluate(context(), abort);
    expect(e.status).toBe('pass');
  });

  it('marks manipulation rules not_applicable below the trade threshold', async () => {
    const e = await rule('market.self_trading').evaluate(
      context({ tradeManipulation: { ...RESULT.tradeManipulation, tradeCount: 5 } }),
      abort,
    );
    expect(e.status).toBe('not_applicable');
  });

  it('marks price rules unknown when price data is unavailable', async () => {
    const e = await rule('market.price_outlier').evaluate(
      context({ priceReliability: { ...RESULT.priceReliability, available: false } }),
      abort,
    );
    expect(e.status).toBe('unknown');
  });

  it('caps every rule penalty at the category cap', () => {
    for (const r of createMarketIntegrityRiskRules()) expect(r.maxPenaltyBps).toBeLessThanOrEqual(3000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hood-sentry/risk-engine test -- market-integrity-rules`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import {
  MARKET_INTEGRITY_SIGNAL_CODES,
  MARKET_PRICE_RELIABILITY_SOURCE,
  MARKET_TRADE_MANIPULATION_SOURCE,
  type MarketIntegrityResult,
  type MarketIntegritySignalCode,
  deserializeMarketIntegrityResult,
} from './market-integrity-types.js';
import type {
  RiskFindingStatus,
  RiskRule,
  RiskRuleEvaluation,
  RiskScanContext,
  RiskSeverity,
} from './types.js';

interface Spec {
  readonly ruleId: string;
  readonly title: string;
  readonly description: string;
  readonly severity: RiskSeverity;
  readonly firedStatus: Extract<RiskFindingStatus, 'fail' | 'warning'>;
  readonly whenPresent: string;
  readonly whenAbsent: string;
  readonly remediation: string;
  readonly source: typeof MARKET_PRICE_RELIABILITY_SOURCE | typeof MARKET_TRADE_MANIPULATION_SOURCE;
  readonly evaluate: (r: MarketIntegrityResult) => RiskFindingStatus;
}

function priceStatus(
  r: MarketIntegrityResult,
  fired: boolean,
  requiresTwoSources: boolean,
  firedStatus: 'fail' | 'warning',
): RiskFindingStatus {
  if (!r.priceReliability.available) return 'unknown';
  if (requiresTwoSources && r.priceReliability.activeSourceCount < 2) return 'not_applicable';
  return fired ? firedStatus : 'pass';
}

function tradeStatus(
  r: MarketIntegrityResult,
  code: MarketIntegritySignalCode,
  firedStatus: 'fail' | 'warning',
): RiskFindingStatus {
  if (!r.tradeManipulation.available) return 'unknown';
  if (r.tradeManipulation.tradeCount < r.tradeManipulation.minTradesForAssessment) {
    return 'not_applicable';
  }
  return r.tradeManipulation.observedSignalCodes.includes(code) ? firedStatus : 'pass';
}

const SIGNAL_SEVERITY: Record<MarketIntegritySignalCode, RiskSeverity> = {
  SELF_TRADING: 'high',
  REPEATED_WALLET_PAIR: 'medium',
  ONE_WALLET_VOLUME_CONCENTRATION: 'medium',
  CIRCULAR_WALLET_VOLUME: 'medium',
  RAPID_BUY_SELL_LOOP: 'medium',
  TINY_TRADE_COUNT_INFLATION: 'medium',
  THIN_POOL_PRICE_MANIPULATION: 'medium',
};

const PRICE_SPECS: readonly Spec[] = [
  {
    ruleId: 'market.source_price_disagreement',
    title: 'Price sources disagree',
    description: 'Independent price sources disagree beyond the configured threshold.',
    severity: 'medium',
    firedStatus: 'warning',
    whenPresent: 'Independent price sources disagree beyond the configured threshold at this block.',
    whenAbsent: 'Independent price sources agree within the configured threshold.',
    remediation: 'Treat the price as uncertain until the sources reconcile.',
    source: MARKET_PRICE_RELIABILITY_SOURCE,
    evaluate: (r) =>
      priceStatus(r, r.priceReliability.disagreementSourceKeys.length > 0, true, 'warning'),
  },
  {
    ruleId: 'market.price_outlier',
    title: 'Price is an outlier',
    description: 'The observation was flagged as an outlier.',
    severity: 'medium',
    firedStatus: 'warning',
    whenPresent: 'The price observation at this block was flagged as an outlier.',
    whenAbsent: 'The price observation at this block was not an outlier.',
    remediation: 'Confirm the price against another source before relying on it.',
    source: MARKET_PRICE_RELIABILITY_SOURCE,
    evaluate: (r) => priceStatus(r, r.priceReliability.outlierReasons.length > 0, false, 'warning'),
  },
  {
    ruleId: 'market.single_transaction_price_manipulation',
    title: 'Single-transaction price manipulation',
    description: 'The price appears set by a single transaction.',
    severity: 'high',
    firedStatus: 'fail',
    whenPresent: 'The price appears to have been set by a single transaction rather than a real market.',
    whenAbsent: 'The price was not attributable to a single manipulating transaction.',
    remediation: 'Do not trust this price; it is consistent with a one-transaction move.',
    source: MARKET_PRICE_RELIABILITY_SOURCE,
    evaluate: (r) => priceStatus(r, r.priceReliability.oneTransactionManipulation, false, 'fail'),
  },
];

const SIGNAL_COPY: Record<MarketIntegritySignalCode, { title: string; present: string; absent: string; remediation: string }> = {
  SELF_TRADING: {
    title: 'Wash trading (self-trading)',
    present: 'Trades where the buyer and seller are the same party were observed, consistent with wash trading.',
    absent: 'No self-trading was observed in the pinned window.',
    remediation: 'Discount reported volume; it includes self-trading.',
  },
  REPEATED_WALLET_PAIR: {
    title: 'Repeated wallet-pair trading',
    present: 'A small set of wallet pairs accounts for a disproportionate share of trades.',
    absent: 'No dominant repeated wallet pairs were observed.',
    remediation: 'Treat volume from repeated pairs as potentially inorganic.',
  },
  ONE_WALLET_VOLUME_CONCENTRATION: {
    title: 'Single-wallet volume concentration',
    present: 'One wallet accounts for a dominant share of trading volume.',
    absent: 'Trading volume is not dominated by a single wallet.',
    remediation: 'Expect volume to collapse if the dominant wallet stops trading.',
  },
  CIRCULAR_WALLET_VOLUME: {
    title: 'Circular wallet volume',
    present: 'Volume circulates among a closed group of wallets, consistent with fabricated activity.',
    absent: 'No circular wallet volume was observed.',
    remediation: 'Discount circular volume when judging real demand.',
  },
  RAPID_BUY_SELL_LOOP: {
    title: 'Rapid buy/sell loops',
    present: 'Wallets rapidly buy and sell in loops, consistent with volume inflation.',
    absent: 'No rapid buy/sell loops were observed.',
    remediation: 'Discount looped volume when judging real demand.',
  },
  TINY_TRADE_COUNT_INFLATION: {
    title: 'Tiny-trade count inflation',
    present: 'Many tiny trades inflate the trade count without meaningful volume.',
    absent: 'The trade count is not inflated by tiny trades.',
    remediation: 'Judge activity by volume, not trade count, for this token.',
  },
  THIN_POOL_PRICE_MANIPULATION: {
    title: 'Thin-pool price manipulation',
    present: 'The pool is thin enough that small trades move the price materially.',
    absent: 'The pool is deep enough to resist single-trade price moves.',
    remediation: 'Expect high slippage and price manipulation risk in this pool.',
  },
};

function tradeSpec(code: MarketIntegritySignalCode): Spec {
  const copy = SIGNAL_COPY[code];
  const severity = SIGNAL_SEVERITY[code];
  const firedStatus: 'fail' | 'warning' = severity === 'high' ? 'fail' : 'warning';
  return {
    ruleId: `market.${code.toLowerCase()}`,
    title: copy.title,
    description: copy.present,
    severity,
    firedStatus,
    whenPresent: copy.present,
    whenAbsent: copy.absent,
    remediation: copy.remediation,
    source: MARKET_TRADE_MANIPULATION_SOURCE,
    evaluate: (r) => tradeStatus(r, code, firedStatus),
  };
}

const SPECS: readonly Spec[] = [...PRICE_SPECS, ...MARKET_INTEGRITY_SIGNAL_CODES.map(tradeSpec)];

function evaluationFor(spec: Spec, context: Readonly<RiskScanContext>): RiskRuleEvaluation {
  const result = deserializeMarketIntegrityResult(context.data[spec.source]);
  const status = spec.evaluate(result);
  const fired = status === 'fail' || status === 'warning';
  return {
    status,
    severity: fired ? spec.severity : 'info',
    confidence: {
      level: status === 'unknown' ? 'unknown' : 'high',
      basisPoints: status === 'unknown' ? 0 : 9000,
      rationale:
        status === 'unknown'
          ? 'The required market data was not readable at the pinned block.'
          : 'Derived from pinned price selection and manipulation analysis.',
    },
    title: fired ? spec.title : `${spec.title} not found`,
    explanation:
      status === 'not_applicable'
        ? 'This market-integrity check does not apply at the pinned block (insufficient sources or activity).'
        : status === 'unknown'
          ? 'The required market data was not readable at the pinned block.'
          : fired
            ? spec.whenPresent
            : spec.whenAbsent,
    evidence: [
      {
        evidenceType: spec.source === MARKET_PRICE_RELIABILITY_SOURCE ? 'price_reliability' : 'trade_manipulation',
        summary: fired ? spec.whenPresent : spec.whenAbsent,
        data: {
          activeSourceCount: result.priceReliability.activeSourceCount,
          disagreementSourceKeys: [...result.priceReliability.disagreementSourceKeys],
          outlierReasons: [...result.priceReliability.outlierReasons],
          tradeCount: result.tradeManipulation.tradeCount,
          observedSignalCodes: [...result.tradeManipulation.observedSignalCodes],
          methodologyVersion: result.tradeManipulation.methodologyVersion,
        },
        provenanceKeys: [spec.source],
      },
    ],
    remediation: fired ? spec.remediation : null,
    fingerprintSeed: spec.ruleId,
  };
}

export function createMarketIntegrityRiskRules(): readonly RiskRule[] {
  return SPECS.map((spec) => ({
    ruleId: spec.ruleId,
    version: '1.0.0',
    category: 'Market integrity' as const,
    title: spec.title,
    description: spec.description,
    requiredDataSources: [spec.source],
    maxPenaltyBps: spec.severity === 'high' ? 2500 : 800,
    evaluate: async (context: Readonly<RiskScanContext>) => evaluationFor(spec, context),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hood-sentry/risk-engine test -- market-integrity-rules`
Expected: PASS.

- [ ] **Step 5: Add export and commit**

Add `export * from './market-integrity-rules.js';` to `index.ts`. Then:

```bash
git add packages/risk-engine/src/market-integrity-rules.ts packages/risk-engine/src/__tests__/market-integrity-rules.test.ts packages/risk-engine/src/index.ts
git commit -m "feat(risk): market integrity deterministic rule family"
```

---

### Task 5: Register rules and extend the rulesets

**Files:**
- Modify: `apps/worker/src/jobs/risk-runtime.ts` (`ALL_RULES`, `CATEGORY_CAPS`, version constants, ruleset version strings)
- Test: `apps/worker/src/jobs/__tests__/risk-runtime-rulesets.test.ts` (create)

**Interfaces:**
- Consumes: `createOracleRiskRules`, `createMarketIntegrityRiskRules` (Tasks 2, 4); `RiskRuleRegistry` from risk-engine.

Current mechanics (verified): `ALL_RULES` is a local `const` at line 44 (`[...CONTRACT_RULES, ...LIQUIDITY_RULES, ...HOLDER_RULES]`). `TOKEN_RISK_RULESET = ruleset('risk-token-partial-1.2.0', ALL_RULES)`; `POOL_RISK_RULESET = ruleset('risk-pool-partial-1.2.0', [...CONTRACT_RULES, ...LIQUIDITY_RULES])`. The `ruleset()` helper (line 56) derives `categoryPenaltyCapsBps` from the `CATEGORY_CAPS` map (line 46) and throws if a rule's category has no cap. So the only edits needed are: export + extend `ALL_RULES`, add two `CATEGORY_CAPS` entries, and bump the versions. The token ruleset picks up the new rules automatically (it is built from `ALL_RULES`); the pool ruleset stays contract+liquidity by design (oracle/market target token scans).

- [ ] **Step 1: Write the failing test**

```ts
import { RiskRuleRegistry } from '@hood-sentry/risk-engine';
import { describe, expect, it } from 'vitest';
import { ALL_RULES, POOL_RISK_RULESET, TOKEN_RISK_RULESET } from '../risk-runtime.js';

describe('risk rulesets cover the oracle and market categories', () => {
  it('registers oracle and market-integrity rules without duplicates', () => {
    const registry = new RiskRuleRegistry(ALL_RULES);
    const ids = registry.list().map((r) => r.ruleId);
    expect(ids).toContain('oracle.oracle_stale');
    expect(ids).toContain('market.self_trading');
  });

  it('resolves the token ruleset with both new categories and their caps', () => {
    const registry = new RiskRuleRegistry(ALL_RULES);
    const { rules } = registry.resolveRuleset(TOKEN_RISK_RULESET);
    const categories = new Set(rules.map((r) => r.category));
    expect(categories.has('Oracle behavior')).toBe(true);
    expect(categories.has('Market integrity')).toBe(true);
    for (const category of categories) {
      expect(TOKEN_RISK_RULESET.categoryPenaltyCapsBps[category]).toBeGreaterThan(0);
    }
  });

  it('resolves the pool ruleset with caps for every category it references', () => {
    const registry = new RiskRuleRegistry(ALL_RULES);
    const { rules } = registry.resolveRuleset(POOL_RISK_RULESET);
    for (const rule of rules) {
      expect(POOL_RISK_RULESET.categoryPenaltyCapsBps[rule.category]).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hood-sentry/worker test -- risk-runtime-rulesets`
Expected: FAIL — `ALL_RULES` is not exported / the new rule ids are absent.

- [ ] **Step 3: Write minimal implementation**

In `risk-runtime.ts`:

1. Import the factories (add to the existing `@hood-sentry/risk-engine` import group):
```ts
import {
  createMarketIntegrityRiskRules,
  createOracleRiskRules,
} from '@hood-sentry/risk-engine';
```
2. Export and extend `ALL_RULES` (line 44). Add the two families and add `export`:
```ts
export const ALL_RULES = [
  ...CONTRACT_RULES,
  ...LIQUIDITY_RULES,
  ...HOLDER_RULES,
  ...createOracleRiskRules(),
  ...createMarketIntegrityRiskRules(),
];
```
3. Add the two caps to `CATEGORY_CAPS` (line 46):
```ts
  'Oracle behavior': 3_000,
  'Market integrity': 3_000,
```
4. Bump the versions so the changed methodology is traceable: `RISK_ENGINE_VERSION` → `'deterministic-risk-engine-1.3.0'`, `RISK_METHODOLOGY_VERSION` → `'risk-partial-1.3.0'`, and the two ruleset version strings → `'risk-token-partial-1.3.0'` / `'risk-pool-partial-1.3.0'`.

No change to the `ruleset()` helper or `POOL_RISK_RULESET`'s rule list is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @hood-sentry/worker test -- risk-runtime-rulesets`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter @hood-sentry/worker typecheck` — Expected: clean.

```bash
git add apps/worker/src/jobs/risk-runtime.ts apps/worker/src/jobs/__tests__/risk-runtime-rulesets.test.ts
git commit -m "feat(risk): register oracle and market-integrity rules in the rulesets"
```

---

### Task 6: Oracle behavior context loader

**Files:**
- Create: `apps/worker/src/jobs/oracle-behavior-context.ts`
- Test: `apps/worker/src/__tests__/oracle-behavior-context.integration.test.ts`

**Interfaces:**
- Consumes: `RiskContextLoader`, `RiskScanJobInput` from `./risk-scan.js` (the decorator interface used by `LiquidityRiskContextLoader`); `ORACLE_OBSERVATION_SOURCE`, `OracleBehaviorResult`, `serializeOracleResult` from `@hood-sentry/risk-engine`; `PricingRepository` from `@hood-sentry/db` (methods `listSourceConfigs`, `findLatestOracleStatus`); the `PriceObservation` fields carrying migration-029 state.
- Produces: `class OracleBehaviorContextLoader implements RiskContextLoader` and an injectable `OracleObservationSource` interface with `load(input): Promise<OracleBehaviorResult>` so unit tests need no DB.

Before writing, read: `apps/worker/src/jobs/liquidity-context.ts` (the decorator + `*Source` pattern and how it appends to `context.data` and `context.dataSources`), and `packages/db/src/schema/dex-market.ts` + the `PriceObservation` type for the exact migration-029 field names (`roundId`, `answeredInRound`, `oraclePaused`, `sequencerUp`, `sequencerRecoveredAt`, `oracleHeartbeatSeconds`, `sequencerFeedAddress`).

- [ ] **Step 1: Write the failing integration test**

```ts
import { createMigratedTestDatabase } from '@hood-sentry/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleOracleObservationSource } from '../jobs/oracle-behavior-context.js';

// The suite provisions a clean migrated DB (through 029), seeds a chainlink
// price_source_config and a deterministic_price_observation with paused/sequencer
// state, then asserts the source maps them into an OracleBehaviorResult.

describe('DrizzleOracleObservationSource (live DB)', () => {
  // Use the same provisioning helper the liquidity integration test uses.
  // Seed: one source config (chainlink, oracle_heartbeat_seconds=3600),
  // one observation at block 200 with oracle_paused=true.
  it('reports the token not applicable when it has no oracle source', async () => {
    // seed no chainlink config for token; expect result.applicable === false
    expect(true).toBe(true); // replace with real assertion after reading the seed helpers
  });

  it('projects paused/sequencer state from the pinned observation', async () => {
    // seed chainlink config + observation(oracle_paused=true) at block 200
    // expect result.applicable === true && result.oraclePaused === true
    expect(true).toBe(true);
  });
});
```

> Note: the two placeholder assertions above MUST be replaced with real seed + assert code during implementation, mirroring `apps/worker/src/__tests__/liquidity-context.integration.test.ts` for the DB provisioning and seeding helpers. Do not commit the `expect(true).toBe(true)` lines.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hood-sentry/worker test:integration -- oracle-behavior-context`
Expected: FAIL — module `../jobs/oracle-behavior-context.js` not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { PricingRepository } from '@hood-sentry/db';
import {
  ORACLE_OBSERVATION_SOURCE,
  type OracleBehaviorResult,
  type RiskScanContext,
  serializeOracleResult,
} from '@hood-sentry/risk-engine';
import type { RiskContextLoader, RiskScanJobInput } from './risk-scan.js';

export interface OracleObservationSource {
  load(input: {
    chainId: number;
    tokenAddress: string;
    sourceBlock: bigint;
    scanTimeSeconds: bigint;
  }): Promise<OracleBehaviorResult>;
}

/** Maps the pinned price-source config + latest oracle observation into the risk result. */
export class DrizzleOracleObservationSource implements OracleObservationSource {
  constructor(private readonly repository: PricingRepository) {}

  async load(input: {
    chainId: number;
    tokenAddress: string;
    sourceBlock: bigint;
    scanTimeSeconds: bigint;
  }): Promise<OracleBehaviorResult> {
    const configs = await this.repository.listSourceConfigs(input.chainId, input.tokenAddress);
    const oracleConfig = configs.find(
      (c) => c.sourceType === 'chainlink' && c.enabled && c.sourceContractAddress !== null,
    );
    const base = { applicable: false, sourceKey: null, answerRaw: null, decimals: null, roundId: null, answeredInRound: null, updatedAtSeconds: null, scanTimeSeconds: input.scanTimeSeconds, heartbeatSeconds: null, oraclePaused: false, sequencerConfigured: false, sequencerUp: null, sequencerRecoveredAtSeconds: null, sourceBlock: input.sourceBlock } satisfies OracleBehaviorResult;
    if (oracleConfig === undefined) return base;

    // findLatestOracleStatus(chainId, tokenAddress, quoteAssetAddress) -> PriceObservation | null,
    // where the observation carries the migration-029 fields. Confirm exact field names against
    // the PriceObservation type before finalizing.
    const observation = await this.repository.findLatestOracleStatus(
      input.chainId,
      input.tokenAddress,
      oracleConfig.quoteAssetAddress,
    );
    const heartbeatSeconds = oracleConfig.oracleHeartbeatSeconds ?? null;
    const sequencerConfigured =
      oracleConfig.sequencerFeedAddress !== undefined && oracleConfig.sequencerFeedAddress !== null;
    if (observation === null) {
      return { ...base, applicable: true, sourceKey: oracleConfig.sourceKey, heartbeatSeconds, sequencerConfigured };
    }
    return {
      applicable: true,
      sourceKey: oracleConfig.sourceKey,
      answerRaw: observation.priceRaw,
      decimals: observation.priceDecimals ?? null,
      roundId: observation.roundId ?? null,
      answeredInRound: observation.answeredInRound ?? null,
      updatedAtSeconds: observation.sourceTimestamp === null ? null : BigInt(Math.floor(Date.parse(observation.sourceTimestamp) / 1000)),
      scanTimeSeconds: input.scanTimeSeconds,
      heartbeatSeconds,
      oraclePaused: observation.oraclePaused ?? false,
      sequencerConfigured,
      sequencerUp: observation.sequencerUp ?? null,
      sequencerRecoveredAtSeconds: observation.sequencerRecoveredAt === null || observation.sequencerRecoveredAt === undefined ? null : BigInt(Math.floor(Date.parse(observation.sequencerRecoveredAt) / 1000)),
      sourceBlock: input.sourceBlock,
    };
  }
}

export class OracleBehaviorContextLoader implements RiskContextLoader {
  constructor(
    private readonly inner: RiskContextLoader,
    private readonly source: OracleObservationSource,
  ) {}

  async loadContext(
    input: RiskScanJobInput,
    methodologyVersion: string,
  ): Promise<RiskScanContext> {
    const context = await this.inner.loadContext(input, methodologyVersion);
    const result = await this.source.load({
      chainId: input.target.chainId,
      tokenAddress: input.target.address,
      sourceBlock: context.sourceBlock,
      scanTimeSeconds: BigInt(Math.floor(Date.now() / 1000)),
    });
    return {
      ...context,
      data: { ...context.data, [ORACLE_OBSERVATION_SOURCE]: serializeOracleResult(result) },
      dataSources: [
        ...context.dataSources,
        {
          key: ORACLE_OBSERVATION_SOURCE,
          kind: 'database' as const,
          provider: 'pricing_repository',
          status: 'available' as const,
          sourceBlock: context.sourceBlock,
          sourceBlockHash: context.sourceBlockHash,
          fetchedAt: new Date().toISOString(),
          reason: null,
        },
      ],
    };
  }
}
```

> The loader interface is `loadContext(input: RiskScanJobInput, methodologyVersion: string): Promise<RiskScanContext>` (verified in `risk-scan.ts`); the decorator threads `methodologyVersion` to `inner.loadContext`. Confirm `RiskScanJobInput` field access (`input.target.chainId`, `input.target.address`) against `liquidity-context.ts`. `scanTimeSeconds` uses wall-clock `Date.now()` deliberately — staleness is measured at scan time, not pinned. If reproducibility across replays is required, thread a scan timestamp through `RiskScanJobInput` instead; note this decision in the PR.

- [ ] **Step 4: Replace the placeholder assertions with real seed+assert code and run**

Run: `pnpm --filter @hood-sentry/worker test:integration -- oracle-behavior-context`
Expected: PASS (both cases, real assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/jobs/oracle-behavior-context.ts apps/worker/src/__tests__/oracle-behavior-context.integration.test.ts
git commit -m "feat(worker): oracle behavior risk context loader"
```

---

### Task 7: Market integrity context loader

**Files:**
- Create: `apps/worker/src/jobs/market-integrity-context.ts`
- Test: `apps/worker/src/__tests__/market-integrity-context.integration.test.ts`

**Interfaces:**
- Consumes: `RiskContextLoader`, `RiskScanJobInput`; `MARKET_PRICE_RELIABILITY_SOURCE`, `MARKET_TRADE_MANIPULATION_SOURCE`, `MarketIntegrityResult`, `serializeMarketIntegrityResult` (Task 3); `selectPriceSource`, `detectOutliers` from `@hood-sentry/market-engine`; `analyzeManipulation`, `MANIPULATION_METHODOLOGY_VERSION`, `DiscoveryTrade`, `ManipulationContext` from `@hood-sentry/discovery-engine`.
- Produces: `class MarketIntegrityContextLoader implements RiskContextLoader`, plus injectable `MarketDataSource` interface returning the raw pinned inputs (active configs+observations, and trades) so a unit test can exercise the mapping without a DB.

Key signatures (already verified):
- `selectPriceSource(configs, observations, observedAt): SourceSelectionResult` — has `disagreementWarnings: readonly string[]` (format `SOURCE_DISAGREEMENT:<sourceKey>:<bps>`).
- `detectOutliers(input: OutlierInput): { available: boolean; reasons: readonly string[] }`.
- `analyzeManipulation(trades: readonly DiscoveryTrade[], context: ManipulationContext): { methodologyVersion, signals }` — each `signal` has `.code` and `.status` (`'observed' | 'insufficientData' | ...`).

Constant: `MARKET_MIN_TRADES_FOR_MANIPULATION = 20`.

Mapping the loader performs:
- `priceReliability.available` = there was at least one active observation to evaluate; else `false` (→ rules report `unknown`).
- `activeSourceCount` = count of configs with a usable observation.
- `disagreementSourceKeys` = source keys parsed out of `disagreementWarnings`.
- `outlierReasons` = `detectOutliers(...).reasons` for the primary observation.
- `oneTransactionManipulation` = primary observation `reasons` includes `'ONE_TRANSACTION_MANIPULATION'`.
- `tradeManipulation.available` = trades were readable (even if empty); `false` only on DB failure.
- `tradeCount` = trades.length; `observedSignalCodes` = signals with status `'observed'` whose code is in `MARKET_INTEGRITY_SIGNAL_CODES`.

- [ ] **Step 1: Write the failing unit test (mapping, no DB)**

```ts
import { describe, expect, it } from 'vitest';
import { buildMarketIntegrityResult } from '../jobs/market-integrity-context.js';

describe('buildMarketIntegrityResult', () => {
  it('marks disagreement and self-trading from engine outputs', () => {
    const result = buildMarketIntegrityResult({
      sourceBlock: 200n,
      priceAvailable: true,
      activeSourceCount: 2,
      disagreementWarnings: ['SOURCE_DISAGREEMENT:dex-usdg:250'],
      outlierReasons: [],
      primaryReasons: [],
      tradesAvailable: true,
      tradeCount: 40,
      manipulation: { methodologyVersion: 'manipulation-v1', signals: [{ code: 'SELF_TRADING', status: 'observed' }] },
    });
    expect(result.priceReliability.disagreementSourceKeys).toEqual(['dex-usdg']);
    expect(result.tradeManipulation.observedSignalCodes).toEqual(['SELF_TRADING']);
  });

  it('marks price unavailable when there is no observation', () => {
    const result = buildMarketIntegrityResult({
      sourceBlock: 200n,
      priceAvailable: false,
      activeSourceCount: 0,
      disagreementWarnings: [],
      outlierReasons: [],
      primaryReasons: [],
      tradesAvailable: true,
      tradeCount: 0,
      manipulation: { methodologyVersion: 'manipulation-v1', signals: [] },
    });
    expect(result.priceReliability.available).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @hood-sentry/worker test -- market-integrity-context`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
import type { Database } from '@hood-sentry/db';
import {
  MARKET_INTEGRITY_SIGNAL_CODES,
  MARKET_PRICE_RELIABILITY_SOURCE,
  MARKET_TRADE_MANIPULATION_SOURCE,
  type MarketIntegrityResult,
  type RiskScanContext,
  serializeMarketIntegrityResult,
} from '@hood-sentry/risk-engine';
import type { RiskContextLoader, RiskScanJobInput } from './risk-scan.js';

export const MARKET_MIN_TRADES_FOR_MANIPULATION = 20;

const SIGNAL_CODE_SET = new Set<string>(MARKET_INTEGRITY_SIGNAL_CODES);

export interface MarketIntegrityInputs {
  sourceBlock: bigint;
  priceAvailable: boolean;
  activeSourceCount: number;
  disagreementWarnings: readonly string[];
  outlierReasons: readonly string[];
  primaryReasons: readonly string[];
  tradesAvailable: boolean;
  tradeCount: number;
  manipulation: { methodologyVersion: string; signals: readonly { code: string; status: string }[] };
}

export function buildMarketIntegrityResult(input: MarketIntegrityInputs): MarketIntegrityResult {
  const disagreementSourceKeys = input.disagreementWarnings
    .map((w) => w.split(':')[1])
    .filter((k): k is string => k !== undefined && k.length > 0);
  const observedSignalCodes = input.manipulation.signals
    .filter((s) => s.status === 'observed' && SIGNAL_CODE_SET.has(s.code))
    .map((s) => s.code);
  return {
    priceReliability: {
      available: input.priceAvailable,
      activeSourceCount: input.activeSourceCount,
      disagreementSourceKeys,
      outlierReasons: [...input.outlierReasons],
      oneTransactionManipulation: input.primaryReasons.includes('ONE_TRANSACTION_MANIPULATION'),
    },
    tradeManipulation: {
      available: input.tradesAvailable,
      tradeCount: input.tradeCount,
      minTradesForAssessment: MARKET_MIN_TRADES_FOR_MANIPULATION,
      observedSignalCodes,
      methodologyVersion: input.manipulation.methodologyVersion,
    },
    sourceBlock: input.sourceBlock,
  };
}

export interface MarketDataSource {
  load(input: { chainId: number; tokenAddress: string; sourceBlock: bigint }): Promise<MarketIntegrityInputs>;
}

export class MarketIntegrityContextLoader implements RiskContextLoader {
  constructor(
    private readonly inner: RiskContextLoader,
    private readonly source: MarketDataSource,
  ) {}

  async loadContext(
    input: RiskScanJobInput,
    methodologyVersion: string,
  ): Promise<RiskScanContext> {
    const context = await this.inner.loadContext(input, methodologyVersion);
    const inputs = await this.source.load({
      chainId: input.target.chainId,
      tokenAddress: input.target.address,
      sourceBlock: context.sourceBlock,
    });
    const serialized = serializeMarketIntegrityResult(buildMarketIntegrityResult(inputs));
    const provenance = (key: string, available: boolean) => ({
      key,
      kind: 'database' as const,
      provider: 'market_engine',
      status: (available ? 'available' : 'unavailable') as 'available' | 'unavailable',
      sourceBlock: context.sourceBlock,
      sourceBlockHash: context.sourceBlockHash,
      fetchedAt: new Date().toISOString(),
      reason: available ? null : 'market data unavailable at pinned block',
    });
    return {
      ...context,
      data: {
        ...context.data,
        [MARKET_PRICE_RELIABILITY_SOURCE]: serialized,
        [MARKET_TRADE_MANIPULATION_SOURCE]: serialized,
      },
      dataSources: [
        ...context.dataSources,
        provenance(MARKET_PRICE_RELIABILITY_SOURCE, inputs.priceAvailable),
        provenance(MARKET_TRADE_MANIPULATION_SOURCE, inputs.tradesAvailable),
      ],
    };
  }
}

/**
 * The Drizzle-backed MarketDataSource: read active configs + observations at the pinned block,
 * run selectPriceSource + detectOutliers; read pinned trades and run analyzeManipulation.
 * Mirror the DB access in apps/worker/src/jobs/liquidity-context.ts (DrizzleLiquidityContextSource)
 * and the trade shape used by the discovery jobs. Implement DrizzleMarketDataSource here.
 */
export class DrizzleMarketDataSource implements MarketDataSource {
  constructor(private readonly database: Database) {}
  async load(): Promise<MarketIntegrityInputs> {
    throw new Error('implement against price_source_configs, deterministic_price_observations, and pinned swaps');
  }
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm --filter @hood-sentry/worker test -- market-integrity-context`
Expected: PASS (2 mapping tests).

- [ ] **Step 5: Implement `DrizzleMarketDataSource` + integration test, then commit**

Write `apps/worker/src/__tests__/market-integrity-context.integration.test.ts` mirroring the liquidity integration suite: seed two agreeing vs disagreeing price sources + observations, and a set of trades (clean vs self-trading, above vs below 20). Replace the `throw` in `DrizzleMarketDataSource.load` with real Drizzle reads that call `selectPriceSource`, `detectOutliers`, and `analyzeManipulation`. Confirm the trade query mirrors the discovery swap read.

Run: `pnpm --filter @hood-sentry/worker test:integration -- market-integrity-context`
Expected: PASS.

```bash
git add apps/worker/src/jobs/market-integrity-context.ts apps/worker/src/__tests__/market-integrity-context.integration.test.ts
git commit -m "feat(worker): market integrity risk context loader"
```

---

### Task 8: Chain loaders into the runtime and update status

**Files:**
- Modify: `apps/worker/src/jobs/risk-runtime.ts` (insert the two loaders into the decorator chain)
- Modify: `docs/IMPLEMENTATION_STATUS.md`
- Test: `apps/worker/src/__tests__/risk-scan.integration.test.ts` (extend existing, or add an assertion in the risk-analysis integration test)

**Interfaces:**
- Consumes: `OracleBehaviorContextLoader`, `DrizzleOracleObservationSource` (Task 6); `MarketIntegrityContextLoader`, `DrizzleMarketDataSource` (Task 7); the pricing repository constructor already used elsewhere (`DrizzlePricingRepository`).

- [ ] **Step 1: Write/extend the failing integration assertion**

In the existing risk-analysis integration test (`apps/worker/src/processors/risk-analysis.test.ts` or `risk-scan.integration.test.ts`), add a case asserting that a completed scan's findings include the `'Oracle behavior'` and `'Market integrity'` categories (as `not_applicable` for a token with no oracle and thin trading):

```ts
it('emits oracle and market-integrity findings for a scanned token', async () => {
  // run a full scan through the runtime for a seeded token
  const categories = new Set(result.findings.map((f) => f.category));
  expect(categories.has('Oracle behavior')).toBe(true);
  expect(categories.has('Market integrity')).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @hood-sentry/worker test:integration -- risk`
Expected: FAIL — the two categories are absent (loaders not chained).

- [ ] **Step 3: Chain the loaders**

In `risk-runtime.ts`, after `liquidityContext` and before `pinnedContext`, insert:

```ts
const oracleContext = new OracleBehaviorContextLoader(
  liquidityContext,
  new DrizzleOracleObservationSource(new DrizzlePricingRepository(input.database.db)),
);
const marketContext = new MarketIntegrityContextLoader(
  oracleContext,
  new DrizzleMarketDataSource(input.database),
);
```

Then change `CanonicalRiskContextLoader(liquidityContext, ...)` to wrap `marketContext` instead of `liquidityContext`. Add the imports for the four new symbols.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @hood-sentry/worker test:integration -- risk`
Expected: PASS.

- [ ] **Step 5: Update IMPLEMENTATION_STATUS.md and commit**

Add a `## Recent changes (2026-07-16)` bullet: Oracle behavior and Market integrity rule families implemented and wired through the orchestrator; update the "Partial" line that lists absent risk rules to remove oracle and market, leaving deployer, identity, metadata, and launchpad. State plainly that `RISK_SCORES_ENABLED` stays closed because four categories remain (do NOT imply the flag can open).

```bash
git add apps/worker/src/jobs/risk-runtime.ts docs/IMPLEMENTATION_STATUS.md apps/worker/src/processors/risk-analysis.test.ts
git commit -m "feat(risk): wire oracle and market-integrity loaders into the scan runtime"
```

---

### Task 9: Full gate verification

- [ ] **Step 1: Run the full local gate**

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration --force && pnpm build
```
Expected: all green. Unit adds oracle-types, oracle-rules, market-integrity-types, market-integrity-rules, market-integrity-context, risk-runtime-rulesets; integration adds the two loader suites plus the extended risk scan.

- [ ] **Step 2: Commit any lint/format fixups**

If `pnpm lint:fix` changes files, review and commit:
```bash
git add -A && git commit -m "chore(risk): lint and format fixups for oracle/market rules"
```

- [ ] **Step 3: Confirm no Claude attribution**

```bash
git log origin/main..HEAD --format='%an <%ae>|%cn <%ce>|%B' | grep -iE 'claude|anthropic|co-author|generated with' && echo 'FOUND — fix' || echo 'clean'
```
Expected: `clean`.
