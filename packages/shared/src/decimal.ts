const PRECISION = 18n;
const BASE = 10n ** PRECISION;

export function toRawAmount(amount: string, decimals: number): bigint {
  const [whole, fraction = ''] = amount.split('.');
  if (!whole) throw new Error('Invalid amount');
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFraction);
}

export function fromRawAmount(raw: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  if (fraction === 0n) return whole.toString();
  const fractionStr = fraction.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${whole}.${fractionStr}`;
}

export function mulRaw(a: bigint, b: bigint): bigint {
  return (a * b) / BASE;
}

export function divRaw(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error('Division by zero');
  return (a * BASE) / b;
}

export function bpsOf(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / 10000n;
}

export { PRECISION, BASE };
