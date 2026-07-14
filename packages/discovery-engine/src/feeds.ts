import { compareBigint } from './arithmetic.js';
import type {
  DiscoveryFeed,
  DiscoveryItem,
  SponsoredDiscoveryItem,
  SponsoredPlacement,
} from './types.js';

function compareDate(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right.localeCompare(left);
}

function tieBreak(left: DiscoveryItem, right: DiscoveryItem): number {
  return left.address.toLowerCase().localeCompare(right.address.toLowerCase());
}

export function isEligibleForFeed(item: DiscoveryItem, feed: DiscoveryFeed): boolean {
  if (!item.canonical) return false;
  switch (feed) {
    case 'newPools':
      return item.primaryPoolAddress !== null;
    case 'newlyGraduated':
      return item.launchpadState === 'graduated' || item.launchpadState === 'migrated';
    case 'recentlyMigrated':
      return item.launchpadState === 'migrated';
    case 'recentlyVerifiedProjects':
      return item.projectVerified;
    case 'recentlyScanned':
      return item.lastScannedAt !== null;
    case 'recentCriticalRisk':
      return item.latestCriticalFindingAt !== null;
    case 'canonicalStockTokens':
      return item.tokenType === 'stockToken' && item.canonicalState === 'canonical';
    case 'canonicalEtfTokens':
      return item.tokenType === 'etfToken' && item.canonicalState === 'canonical';
    default:
      return true;
  }
}

export function compareForFeed(
  feed: DiscoveryFeed,
  left: DiscoveryItem,
  right: DiscoveryItem,
): number {
  let result = 0;
  switch (feed) {
    case 'newTokens':
      result =
        compareDate(left.firstSeenAt, right.firstSeenAt) ||
        compareBigint(left.firstSeenBlockNumber, right.firstSeenBlockNumber);
      break;
    case 'newPools':
      result =
        compareDate(left.poolCreatedAt, right.poolCreatedAt) ||
        compareBigint(left.poolCreatedBlockNumber, right.poolCreatedBlockNumber);
      break;
    case 'trending':
      result =
        compareBigint(left.trending.scoreBps, right.trending.scoreBps) ||
        compareBigint(left.trending.confidenceBps, right.trending.confidenceBps);
      break;
    case 'volumeGainers':
      result = compareBigint(left.volumeChangeBps, right.volumeChangeBps);
      break;
    case 'liquidityGainers':
      result = compareBigint(left.liquidityChangeBps, right.liquidityChangeBps);
      break;
    case 'holderGainers':
      result = compareBigint(left.holderGrowth, right.holderGrowth);
      break;
    case 'transactionActivityGainers':
      result = compareBigint(left.transactionGrowthBps, right.transactionGrowthBps);
      break;
    case 'newlyGraduated':
      result = compareDate(left.graduatedAt, right.graduatedAt);
      break;
    case 'recentlyMigrated':
      result = compareDate(left.migratedAt, right.migratedAt);
      break;
    case 'recentlyVerifiedProjects':
      result = compareDate(left.projectVerifiedAt, right.projectVerifiedAt);
      break;
    case 'recentlyScanned':
      result = compareDate(left.lastScannedAt, right.lastScannedAt);
      break;
    case 'recentCriticalRisk':
      result = compareDate(left.latestCriticalFindingAt, right.latestCriticalFindingAt);
      break;
    case 'canonicalStockTokens':
    case 'canonicalEtfTokens':
      result = (left.canonicalTicker ?? '').localeCompare(right.canonicalTicker ?? '');
      break;
    case 'mostWatched':
      result = compareBigint(left.watchlistCount, right.watchlistCount);
      break;
    case 'mostAlerted':
      result = compareBigint(left.alertCount, right.alertCount);
      break;
  }
  return result || tieBreak(left, right);
}

export function rankFeed(feed: DiscoveryFeed, items: readonly DiscoveryItem[]): DiscoveryItem[] {
  return items
    .filter((item) => isEligibleForFeed(item, feed))
    .sort((left, right) => compareForFeed(feed, left, right));
}

export function rankSponsored(
  feed: DiscoveryFeed,
  placements: readonly SponsoredPlacement[],
  items: readonly DiscoveryItem[],
  now: string,
): SponsoredDiscoveryItem[] {
  const byAddress = new Map(
    items.map((item) => [`${item.chainId}:${item.address.toLowerCase()}`, item]),
  );
  return placements
    .filter(
      (placement) => placement.feed === feed && placement.startsAt <= now && placement.endsAt > now,
    )
    .sort(
      (left, right) =>
        right.priority - left.priority ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.placementId.localeCompare(right.placementId),
    )
    .flatMap((placement) => {
      const item = byAddress.get(`${placement.chainId}:${placement.tokenAddress.toLowerCase()}`);
      return item === undefined || !item.canonical ? [] : [{ placement, item }];
    });
}
