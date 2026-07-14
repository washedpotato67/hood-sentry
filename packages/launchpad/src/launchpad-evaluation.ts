export type ContractCheck = {
  chainId: number;
  address: `0x${string}`;
  role: string;
  officialSource: string;
  explorerVerified: boolean;
  runtimeBytecodeHash: `0x${string}`;
  proxy?: string;
  implementation?: `0x${string}`;
  admin?: `0x${string}`;
  verifiedAt: string;
};
export type LaunchpadCandidate = {
  name: string;
  officialSite: string;
  socials: readonly string[];
  contracts: readonly ContractCheck[];
  unknowns: readonly string[];
  findings: readonly string[];
  goNoGo: 'go' | 'no_go' | 'unknown';
};
export function evaluateLaunchpad(
  input: Omit<LaunchpadCandidate, 'findings' | 'goNoGo'>,
): LaunchpadCandidate {
  const findings: string[] = [];
  for (const c of input.contracts) {
    if (!c.explorerVerified) findings.push(`${c.role}: unverified contract`);
    if (c.runtimeBytecodeHash === `0x${'0'.repeat(64)}`)
      findings.push(`${c.role}: missing bytecode`);
  }
  return {
    ...input,
    findings,
    goNoGo: findings.length ? 'no_go' : input.unknowns.length ? 'unknown' : 'go',
  };
}
