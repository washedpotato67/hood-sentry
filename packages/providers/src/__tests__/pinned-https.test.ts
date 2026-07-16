import { describe, expect, it } from 'vitest';
import { isPublicAddress } from '../pinned-https.js';

describe('delivery destination controls', () => {
  it('rejects private, loopback, link-local, and documentation addresses', () => {
    expect(isPublicAddress('127.0.0.1')).toBe(false);
    expect(isPublicAddress('10.0.0.1')).toBe(false);
    expect(isPublicAddress('169.254.169.254')).toBe(false);
    expect(isPublicAddress('192.0.2.1')).toBe(false);
    expect(isPublicAddress('::1')).toBe(false);
    expect(isPublicAddress('fd00::1')).toBe(false);
  });

  it('accepts public IPv4 and IPv6 addresses', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
  });
});
