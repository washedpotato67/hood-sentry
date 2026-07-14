export function clampBps(value: bigint): bigint {
  if (value < 0n) return 0n;
  return value > 10_000n ? 10_000n : value;
}

export function ratioBps(value: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) return 0n;
  return clampBps((value * 10_000n) / denominator);
}

export function signedGrowthScore(value: bigint | null, fullScoreAtBps: bigint): bigint {
  if (value === null || value <= 0n || fullScoreAtBps <= 0n) return 0n;
  return clampBps((value * 10_000n) / fullScoreAtBps);
}

export function integerLog2(value: bigint): bigint {
  if (value <= 1n) return 0n;
  let current = value;
  let result = -1n;
  while (current > 0n) {
    current >>= 1n;
    result += 1n;
  }
  return result;
}

export function logScaledBps(value: bigint | null, decimals: number | null): bigint {
  if (value === null || value <= 0n || decimals === null || decimals < 0) return 0n;
  const divisor = 10n ** BigInt(decimals);
  const wholeUnits = value / divisor;
  return clampBps((integerLog2(wholeUnits + 1n) * 10_000n) / 32n);
}

export function compareBigint(left: bigint | null, right: bigint | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left > right ? -1 : 1;
}

export function secondsBetween(earlier: string | null, later: string): bigint | null {
  if (earlier === null) return null;
  const earlierMs = Date.parse(earlier);
  const laterMs = Date.parse(later);
  if (!Number.isFinite(earlierMs) || !Number.isFinite(laterMs)) return null;
  return BigInt(Math.max(0, Math.floor((laterMs - earlierMs) / 1_000)));
}
