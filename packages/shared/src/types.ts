export type DataTrustClass =
  | 'CHAIN_FACT'
  | 'EXPLORER_ENRICHMENT'
  | 'DERIVED'
  | 'USER_ASSERTION'
  | 'ADMIN_DECISION'
  | 'EXTERNAL_MARKET_DATA';

export type FinalityState = 'pending' | 'soft_confirmed' | 'finalized' | 'orphaned';

export type ChainId = 4663 | 46630;

export const MAINNET_CHAIN_ID: ChainId = 4663;
export const TESTNET_CHAIN_ID: ChainId = 46630;
