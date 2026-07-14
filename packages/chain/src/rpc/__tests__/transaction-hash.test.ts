import { describe, expect, it } from 'vitest';
import { calculateSerializedTransactionHash } from '../rpc-client.js';

describe('calculateSerializedTransactionHash', () => {
  it('uses the Ethereum Keccak-256 transaction hash', () => {
    expect(calculateSerializedTransactionHash('0x')).toBe(
      '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
    );
  });
});
