import { describe, expect, it } from 'vitest';
import { isChecksumAddress, normalizeAddress, toChecksumAddress } from '../address.js';

describe('toChecksumAddress', () => {
  it('converts lowercase address to checksum', () => {
    const lower = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
    const checksum = toChecksumAddress(lower);
    expect(checksum).toBe('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73');
  });

  it('accepts already checksummed address', () => {
    const checksum = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
    expect(toChecksumAddress(checksum)).toBe(checksum);
  });

  it('throws on invalid address', () => {
    expect(() => toChecksumAddress('not-an-address')).toThrow();
  });
});

describe('normalizeAddress', () => {
  it('converts to lowercase', () => {
    const addr = '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73';
    expect(normalizeAddress(addr)).toBe('0x0bd7d308f8e1639fab988df18a8011f41eacad73');
  });
});

describe('isChecksumAddress', () => {
  it('returns true for valid checksum', () => {
    expect(isChecksumAddress('0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73')).toBe(true);
  });

  it('returns false for lowercase address', () => {
    expect(isChecksumAddress('0x0bd7d308f8e1639fab988df18a8011f41eacad73')).toBe(false);
  });

  it('returns false for invalid address', () => {
    expect(isChecksumAddress('not-an-address')).toBe(false);
  });
});
