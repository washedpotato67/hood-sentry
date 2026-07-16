export const FLAG_NAMES = [
  'TRADING_ENABLED',
  'TOKEN_GATE_ENABLED',
  'GAS_SPONSORSHIP_ENABLED',
  'AI_EXPLANATIONS_ENABLED',
  'WEBHOOKS_ENABLED',
  'MAINNET_WRITES_ENABLED',
  'PROJECT_CLAIMS_ENABLED',
  'COMMUNITY_REPORTS_ENABLED',
  'RISK_SCORES_ENABLED',
] as const;

export type FlagName = (typeof FLAG_NAMES)[number];

export type FlagState = {
  enabled: boolean;
  reason?: string;
  updatedAt: Date;
};

export type FlagMap = Record<FlagName, FlagState>;
