import { absoluteDifferenceBps, clampBps } from './arithmetic.js';
import type { OutlierInput, OutlierResult } from './types.js';

export function detectOutliers(input: OutlierInput): OutlierResult {
  const reasons = [...input.observation.reasons];
  const rules = {
    priceJump: 5_000n,
    volumeSpike: 10_000n,
    washShare: 8_000n,
    sourceMismatch: 1_000n,
    stablecoinDepeg: 300n,
  };
  const compare = (
    left: bigint | null,
    right: bigint | null,
    threshold: bigint,
    reason: string,
  ) => {
    if (left === null || right === null) return;
    const difference = absoluteDifferenceBps(left, right);
    if (difference !== null && difference > threshold) reasons.push(reason);
  };
  compare(
    input.observation.priceRaw,
    input.previousPriceRaw,
    rules.priceJump,
    'ABNORMAL_PRICE_JUMP',
  );
  compare(
    input.observation.priceRaw,
    input.stablecoinTargetRaw,
    rules.stablecoinDepeg,
    'STABLECOIN_DEPEG',
  );
  compare(
    input.observation.priceRaw,
    input.postGraduationDexPriceRaw,
    rules.sourceMismatch,
    'POST_GRADUATION_SOURCE_MISMATCH',
  );
  if (
    input.windowVolumeRaw !== null &&
    input.previousWindowVolumeRaw !== null &&
    input.previousWindowVolumeRaw > 0n &&
    ((input.windowVolumeRaw - input.previousWindowVolumeRaw) * 10_000n) /
      input.previousWindowVolumeRaw >
      rules.volumeSpike
  ) {
    reasons.push('FLASH_VOLUME_SPIKE');
  }
  if (
    input.windowVolumeRaw !== null &&
    input.windowVolumeRaw > 0n &&
    input.walletVolumeRaw !== null &&
    (input.walletVolumeRaw * 10_000n) / input.windowVolumeRaw > rules.washShare
  ) {
    reasons.push('ONE_WALLET_WASH_VOLUME');
  }
  const unique = [...new Set(reasons)];
  const unavailable = unique.some((reason) =>
    [
      'NEGATIVE_PRICE',
      'ZERO_PRICE',
      'UNVERIFIED_PROTOCOL',
      'CURVE_DISABLED_AFTER_MIGRATION',
    ].includes(reason),
  );
  const penalty = BigInt(unique.length) * 500n;
  return {
    available: !unavailable,
    confidenceBps: unavailable ? 0n : clampBps(input.observation.confidenceBps - penalty),
    reasons: unique,
  };
}
