import type { ProtocolAdapterManager } from '@hood-sentry/chain';
import type { Database } from '@hood-sentry/db';
import {
  DrizzleBlockRepositoryImpl,
  DrizzlePricingRepository,
  DrizzleProtocolRepositoryImpl,
  DrizzleRiskRepository,
} from '@hood-sentry/db';
import {
  type ProxyAnalysisClient,
  type RiskCategory,
  type RiskRule,
  RiskRuleRegistry,
  type RiskRuleset,
  RiskScanOrchestrator,
  createHolderDistributionRules,
  createLiquidityRiskRules,
  createMarketIntegrityRiskRules,
  createOracleRiskRules,
  createPrivilegeAnalysisRules,
  createProxyAnalysisRules,
} from '@hood-sentry/risk-engine';
import {
  ContractAnalysisContextLoader,
  type ContractMetadataProvider,
} from './contract-analysis-context.js';
import { DrizzleHolderBalanceSource } from './drizzle-holder-balance-source.js';
import { HolderDistributionContextLoader } from './holder-distribution-context.js';
import {
  DrizzleLiquidityContextSource,
  LiquidityRiskContextLoader,
  VerifiedProtocolPoolStateReader,
} from './liquidity-context.js';
import {
  DrizzleMarketDataSource,
  MarketIntegrityContextLoader,
} from './market-integrity-context.js';
import {
  DrizzleOracleObservationSource,
  OracleBehaviorContextLoader,
} from './oracle-behavior-context.js';
import {
  BaseRiskContextLoader,
  CanonicalRiskContextLoader,
  type PinnedBlockClient,
} from './pinned-risk-context.js';
import { RiskScanJob, type RiskScanJobInput } from './risk-scan.js';

export const RISK_ENGINE_VERSION = 'deterministic-risk-engine-1.3.0';
export const RISK_METHODOLOGY_VERSION = 'risk-partial-1.3.0';

const CONTRACT_RULES = [...createProxyAnalysisRules(), ...createPrivilegeAnalysisRules()];
const LIQUIDITY_RULES = createLiquidityRiskRules();
const HOLDER_RULES = createHolderDistributionRules();
export const ALL_RULES = [
  ...CONTRACT_RULES,
  ...LIQUIDITY_RULES,
  ...HOLDER_RULES,
  ...createOracleRiskRules(),
  ...createMarketIntegrityRiskRules(),
];

const CATEGORY_CAPS: Partial<Record<RiskCategory, number>> = {
  'Contract control': 1_500,
  'Transfer behavior': 2_000,
  Supply: 1_000,
  Upgradeability: 1_000,
  Liquidity: 2_000,
  'Holder distribution': 500,
  'Metadata quality': 500,
  'Oracle behavior': 3_000,
  'Market integrity': 3_000,
} as const;

function ruleset(version: string, rules: readonly RiskRule[]): RiskRuleset {
  const categoryPenaltyCapsBps: Partial<Record<RiskCategory, number>> = {};
  for (const category of new Set(rules.map((rule) => rule.category))) {
    const cap = CATEGORY_CAPS[category];
    if (cap === undefined) throw new Error(`Risk category cap is missing: ${category}`);
    categoryPenaltyCapsBps[category] = cap;
  }
  return {
    version,
    methodologyVersion: RISK_METHODOLOGY_VERSION,
    rules: rules.map((rule) => ({ ruleId: rule.ruleId, version: rule.version })),
    categoryPenaltyCapsBps,
  };
}

export const TOKEN_RISK_RULESET = ruleset('risk-token-partial-1.3.0', ALL_RULES);
export const POOL_RISK_RULESET = ruleset('risk-pool-partial-1.3.0', [
  ...CONTRACT_RULES,
  ...LIQUIDITY_RULES,
]);

export type RiskAnalysisRunResult = Awaited<ReturnType<RiskScanJob['run']>>;

export interface RiskAnalysisRunner {
  run(input: RiskScanJobInput, signal?: AbortSignal): Promise<RiskAnalysisRunResult>;
}

export class RiskAnalysisRuntime implements RiskAnalysisRunner {
  constructor(
    private readonly tokenScan: RiskScanJob,
    private readonly poolScan: RiskScanJob,
  ) {}

  run(input: RiskScanJobInput, signal?: AbortSignal): Promise<RiskAnalysisRunResult> {
    if (input.target.type === 'token' || input.target.type === 'launchpad_token') {
      return this.tokenScan.run(input, signal);
    }
    if (input.target.type === 'pool') return this.poolScan.run(input, signal);
    throw new Error(`RISK_TARGET_TYPE_UNSUPPORTED:${input.target.type}`);
  }
}

export function createRiskAnalysisRuntime(input: {
  database: Database;
  chainId: number;
  chainClient: ProxyAnalysisClient & PinnedBlockClient;
  protocolManager: ProtocolAdapterManager;
  metadataProvider: ContractMetadataProvider;
  scanTimeoutMs?: number;
  perRuleTimeoutMs?: number;
}): RiskAnalysisRuntime {
  const registry = new RiskRuleRegistry(ALL_RULES);
  const orchestrator = new RiskScanOrchestrator(registry, RISK_ENGINE_VERSION);
  const contractContext = new ContractAnalysisContextLoader(
    new BaseRiskContextLoader(),
    input.chainClient,
    input.metadataProvider,
  );
  const holderContext = new HolderDistributionContextLoader(
    contractContext,
    new DrizzleHolderBalanceSource(input.database),
  );
  const protocolRepository = new DrizzleProtocolRepositoryImpl(input.database.db);
  const liquidityContext = new LiquidityRiskContextLoader(
    holderContext,
    new DrizzleLiquidityContextSource(
      input.database,
      new VerifiedProtocolPoolStateReader(input.protocolManager),
      protocolRepository,
    ),
  );
  const oracleContext = new OracleBehaviorContextLoader(
    liquidityContext,
    new DrizzleOracleObservationSource(new DrizzlePricingRepository(input.database.db)),
  );
  const marketContext = new MarketIntegrityContextLoader(
    oracleContext,
    new DrizzleMarketDataSource(input.database),
  );
  const pinnedContext = new CanonicalRiskContextLoader(
    marketContext,
    input.chainId,
    new DrizzleBlockRepositoryImpl(input.database.db),
    input.chainClient,
  );
  const repository = new DrizzleRiskRepository(input.database.db);
  const options = {
    engineVersion: RISK_ENGINE_VERSION,
    scanTimeoutMs: input.scanTimeoutMs ?? 60_000,
    perRuleTimeoutMs: input.perRuleTimeoutMs ?? 5_000,
  };

  return new RiskAnalysisRuntime(
    new RiskScanJob(orchestrator, TOKEN_RISK_RULESET, pinnedContext, repository, options),
    new RiskScanJob(orchestrator, POOL_RISK_RULESET, pinnedContext, repository, options),
  );
}
