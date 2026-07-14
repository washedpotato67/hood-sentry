import { secondsBetween } from './arithmetic.js';
import type { DiscoveryFilters, DiscoveryItem } from './types.js';

export function matchesDiscoveryFilters(
  item: DiscoveryItem,
  filters: DiscoveryFilters,
  now: string,
): boolean {
  const tokenAge = secondsBetween(item.firstSeenAt, now);
  const poolAge = secondsBetween(item.poolCreatedAt, now);
  const checks: readonly (() => boolean)[] = [
    () =>
      filters.maximumTokenAgeSeconds === undefined ||
      (tokenAge !== null && tokenAge <= filters.maximumTokenAgeSeconds),
    () =>
      filters.maximumPoolAgeSeconds === undefined ||
      (poolAge !== null && poolAge <= filters.maximumPoolAgeSeconds),
    () =>
      filters.minimumLiquidityRaw === undefined ||
      (item.liquidityRaw !== null && item.liquidityRaw >= filters.minimumLiquidityRaw),
    () =>
      filters.minimumVolumeRaw === undefined ||
      (item.volumeRaw !== null && item.volumeRaw >= filters.minimumVolumeRaw),
    () =>
      filters.minimumHolders === undefined ||
      (item.holderCount !== null && item.holderCount >= filters.minimumHolders),
    () => filters.riskGrades === undefined || filters.riskGrades.includes(item.riskGrade),
    () =>
      filters.minimumRiskCompletenessBps === undefined ||
      (item.riskCompletenessBps !== null &&
        item.riskCompletenessBps >= filters.minimumRiskCompletenessBps),
    () => filters.projectVerified === undefined || item.projectVerified === filters.projectVerified,
    () => filters.canonicalState === undefined || item.canonicalState === filters.canonicalState,
    () => filters.protocolKey === undefined || item.protocolKey === filters.protocolKey,
    () => filters.launchpadKey === undefined || item.launchpadKey === filters.launchpadKey,
    () =>
      filters.quoteAssetAddress === undefined ||
      item.quoteAssetAddress?.toLowerCase() === filters.quoteAssetAddress.toLowerCase(),
    () =>
      filters.migrationStatus === undefined ||
      (filters.migrationStatus === 'migrated') === (item.launchpadState === 'migrated'),
    () =>
      filters.graduationStatus === undefined ||
      (filters.graduationStatus === 'graduated') ===
        (item.launchpadState === 'graduated' || item.launchpadState === 'migrated'),
    () =>
      filters.maximumDataAgeSeconds === undefined ||
      item.dataFreshnessSeconds <= filters.maximumDataAgeSeconds,
  ];
  return checks.every((check) => check());
}
