export type ApprovalClassification =
  | 'verified_router'
  | 'verified_launchpad'
  | 'application'
  | 'bridge'
  | 'safe'
  | 'unknown_contract'
  | 'eoa'
  | 'malicious'
  | 'obsolete';
export type Approval = {
  owner: `0x${string}`;
  token: `0x${string}`;
  spender: `0x${string}`;
  allowance: bigint;
  max: boolean;
  classification: ApprovalClassification;
  lastUpdate: bigint;
  estimatedValueAtRisk: bigint | null;
};
export function approvalSignals(a: Approval): readonly string[] {
  const s: string[] = [];
  if (a.max && ['unknown_contract', 'eoa', 'malicious', 'obsolete'].includes(a.classification))
    s.push('DANGEROUS_UNLIMITED_APPROVAL');
  if (a.classification === 'eoa') s.push('EOA_SPENDER');
  if (a.classification === 'malicious') s.push('MALICIOUS_SPENDER');
  if (a.classification === 'obsolete') s.push('OBSOLETE_PROTOCOL');
  return s;
}
