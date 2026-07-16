import { pow10 } from './arithmetic.js';

export interface QuoteNormalizationRate {
  readonly sourceDecimals: number;
  readonly normalizedDecimals: number;
  readonly priceRaw: bigint;
  readonly priceDecimals: number;
}

export interface ConstantProductQuoteInput {
  readonly amountInRaw: bigint;
  readonly reserveInRaw: bigint;
  readonly reserveOutRaw: bigint;
  readonly feeRaw: bigint;
  readonly feeDenominator: bigint;
}

export interface ConstantProductQuoteResult {
  readonly amountOutRaw: bigint;
  readonly priceImpactBps: bigint;
}

function validateRate(rate: QuoteNormalizationRate): void {
  pow10(rate.sourceDecimals);
  pow10(rate.normalizedDecimals);
  pow10(rate.priceDecimals);
  if (rate.priceRaw <= 0n) throw new Error('Quote normalization price must be positive');
}

export function normalizeQuoteAmount(amountRaw: bigint, rate: QuoteNormalizationRate): bigint {
  if (amountRaw < 0n) throw new Error('Quote amount must be unsigned');
  validateRate(rate);
  return (
    (amountRaw * rate.priceRaw * pow10(rate.normalizedDecimals)) /
    (pow10(rate.sourceDecimals) * pow10(rate.priceDecimals))
  );
}

export function denormalizeQuoteAmount(
  normalizedAmountRaw: bigint,
  rate: QuoteNormalizationRate,
): bigint {
  if (normalizedAmountRaw < 0n) throw new Error('Normalized quote amount must be unsigned');
  validateRate(rate);
  return (
    (normalizedAmountRaw * pow10(rate.sourceDecimals) * pow10(rate.priceDecimals)) /
    (rate.priceRaw * pow10(rate.normalizedDecimals))
  );
}

export function quoteConstantProductSwap(
  input: ConstantProductQuoteInput,
): ConstantProductQuoteResult {
  if (input.amountInRaw <= 0n || input.reserveInRaw <= 0n || input.reserveOutRaw <= 0n) {
    throw new Error('Constant-product quote amounts and reserves must be positive');
  }
  if (input.feeDenominator <= 0n || input.feeRaw < 0n || input.feeRaw >= input.feeDenominator) {
    throw new Error('Constant-product fee configuration is invalid');
  }
  const amountInAfterFee = input.amountInRaw * (input.feeDenominator - input.feeRaw);
  const numerator = amountInAfterFee * input.reserveOutRaw;
  const denominator = input.reserveInRaw * input.feeDenominator + amountInAfterFee;
  const amountOutRaw = numerator / denominator;
  if (amountOutRaw <= 0n) throw new Error('Constant-product quote output rounds to zero');
  const executionToSpotBps =
    (amountOutRaw * input.reserveInRaw * 10_000n) / (input.amountInRaw * input.reserveOutRaw);
  return {
    amountOutRaw,
    priceImpactBps: executionToSpotBps >= 10_000n ? 0n : 10_000n - executionToSpotBps,
  };
}
