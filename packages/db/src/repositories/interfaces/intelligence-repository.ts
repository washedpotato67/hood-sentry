export type ChainTransfer = {
  blockNumber: bigint;
  blockHash: string;
  transactionHash: string;
  logIndex: number;
  tokenAddress: string;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
};

export type HolderBalance = {
  walletAddress: string;
  balanceRaw: string;
  asOfBlock: bigint;
};

export type WalletLabelRecord = {
  labelType: string;
  labelValue: string;
  source: string;
  confidence: string;
};

export type WalletPnlRecord = {
  tokenAddress: string;
  snapshotBlock: bigint;
  balanceRaw: string;
  costBasisRaw: string | null;
  realizedPnlRaw: string | null;
  unrealizedPnlRaw: string | null;
  quoteAssetAddress: string;
  quoteDecimals: number;
  confidence: string;
  methodology: string;
  incompleteHistory: boolean;
  warnings: readonly string[];
  sourceBlockHash: string;
  observedAt: Date;
};

export type WalletAllowanceRecord = {
  tokenAddress: string;
  spenderAddress: string;
  allowanceRaw: string;
  lastUpdatedBlock: bigint;
  lastUpdatedLogIndex: number;
  spenderClassification: string | null;
  classificationSource: string | null;
};

export type TokenPriceRecord = {
  tokenAddress: string;
  quoteAssetAddress: string;
  priceRaw: string;
  priceDecimals: number;
  sourceKey: string;
  sourceType: string;
  sourceBlockNumber: bigint | null;
  sourceBlockHash: string | null;
  observedAt: Date;
  confidenceBps: string;
  methodologyVersion: string;
};

export interface IntelligenceRepository {
  getTokenTransfers(
    chainId: number,
    tokenAddress: string,
    limit: number,
  ): Promise<readonly ChainTransfer[]>;
  getTokenHolders(
    chainId: number,
    tokenAddress: string,
    limit: number,
  ): Promise<readonly HolderBalance[]>;
  getWalletTransfers(
    chainId: number,
    walletAddress: string,
    limit: number,
  ): Promise<readonly ChainTransfer[]>;
  getWalletLabels(chainId: number, walletAddress: string): Promise<readonly WalletLabelRecord[]>;
  getWalletPnl(chainId: number, walletAddress: string): Promise<readonly WalletPnlRecord[]>;
  getWalletAllowances(
    chainId: number,
    walletAddress: string,
  ): Promise<readonly WalletAllowanceRecord[]>;
  getLatestTokenPrices(
    chainId: number,
    tokenAddresses: readonly string[],
  ): Promise<ReadonlyMap<string, TokenPriceRecord>>;
}
