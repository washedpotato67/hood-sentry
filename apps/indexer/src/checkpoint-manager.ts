import type { Database } from '@hood-sentry/db';
import { schema } from '@hood-sentry/db';
import { and, eq } from 'drizzle-orm';
import type { Checkpoint, IndexerConfig, Lease } from './types.js';

export class CheckpointManager {
  private readonly drizzle: Database['db'];

  constructor(
    database: Database,
    private readonly config: IndexerConfig,
  ) {
    this.drizzle = database.db;
  }

  async getCheckpoint(stream: string): Promise<Checkpoint | null> {
    const result = await this.drizzle.query.indexerCheckpoints.findFirst({
      where: (checkpoints, { eq, and }) =>
        and(eq(checkpoints.chainId, this.config.chainId), eq(checkpoints.stream, stream)),
    });

    if (!result) {
      return null;
    }

    return {
      chainId: result.chainId,
      stream: result.stream,
      nextBlock: result.nextBlock,
      lastBlockHash: result.lastBlockHash as `0x${string}` | null,
      lockedBy: result.lockedBy,
      updatedAt: result.updatedAt,
    };
  }

  async createOrUpdateCheckpoint(
    stream: string,
    nextBlock: bigint,
    lastBlockHash: `0x${string}` | null,
  ): Promise<Checkpoint> {
    const now = new Date();

    await this.drizzle
      .insert(schema.indexerCheckpoints)
      .values({
        chainId: this.config.chainId,
        stream,
        nextBlock,
        lastBlockHash,
        lockedBy: this.config.workerId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schema.indexerCheckpoints.chainId, schema.indexerCheckpoints.stream],
        set: {
          nextBlock,
          lastBlockHash,
          lockedBy: this.config.workerId,
          updatedAt: now,
        },
      });

    return {
      chainId: this.config.chainId,
      stream,
      nextBlock,
      lastBlockHash,
      lockedBy: this.config.workerId,
      updatedAt: now,
    };
  }

  async acquireLease(stream: string): Promise<Lease | null> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.leaseDurationMs);

    try {
      await this.drizzle.insert(schema.indexerLeases).values({
        chainId: this.config.chainId,
        stream,
        workerId: this.config.workerId,
        expiresAt,
        createdAt: now,
      });

      return {
        chainId: this.config.chainId,
        stream,
        workerId: this.config.workerId,
        expiresAt,
        createdAt: now,
      };
    } catch {
      const existingLease = await this.drizzle.query.indexerLeases.findFirst({
        where: (leases, { eq, and }) =>
          and(
            eq(leases.chainId, this.config.chainId),
            eq(leases.stream, stream),
            eq(leases.workerId, this.config.workerId),
          ),
      });

      if (existingLease) {
        return this.renewLease(stream);
      }

      const otherLease = await this.drizzle.query.indexerLeases.findFirst({
        where: (leases, { eq, and }) =>
          and(eq(leases.chainId, this.config.chainId), eq(leases.stream, stream)),
      });

      if (otherLease && otherLease.expiresAt < now) {
        await this.drizzle
          .delete(schema.indexerLeases)
          .where(
            and(
              eq(schema.indexerLeases.chainId, this.config.chainId),
              eq(schema.indexerLeases.stream, stream),
            ),
          );

        return this.acquireLease(stream);
      }

      return null;
    }
  }

  async renewLease(stream: string): Promise<Lease | null> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.leaseDurationMs);

    const result = await this.drizzle
      .update(schema.indexerLeases)
      .set({ expiresAt })
      .where(
        and(
          eq(schema.indexerLeases.chainId, this.config.chainId),
          eq(schema.indexerLeases.stream, stream),
          eq(schema.indexerLeases.workerId, this.config.workerId),
        ),
      )
      .returning();

    const row = result[0];
    if (!row) {
      return null;
    }

    return {
      chainId: row.chainId,
      stream: row.stream,
      workerId: row.workerId,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  }

  async releaseLease(stream: string): Promise<void> {
    await this.drizzle
      .delete(schema.indexerLeases)
      .where(
        and(
          eq(schema.indexerLeases.chainId, this.config.chainId),
          eq(schema.indexerLeases.stream, stream),
          eq(schema.indexerLeases.workerId, this.config.workerId),
        ),
      );
  }

  async isLeaseValid(stream: string): Promise<boolean> {
    const lease = await this.drizzle.query.indexerLeases.findFirst({
      where: (leases, { eq, and }) =>
        and(
          eq(leases.chainId, this.config.chainId),
          eq(leases.stream, stream),
          eq(leases.workerId, this.config.workerId),
        ),
    });

    if (!lease) {
      return false;
    }

    return lease.expiresAt > new Date();
  }
}
