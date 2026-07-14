export const FLAG_NAMES = [
  'TRADING_ENABLED',
  'TOKEN_STAKING_ENABLED',
  'PROJECT_BONDS_ENABLED',
  'REPORT_BONDS_ENABLED',
  'ADMIN_SLASHING_ENABLED',
  'GAS_SPONSORSHIP_ENABLED',
  'AI_EXPLANATIONS_ENABLED',
  'WEBHOOKS_ENABLED',
  'STOCK_TOKEN_MODULE_ENABLED',
  'MAINNET_WRITES_ENABLED',
] as const;

export type FlagName = (typeof FLAG_NAMES)[number];

export type FlagState = {
  enabled: boolean;
  reason?: string;
  updatedAt: Date;
};

export type FlagMap = Record<FlagName, FlagState>;
