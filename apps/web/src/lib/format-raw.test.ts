import { describe, expect, it } from 'vitest';
import { formatRaw } from './api';

describe('formatRaw', () => {
  it('keeps a small price distinguishable from zero', () => {
    // 14407043380 wei at 18 decimals is 0.0000000144…, a real price. Rendering it
    // as "0.000000" makes a priced token look worthless, which is the opposite of
    // what the number is for.
    const formatted = formatRaw('14407043380', 18);

    expect(formatted).not.toBe('0.000000');
    expect(Number(formatted)).toBeGreaterThan(0);
    expect(Number(formatted)).toBeCloseTo(1.440704338e-8, 12);
  });

  it('renders an exact zero as zero', () => {
    expect(formatRaw('0', 18)).toBe('0');
  });

  it('still shows ordinary magnitudes to six significant digits', () => {
    expect(formatRaw('1500000000000000000', 18)).toBe('1.5');
    expect(formatRaw('8960777488159138965', 18)).toBe('8.960777');
  });

  it('groups the whole part and keeps the sign', () => {
    expect(formatRaw('1234567000000000000000000', 18)).toBe('1,234,567');
    expect(formatRaw('-1500000000000000000', 18)).toBe('-1.5');
  });

  it('reports missing or malformed values as unavailable', () => {
    expect(formatRaw(null, 18)).toBe('Unavailable');
    expect(formatRaw('not-a-number', 18)).toBe('Unavailable');
  });
});
