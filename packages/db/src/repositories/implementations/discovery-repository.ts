import {
  type DiscoveryItem,
  type SponsoredPlacement,
  parseDiscoveryItem,
  parseSponsoredPlacement,
  serializeDiscoveryItem,
  serializeSponsoredPlacement,
} from '@hood-sentry/discovery-engine';
import { and, eq, gte, lte } from 'drizzle-orm';
import { getAddress } from 'viem';
import { z } from 'zod';
import type { Database } from '../../client.js';
import * as schema from '../../schema/index.js';
import type {
  DiscoveryRepository,
  SponsorshipAuditInput,
} from '../interfaces/discovery-repository.js';

const discoveryFeedSchema = z.enum([
  'newTokens',
  'newPools',
  'trending',
  'volumeGainers',
  'liquidityGainers',
  'holderGainers',
  'transactionActivityGainers',
  'newlyGraduated',
  'recentlyMigrated',
  'recentlyVerifiedProjects',
  'recentlyScanned',
  'recentCriticalRisk',
  'canonicalStockTokens',
  'canonicalEtfTokens',
  'mostWatched',
  'mostAlerted',
]);

function mapPlacement(row: typeof schema.sponsoredPlacements.$inferSelect): SponsoredPlacement {
  const stored = serializeSponsoredPlacement({
    placementId: row.placement_id,
    chainId: row.chain_id,
    tokenAddress: getAddress(row.token_address),
    feed: discoveryFeedSchema.parse(row.feed),
    priority: row.priority,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    label: 'Sponsored',
    disclosure: row.disclosure,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by,
  });
  return parseSponsoredPlacement(stored);
}

export class DrizzleDiscoveryRepository implements DiscoveryRepository {
  constructor(private readonly db: Database['db']) {}

  async saveSnapshot(item: DiscoveryItem): Promise<void> {
    const tokenAddress = item.address.toLowerCase();
    const payload = serializeDiscoveryItem(item);
    const values = {
      chain_id: item.chainId,
      token_address: tokenAddress,
      methodology_version: item.trending.methodologyVersion,
      source_block_number: item.sourceBlockNumber,
      source_block_hash: item.sourceBlockHash,
      score_bps: item.trending.scoreBps.toString(),
      confidence_bps: item.trending.confidenceBps.toString(),
      payload,
      canonical: item.canonical,
      observed_at: new Date(item.observedAt),
    };
    await this.db.transaction(async (transaction) => {
      await transaction.insert(schema.discoverySnapshots).values(values).onConflictDoNothing();
      await transaction
        .insert(schema.discoveryCurrent)
        .values(values)
        .onConflictDoUpdate({
          target: [
            schema.discoveryCurrent.chain_id,
            schema.discoveryCurrent.token_address,
            schema.discoveryCurrent.methodology_version,
          ],
          set: {
            source_block_number: item.sourceBlockNumber,
            source_block_hash: item.sourceBlockHash,
            score_bps: item.trending.scoreBps.toString(),
            confidence_bps: item.trending.confidenceBps.toString(),
            payload,
            canonical: item.canonical,
            observed_at: new Date(item.observedAt),
            updated_at: new Date(),
          },
          setWhere: lte(schema.discoveryCurrent.source_block_number, item.sourceBlockNumber),
        });
    });
  }

  async listCurrent(
    chainId: number,
    methodologyVersion: string,
  ): Promise<readonly DiscoveryItem[]> {
    const rows = await this.db
      .select({ payload: schema.discoveryCurrent.payload })
      .from(schema.discoveryCurrent)
      .where(
        and(
          eq(schema.discoveryCurrent.chain_id, chainId),
          eq(schema.discoveryCurrent.methodology_version, methodologyVersion),
          eq(schema.discoveryCurrent.canonical, true),
        ),
      );
    return rows.map((row) => parseDiscoveryItem(row.payload));
  }

  async saveSponsoredPlacement(
    placement: SponsoredPlacement,
    audit: SponsorshipAuditInput,
  ): Promise<void> {
    if (placement.placementId !== audit.placementId)
      throw new Error('Sponsorship audit does not match placement');
    await this.db.transaction(async (transaction) => {
      await transaction
        .insert(schema.sponsoredPlacements)
        .values({
          placement_id: placement.placementId,
          chain_id: placement.chainId,
          token_address: placement.tokenAddress.toLowerCase(),
          feed: placement.feed,
          priority: placement.priority,
          starts_at: new Date(placement.startsAt),
          ends_at: new Date(placement.endsAt),
          label: placement.label,
          disclosure: placement.disclosure,
          created_by: placement.createdBy,
          created_at: new Date(placement.createdAt),
          updated_at: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.sponsoredPlacements.placement_id,
          set: {
            priority: placement.priority,
            starts_at: new Date(placement.startsAt),
            ends_at: new Date(placement.endsAt),
            disclosure: placement.disclosure,
            updated_at: new Date(),
          },
        });
      await transaction.insert(schema.sponsoredPlacementAudit).values({
        placement_id: audit.placementId,
        action: audit.action,
        actor_id: audit.actorId,
        before_payload: audit.before === null ? null : serializeSponsoredPlacement(audit.before),
        after_payload: audit.after === null ? null : serializeSponsoredPlacement(audit.after),
        reason: audit.reason,
      });
    });
  }

  async listSponsoredPlacements(chainId: number): Promise<readonly SponsoredPlacement[]> {
    const rows = await this.db
      .select()
      .from(schema.sponsoredPlacements)
      .where(eq(schema.sponsoredPlacements.chain_id, chainId));
    return rows.map(mapPlacement);
  }

  async markNonCanonical(chainId: number, fromBlock: bigint, toBlock: bigint): Promise<void> {
    const affected = and(
      eq(schema.discoverySnapshots.chain_id, chainId),
      gte(schema.discoverySnapshots.source_block_number, fromBlock),
      lte(schema.discoverySnapshots.source_block_number, toBlock),
    );
    await this.db.transaction(async (transaction) => {
      await transaction.update(schema.discoverySnapshots).set({ canonical: false }).where(affected);
      await transaction
        .delete(schema.discoveryCurrent)
        .where(
          and(
            eq(schema.discoveryCurrent.chain_id, chainId),
            gte(schema.discoveryCurrent.source_block_number, fromBlock),
            lte(schema.discoveryCurrent.source_block_number, toBlock),
          ),
        );
    });
  }
}
