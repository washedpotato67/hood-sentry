export function pow10(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error('Decimal configuration is outside the supported range');
  }
  return 10n ** BigInt(decimals);
}

export function mulDivFloor(left: bigint, right: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Division denominator must be positive');
  return (left * right) / denominator;
}

export function ratioBps(value: bigint, reference: bigint): bigint | null {
  if (reference === 0n) return null;
  return ((value - reference) * 10_000n) / reference;
}

export function absoluteDifferenceBps(left: bigint, right: bigint): bigint | null {
  if (left <= 0n || right <= 0n) return null;
  const difference = left >= right ? left - right : right - left;
  const denominator = left < right ? left : right;
  return (difference * 10_000n) / denominator;
}

export function scaleInteger(value: bigint, fromDecimals: number, toDecimals: number): bigint {
  if (fromDecimals === toDecimals) return value;
  if (fromDecimals < toDecimals) return value * pow10(toDecimals - fromDecimals);
  return value / pow10(fromDecimals - toDecimals);
}

export function median(values: readonly bigint[]): bigint | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle];
  if (middleValue === undefined) return null;
  if (sorted.length % 2 === 1) return middleValue;
  const lower = sorted[middle - 1];
  return lower === undefined ? null : (lower + middleValue) / 2n;
}

export function clampBps(value: bigint): bigint {
  if (value < 0n) return 0n;
  return value > 10_000n ? 10_000n : value;
}
