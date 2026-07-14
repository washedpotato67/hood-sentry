import type { TransactionContext } from '../../core/transaction.js';

export interface FeatureFlag {
  id: string;
  flagName: string;
  enabled: boolean;
  reason: string | null;
  updatedBy: string;
  updatedAt: Date;
  createdAt: Date;
}

export interface FeatureFlagRepository {
  getFeatureFlag(flagName: string, tx?: TransactionContext): Promise<FeatureFlag | null>;

  getAllFeatureFlags(tx?: TransactionContext): Promise<FeatureFlag[]>;

  isEnabled(flagName: string, tx?: TransactionContext): Promise<boolean>;

  insertFeatureFlag(
    featureFlag: Omit<FeatureFlag, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<FeatureFlag>;

  upsertFeatureFlag(
    featureFlag: Omit<FeatureFlag, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<FeatureFlag>;

  updateFeatureFlag(
    flagName: string,
    data: Partial<Omit<FeatureFlag, 'id' | 'flagName' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<FeatureFlag | null>;

  setFeatureFlag(
    flagName: string,
    enabled: boolean,
    updatedBy: string,
    reason?: string,
    tx?: TransactionContext,
  ): Promise<FeatureFlag>;
}
