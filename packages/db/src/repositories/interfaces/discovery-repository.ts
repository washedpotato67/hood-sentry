import type { DiscoveryItem, SponsoredPlacement } from '@hood-sentry/discovery-engine';

export type SponsorshipAuditAction = 'created' | 'updated' | 'disabled' | 'expired';

export interface SponsorshipAuditInput {
  placementId: string;
  action: SponsorshipAuditAction;
  actorId: string;
  before: SponsoredPlacement | null;
  after: SponsoredPlacement | null;
  reason: string;
}

export interface DiscoveryRepository {
  saveSnapshot(item: DiscoveryItem): Promise<void>;
  listCurrent(chainId: number, methodologyVersion: string): Promise<readonly DiscoveryItem[]>;
  saveSponsoredPlacement(
    placement: SponsoredPlacement,
    audit: SponsorshipAuditInput,
  ): Promise<void>;
  listSponsoredPlacements(chainId: number): Promise<readonly SponsoredPlacement[]>;
  markNonCanonical(chainId: number, fromBlock: bigint, toBlock: bigint): Promise<void>;
}
