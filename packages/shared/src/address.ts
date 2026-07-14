import { type Address, getAddress } from 'viem';

export type ChecksumAddress = Address;

export function toChecksumAddress(address: string): ChecksumAddress {
  return getAddress(address);
}

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function isChecksumAddress(address: string): boolean {
  try {
    return getAddress(address) === address;
  } catch {
    return false;
  }
}
