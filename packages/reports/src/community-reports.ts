export type ReportSubject =
  | 'token'
  | 'wallet'
  | 'project'
  | 'profile'
  | 'contract'
  | 'deployer'
  | 'website'
  | 'social';
export type ReportStatus =
  | 'SUBMITTED'
  | 'TRIAGED'
  | 'UNDER_REVIEW'
  | 'NEEDS_MORE_EVIDENCE'
  | 'UPHELD'
  | 'REJECTED'
  | 'APPEALED'
  | 'FINAL'
  | 'WITHDRAWN';
export type ReportReason =
  | 'impersonation'
  | 'wrong_official_address'
  | 'compromised_website'
  | 'compromised_social'
  | 'undisclosed_mint'
  | 'false_liquidity_lock'
  | 'false_supply_claim'
  | 'malicious_transfer'
  | 'phishing'
  | 'migrated_contract'
  | 'incorrect_metadata'
  | 'factual_correction'
  | 'other';
export type CommunityReport = {
  id: string;
  reporter: string;
  reporterWallet?: `0x${string}`;
  subject: ReportSubject;
  subjectId: string;
  reason: ReportReason;
  description: string;
  evidence: readonly string[];
  evidenceHash: string;
  links: readonly string[];
  timestamp: string;
  status: ReportStatus;
  history: readonly { status: ReportStatus; moderator: string; at: string; reason: string }[];
};
const terminal: ReportStatus[] = ['FINAL'];
export function transitionReport(
  r: CommunityReport,
  next: ReportStatus,
  moderator: string,
  reason: string,
): CommunityReport {
  if (terminal.includes(r.status)) throw new Error('Final report is immutable');
  if (!moderator) throw new Error('Moderator required');
  return {
    ...r,
    status: next,
    history: [...r.history, { status: next, moderator, at: new Date().toISOString(), reason }],
  };
}
