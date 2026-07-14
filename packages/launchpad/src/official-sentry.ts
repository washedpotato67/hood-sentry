export type OfficialSentryRecord = {
  chainId: number;
  address: `0x${string}`;
  creationTransaction: `0x${string}`;
  creationBlock: bigint;
  creator: `0x${string}`;
  launchpad: `0x${string}`;
  factory: `0x${string}`;
  curve: `0x${string}`;
  codeHash: `0x${string}`;
  name: string;
  symbol: string;
  decimals: number;
  supply: bigint;
  pool?: `0x${string}`;
  quoteAsset?: `0x${string}`;
  graduated: boolean;
  migrationTransaction?: `0x${string}`;
  officialState: 'verified' | 'pending' | 'revoked';
};
export function isOfficialSentry(chainId: number, address: string, r: OfficialSentryRecord) {
  return (
    r.officialState === 'verified' &&
    r.chainId === chainId &&
    r.address.toLowerCase() === address.toLowerCase()
  );
}
