import { describe, expect, it } from 'vitest';
import { bpsOf, divRaw, fromRawAmount, mulRaw, toRawAmount } from '../decimal.js';

describe('toRawAmount', () => {
  it('converts whole number with 18 decimals', () => {
    expect(toRawAmount('1', 18)).toBe(1000000000000000000n);
  });

  it('converts decimal with 18 decimals', () => {
    expect(toRawAmount('1.5', 18)).toBe(1500000000000000000n);
  });

  it('converts small decimal with 18 decimals', () => {
    expect(toRawAmount('0.001', 18)).toBe(1000000000000000n);
  });

  it('converts with 6 decimals (USDC-like)', () => {
    expect(toRawAmount('100', 6)).toBe(100000000n);
    expect(toRawAmount('100.5', 6)).toBe(100500000n);
  });

  it('truncates excess decimals', () => {
    expect(toRawAmount('1.123456789', 6)).toBe(1123456n);
  });

  it('pads missing decimals', () => {
    expect(toRawAmount('1.1', 6)).toBe(1100000n);
  });
});

describe('fromRawAmount', () => {
  it('converts raw amount with 18 decimals', () => {
    expect(fromRawAmount(1000000000000000000n, 18)).toBe('1');
  });

  it('converts raw amount with fractional part', () => {
    expect(fromRawAmount(1500000000000000000n, 18)).toBe('1.5');
  });

  it('converts zero', () => {
    expect(fromRawAmount(0n, 18)).toBe('0');
  });

  it('converts with 6 decimals', () => {
    expect(fromRawAmount(100000000n, 6)).toBe('100');
    expect(fromRawAmount(100500000n, 6)).toBe('100.5');
  });
});

describe('bpsOf', () => {
  it('calculates basis points correctly', () => {
    expect(bpsOf(10000n, 100)).toBe(100n);
    expect(bpsOf(10000n, 5000)).toBe(5000n);
    expect(bpsOf(10000n, 10000)).toBe(10000n);
  });

  it('handles zero', () => {
    expect(bpsOf(0n, 100)).toBe(0n);
    expect(bpsOf(10000n, 0)).toBe(0n);
  });
});

describe('mulRaw', () => {
  it('multiplies two raw amounts', () => {
    const a = 2000000000000000000n;
    const b = 3000000000000000000n;
    expect(mulRaw(a, b)).toBe(6000000000000000000n);
  });
});

describe('divRaw', () => {
  it('divides two raw amounts', () => {
    const a = 6000000000000000000n;
    const b = 2000000000000000000n;
    expect(divRaw(a, b)).toBe(3000000000000000000n);
  });

  it('throws on division by zero', () => {
    expect(() => divRaw(1000000000000000000n, 0n)).toThrow('Division by zero');
  });
});
