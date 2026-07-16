import {
  API_KEY_SCOPES,
  type ApiKeyScope,
  apiKeyPrefix,
  issueApiKeyToken,
  verifyApiKeyToken,
} from '@hood-sentry/auth';
import { type Database, schema } from '@hood-sentry/db';
import { ForbiddenError, RateLimitError, UnauthorizedError } from '@hood-sentry/shared';
import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';

const scopesSchema = z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length);

export type ApiKeyPrincipal = {
  id: string;
  userId: string;
  prefix: string;
  scopes: readonly ApiKeyScope[];
  minuteRemaining: number;
  dayRemaining: number;
};

function bucketStart(now: Date, period: 'minute' | 'day'): Date {
  const result = new Date(now);
  if (period === 'minute') {
    result.setUTCSeconds(0, 0);
  } else {
    result.setUTCHours(0, 0, 0, 0);
  }
  return result;
}

export class ApiKeyService {
  constructor(
    private readonly database: Database,
    private readonly signingSecret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async issue(input: {
    userId: string;
    name: string;
    scopes: readonly ApiKeyScope[];
    quotaPerMinute: number;
    quotaPerDay: number;
  }) {
    const active = await this.database.db
      .select({ id: schema.apiKeys.id })
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.userId, input.userId), isNull(schema.apiKeys.revokedAt)));
    if (active.length >= 10)
      throw new ForbiddenError('Each account supports up to 10 active API keys');
    const scopes = scopesSchema.parse([...new Set(input.scopes)]);
    const issued = issueApiKeyToken(this.signingSecret);
    const rows = await this.database.db
      .insert(schema.apiKeys)
      .values({
        userId: input.userId,
        keyPrefix: issued.prefix,
        hashedSecret: issued.hash,
        name: input.name,
        scopes,
        quotaPerMinute: input.quotaPerMinute,
        quotaPerDay: input.quotaPerDay,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) throw new Error('API_KEY_INSERT_FAILED');
    await this.database.db.insert(schema.userSecurityEvents).values({
      userId: input.userId,
      eventType: 'api_key_created',
      severity: 'info',
      metadata: { apiKeyId: row.id, prefix: row.keyPrefix, scopes },
    });
    return {
      id: row.id,
      name: row.name,
      prefix: row.keyPrefix,
      token: issued.token,
      scopes,
      quotaPerMinute: row.quotaPerMinute,
      quotaPerDay: row.quotaPerDay,
      createdAt: row.createdAt,
    };
  }

  async list(userId: string) {
    const rows = await this.database.db
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        prefix: schema.apiKeys.keyPrefix,
        scopes: schema.apiKeys.scopes,
        quotaPerMinute: schema.apiKeys.quotaPerMinute,
        quotaPerDay: schema.apiKeys.quotaPerDay,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        revokedAt: schema.apiKeys.revokedAt,
        createdAt: schema.apiKeys.createdAt,
      })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.userId, userId))
      .orderBy(asc(schema.apiKeys.createdAt));
    return rows.map((row) => ({ ...row, scopes: scopesSchema.parse(row.scopes) }));
  }

  async revoke(userId: string, id: string): Promise<boolean> {
    const rows = await this.database.db
      .update(schema.apiKeys)
      .set({ revokedAt: this.now(), updatedAt: this.now() })
      .where(
        and(
          eq(schema.apiKeys.id, id),
          eq(schema.apiKeys.userId, userId),
          isNull(schema.apiKeys.revokedAt),
        ),
      )
      .returning({ id: schema.apiKeys.id, prefix: schema.apiKeys.keyPrefix });
    const row = rows[0];
    if (row === undefined) return false;
    await this.database.db.insert(schema.userSecurityEvents).values({
      userId,
      eventType: 'api_key_revoked',
      severity: 'info',
      metadata: { apiKeyId: row.id, prefix: row.prefix },
    });
    return true;
  }

  async authenticate(token: string, requiredScope: ApiKeyScope | null): Promise<ApiKeyPrincipal> {
    const prefix = apiKeyPrefix(token);
    if (prefix === null) throw new UnauthorizedError('The API key format is invalid');
    const rows = await this.database.db
      .select()
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.keyPrefix, prefix), isNull(schema.apiKeys.revokedAt)))
      .limit(1);
    const key = rows[0];
    if (key === undefined || !verifyApiKeyToken(token, key.hashedSecret, this.signingSecret)) {
      throw new UnauthorizedError('The API key is invalid or revoked');
    }
    const scopes = scopesSchema.parse(key.scopes);
    if (requiredScope !== null && !scopes.includes(requiredScope)) {
      throw new ForbiddenError(`The API key requires the ${requiredScope} scope`);
    }
    if (key.quotaPerMinute === null || key.quotaPerDay === null) {
      throw new Error('API_KEY_QUOTA_NOT_CONFIGURED');
    }
    const quotaPerMinute = key.quotaPerMinute;
    const quotaPerDay = key.quotaPerDay;
    const now = this.now();
    const usage = await this.database.db.transaction(async (transaction) => {
      const minute = await transaction
        .insert(schema.apiKeyUsageBuckets)
        .values({
          apiKeyId: key.id,
          periodKind: 'minute',
          bucketStart: bucketStart(now, 'minute'),
          requestCount: 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.apiKeyUsageBuckets.apiKeyId,
            schema.apiKeyUsageBuckets.periodKind,
            schema.apiKeyUsageBuckets.bucketStart,
          ],
          set: {
            requestCount: sql`${schema.apiKeyUsageBuckets.requestCount} + 1`,
            updatedAt: now,
          },
          setWhere: lt(schema.apiKeyUsageBuckets.requestCount, quotaPerMinute),
        })
        .returning({ count: schema.apiKeyUsageBuckets.requestCount });
      if (minute[0] === undefined) throw new RateLimitError(60);
      const day = await transaction
        .insert(schema.apiKeyUsageBuckets)
        .values({
          apiKeyId: key.id,
          periodKind: 'day',
          bucketStart: bucketStart(now, 'day'),
          requestCount: 1,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            schema.apiKeyUsageBuckets.apiKeyId,
            schema.apiKeyUsageBuckets.periodKind,
            schema.apiKeyUsageBuckets.bucketStart,
          ],
          set: {
            requestCount: sql`${schema.apiKeyUsageBuckets.requestCount} + 1`,
            updatedAt: now,
          },
          setWhere: lt(schema.apiKeyUsageBuckets.requestCount, quotaPerDay),
        })
        .returning({ count: schema.apiKeyUsageBuckets.requestCount });
      if (day[0] === undefined) throw new RateLimitError(86_400);
      await transaction
        .update(schema.apiKeys)
        .set({ lastUsedAt: now, updatedAt: now })
        .where(eq(schema.apiKeys.id, key.id));
      return { minute: minute[0].count, day: day[0].count };
    });
    return {
      id: key.id,
      userId: key.userId,
      prefix,
      scopes,
      minuteRemaining: Math.max(0, quotaPerMinute - usage.minute),
      dayRemaining: Math.max(0, quotaPerDay - usage.day),
    };
  }
}
