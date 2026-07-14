import { eq } from 'drizzle-orm';
import type { Database } from '../../client.js';
import type { TransactionContext } from '../../core/transaction.js';
import { featureFlags } from '../../schema/product.js';
import type { FeatureFlag, FeatureFlagRepository } from '../interfaces/feature-flag-repository.js';

type FeatureFlagRow = typeof featureFlags.$inferSelect;
type Db = Database['db'];

function toFeatureFlag(row: FeatureFlagRow): FeatureFlag {
  return {
    id: row.id,
    flagName: row.flagName,
    enabled: row.enabled,
    reason: row.reason,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
    createdAt: row.updatedAt,
  };
}

export class DrizzleFeatureFlagRepository implements FeatureFlagRepository {
  constructor(private readonly db: Db) {}

  private resolve(tx?: TransactionContext): Db | TransactionContext {
    return tx ?? this.db;
  }

  async getFeatureFlag(flagName: string, tx?: TransactionContext): Promise<FeatureFlag | null> {
    try {
      const rows = await this.resolve(tx)
        .select()
        .from(featureFlags)
        .where(eq(featureFlags.flagName, flagName))
        .limit(1);

      const row = rows[0];
      return row ? toFeatureFlag(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to get feature flag "${flagName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async getAllFeatureFlags(tx?: TransactionContext): Promise<FeatureFlag[]> {
    try {
      const rows = await this.resolve(tx).select().from(featureFlags);
      return rows.map(toFeatureFlag);
    } catch (error) {
      throw new Error(
        `Failed to get all feature flags: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async isEnabled(flagName: string, tx?: TransactionContext): Promise<boolean> {
    try {
      const rows = await this.resolve(tx)
        .select({ enabled: featureFlags.enabled })
        .from(featureFlags)
        .where(eq(featureFlags.flagName, flagName))
        .limit(1);

      const row = rows[0];
      return row?.enabled ?? false;
    } catch (error) {
      throw new Error(
        `Failed to check if feature flag "${flagName}" is enabled: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async insertFeatureFlag(
    featureFlag: Omit<FeatureFlag, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<FeatureFlag> {
    try {
      const now = new Date();

      const rows = await this.resolve(tx)
        .insert(featureFlags)
        .values({
          flagName: featureFlag.flagName,
          enabled: featureFlag.enabled,
          reason: featureFlag.reason,
          updatedBy: featureFlag.updatedBy,
          updatedAt: now,
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new Error('Insert returned no rows');
      }

      return toFeatureFlag(row);
    } catch (error) {
      throw new Error(
        `Failed to insert feature flag "${featureFlag.flagName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async upsertFeatureFlag(
    featureFlag: Omit<FeatureFlag, 'id' | 'createdAt' | 'updatedAt'>,
    tx?: TransactionContext,
  ): Promise<FeatureFlag> {
    try {
      const now = new Date();

      const rows = await this.resolve(tx)
        .insert(featureFlags)
        .values({
          flagName: featureFlag.flagName,
          enabled: featureFlag.enabled,
          reason: featureFlag.reason,
          updatedBy: featureFlag.updatedBy,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: featureFlags.flagName,
          set: {
            enabled: featureFlag.enabled,
            reason: featureFlag.reason,
            updatedBy: featureFlag.updatedBy,
            updatedAt: now,
          },
        })
        .returning();

      const row = rows[0];
      if (!row) {
        throw new Error('Upsert returned no rows');
      }

      return toFeatureFlag(row);
    } catch (error) {
      throw new Error(
        `Failed to upsert feature flag "${featureFlag.flagName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async updateFeatureFlag(
    flagName: string,
    data: Partial<Omit<FeatureFlag, 'id' | 'flagName' | 'createdAt' | 'updatedAt'>>,
    tx?: TransactionContext,
  ): Promise<FeatureFlag | null> {
    try {
      const setFields: Record<string, unknown> = { updatedAt: new Date() };

      if (data.enabled !== undefined) {
        setFields.enabled = data.enabled;
      }
      if (data.reason !== undefined) {
        setFields.reason = data.reason;
      }
      if (data.updatedBy !== undefined) {
        setFields.updatedBy = data.updatedBy;
      }

      const rows = await this.resolve(tx)
        .update(featureFlags)
        .set(setFields)
        .where(eq(featureFlags.flagName, flagName))
        .returning();

      const row = rows[0];
      return row ? toFeatureFlag(row) : null;
    } catch (error) {
      throw new Error(
        `Failed to update feature flag "${flagName}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async setFeatureFlag(
    flagName: string,
    enabled: boolean,
    updatedBy: string,
    reason?: string,
    tx?: TransactionContext,
  ): Promise<FeatureFlag> {
    return this.upsertFeatureFlag(
      {
        flagName,
        enabled,
        reason: reason ?? null,
        updatedBy,
      },
      tx,
    );
  }
}
