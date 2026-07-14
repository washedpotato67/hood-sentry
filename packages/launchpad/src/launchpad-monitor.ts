export type LaunchpadDependency = {
  role: string;
  address: `0x${string}`;
  bytecodeHash: `0x${string}`;
  verified: boolean;
  mutable: boolean;
};
export type DependencyCheck = {
  role: string;
  address: `0x${string}`;
  expectedHash: `0x${string}`;
  actualHash: `0x${string}`;
  status: 'ok' | 'blocked' | 'unknown';
  finding?: string;
};
export function checkLaunchpadDependencies(
  deps: readonly LaunchpadDependency[],
  actual: ReadonlyMap<string, `0x${string}`>,
): readonly DependencyCheck[] {
  return deps.map((d) => {
    const hash = actual.get(d.address.toLowerCase());
    if (!d.verified)
      return {
        role: d.role,
        address: d.address,
        expectedHash: d.bytecodeHash,
        actualHash: hash ?? '0x',
        status: 'blocked',
        finding: 'Unverified dependency',
      };
    if (hash === undefined)
      return {
        role: d.role,
        address: d.address,
        expectedHash: d.bytecodeHash,
        actualHash: '0x',
        status: 'unknown',
        finding: 'Bytecode unavailable',
      };
    if (hash.toLowerCase() !== d.bytecodeHash.toLowerCase())
      return {
        role: d.role,
        address: d.address,
        expectedHash: d.bytecodeHash,
        actualHash: hash,
        status: 'blocked',
        finding: 'Bytecode changed',
      };
    return {
      role: d.role,
      address: d.address,
      expectedHash: d.bytecodeHash,
      actualHash: hash,
      status: 'ok',
    };
  });
}
