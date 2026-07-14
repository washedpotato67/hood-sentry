export type VerificationBadge =
  | 'wallet_claim'
  | 'domain_verified'
  | 'social_verified'
  | 'contract_verified'
  | 'team_supplied'
  | 'audit_linked';
export type ProjectProfile = {
  id: string;
  slug: string;
  name: string;
  description: string;
  ownerWallet: `0x${string}`;
  officialContracts: readonly `0x${string}`[];
  badges: readonly VerificationBadge[];
  status: 'pending' | 'active' | 'compromised' | 'revoked';
  version: number;
  verificationExpiresAt?: string;
};
export type ClaimChallenge = {
  id: string;
  profileId: string;
  wallet: `0x${string}`;
  domain: string;
  nonce: string;
  expiresAt: number;
  consumed: boolean;
};
export function issueClaim(
  profileId: string,
  wallet: `0x${string}`,
  domain: string,
  now: number,
): ClaimChallenge {
  return {
    id: `claim_${profileId}:${wallet}:${now}`,
    profileId,
    wallet,
    domain,
    nonce: `nonce_${now}`,
    expiresAt: now + 300000,
    consumed: false,
  };
}
export function consumeClaim(
  c: ClaimChallenge,
  wallet: `0x${string}`,
  domain: string,
  now: number,
  validSignature: boolean,
) {
  if (
    c.consumed ||
    now > c.expiresAt ||
    c.wallet.toLowerCase() !== wallet.toLowerCase() ||
    c.domain !== domain ||
    !validSignature
  )
    throw new Error('Invalid project claim');
  return { ...c, consumed: true };
}
