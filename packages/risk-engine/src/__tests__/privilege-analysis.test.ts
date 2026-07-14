import { readFileSync } from 'node:fs';
import { type Address, type Hash, type Hex, getAddress, keccak256, stringToHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { ContractPrivilegeAnalyzer } from '../privilege-analysis.js';
import type {
  CurrentRoleController,
  PrivilegeAnalysisInput,
  PrivilegeCapability,
} from '../privilege-types.js';
import type { AddressAuthority } from '../proxy-types.js';

const HASH = `0x${'22'.repeat(32)}` as Hash;
const ADDRESS = getAddress('0x1000000000000000000000000000000000000001');
const OWNER = getAddress('0x2000000000000000000000000000000000000002');
const MINTER = getAddress('0x3000000000000000000000000000000000000003');
const SOURCE = readFileSync(
  new URL('../../fixtures/PrivilegeFixtures.sol', import.meta.url),
  'utf8',
);
const SOURCE_HASH = keccak256(stringToHex(SOURCE));

function authority(address: Address, kind: AddressAuthority['kind']): AddressAuthority {
  return {
    address,
    kind,
    ownerAddress: null,
    safeThreshold: kind === 'safe' ? 2n : null,
    safeOwners: [],
    timelockDelaySeconds: kind === 'timelock' ? 172_800n : null,
    hasCode: kind !== 'eoa',
    evidence: [`fixture ${kind}`],
  };
}

function controller(
  role: string,
  holder: Address | null,
  active: boolean,
  kind: AddressAuthority['kind'] = 'eoa',
): CurrentRoleController {
  return {
    role,
    holder,
    authority:
      holder === null
        ? { ...authority(OWNER, 'renounced'), address: null }
        : authority(holder, kind),
    active,
    provenanceKey: 'chain_role_state',
  };
}

function verifiedInput(
  controllers: readonly CurrentRoleController[] = [
    controller('owner', OWNER, true),
    controller('MINTER_ROLE', MINTER, true, 'safe'),
    controller('OPERATOR_ROLE', OWNER, true),
  ],
): PrivilegeAnalysisInput {
  return {
    chainId: 46630,
    address: ADDRESS,
    sourceBlock: 100n,
    sourceBlockHash: HASH,
    sourceVerified: true,
    sourceFiles: [
      {
        path: 'PrivilegeFixtures.sol',
        source: SOURCE,
        provider: 'blockscout',
        fetchedAt: '2026-07-14T10:00:00.000Z',
        sourceHash: SOURCE_HASH,
      },
    ],
    runtimeBytecode: '0x6001600055',
    controllers,
  };
}

function capabilities(input: PrivilegeAnalysisInput): readonly PrivilegeCapability[] {
  return new ContractPrivilegeAnalyzer()
    .analyze(input)
    .findings.map((finding) => finding.capability);
}

describe('contract source and privilege analysis', () => {
  it('parses inheritance, modifiers, state controls, and external call surfaces', () => {
    const result = new ContractPrivilegeAnalyzer().analyze(verifiedInput());

    expect(result.inheritance.SupplyPrivilegeFixture).toEqual([
      'OwnableFixture',
      'AccessControlFixture',
    ]);
    expect(result.modifiers.map((modifier) => modifier.name)).toEqual(
      expect.arrayContaining(['onlyOwner', 'onlyRole', 'initializer']),
    );
    expect(result.stateVariables.map((variable) => variable.name)).toEqual(
      expect.arrayContaining(['owner', 'MAX_SUPPLY', 'hiddenBlacklist', 'router', 'rOwned']),
    );
    expect(result.externalCallSurfaces.map((surface) => surface.callType)).toEqual(
      expect.arrayContaining(['call', 'delegatecall', 'transfer']),
    );
  });

  it('detects each supported source privilege category with explicit confidence', () => {
    const found = capabilities(verifiedInput());
    expect(found).toEqual(
      expect.arrayContaining([
        'mint',
        'capped_mint',
        'unbounded_mint',
        'burn_authority',
        'pause',
        'blacklist',
        'whitelist',
        'forced_transfer',
        'confiscation',
        'transfer_fees',
        'mutable_fees',
        'fee_limits',
        'fee_exemptions',
        'max_transaction',
        'max_wallet',
        'trading_toggle',
        'mutable_router',
        'mutable_pair',
        'rescue',
        'owner_withdrawal',
        'arbitrary_call',
        'delegatecall',
        'role_administration',
        'upgrade_authorization',
        'rebase',
        'reflection',
        'mutable_metadata',
        'permit',
        'self_destruct',
      ]),
    );
    expect(
      new ContractPrivilegeAnalyzer()
        .analyze(verifiedInput())
        .findings.every((finding) => finding.confidence === 'high'),
    ).toBe(true);
  });

  it('ties Ownable and AccessControl functions to current controllers', () => {
    const result = new ContractPrivilegeAnalyzer().analyze(verifiedInput());
    const cappedMint = result.findings.find(
      (finding) => finding.capability === 'capped_mint' && finding.functionName === 'mint',
    );
    const router = result.findings.find((finding) => finding.capability === 'mutable_router');

    expect(cappedMint?.role).toBe('MINTER_ROLE');
    expect(cappedMint?.currentControllers[0]?.holder).toBe(MINTER);
    expect(cappedMint?.multisig).toBe(true);
    expect(router?.role).toBe('owner');
    expect(router?.currentControllers[0]?.holder).toBe(OWNER);
  });

  it('separates bounded and unbounded mint and fee authority', () => {
    const result = new ContractPrivilegeAnalyzer().analyze(verifiedInput());
    const boundedMint = result.findings.find(
      (finding) => finding.capability === 'capped_mint' && finding.functionName === 'mint',
    );
    const unboundedMint = result.findings.find(
      (finding) =>
        finding.capability === 'unbounded_mint' && finding.functionName === 'unboundedMint',
    );
    const feeSetters = result.findings.filter((finding) => finding.capability === 'mutable_fees');

    expect(boundedMint?.bounds.kind).not.toBe('none');
    expect(unboundedMint?.bounds.kind).toBe('none');
    expect(feeSetters.map((finding) => finding.bounds.kind)).toEqual(
      expect.arrayContaining(['requirement', 'none']),
    );
  });

  it('does not treat a renounced owner as removal of an active minter role', () => {
    const result = new ContractPrivilegeAnalyzer().analyze(
      verifiedInput([
        controller('owner', null, false, 'renounced'),
        controller('MINTER_ROLE', MINTER, true, 'eoa'),
      ]),
    );

    expect(result.warnings).toContain(
      'Owner is renounced while another privileged role remains active.',
    );
    const mint = result.findings.find(
      (finding) => finding.capability === 'mint' && finding.functionName === 'mint',
    );
    expect(mint?.renounced).toBe(false);
    expect(mint?.eoaControlled).toBe(true);
  });

  it('detects a hidden private blacklist and mutable router from verified source', () => {
    const result = new ContractPrivilegeAnalyzer().analyze(verifiedInput());
    expect(
      result.findings.find((finding) => finding.capability === 'blacklist')?.evidence[0],
    ).toMatchObject({
      kind: 'source_ast',
      sourcePath: 'PrivilegeFixtures.sol',
    });
    expect(
      result.findings
        .find((finding) => finding.capability === 'blacklist')
        ?.controlledStateVariables.map((variable) => variable.name),
    ).toContain('hiddenBlacklist');
    expect(
      result.findings.find((finding) => finding.capability === 'mutable_router')?.conclusion,
    ).toBe('confirmed');
  });

  it('derives initializer exposure and disabled implementation initialization separately', () => {
    const result = new ContractPrivilegeAnalyzer().analyze(verifiedInput());
    expect(result.initializationEvidence.exposedInitializer).toBe(true);
    expect(result.initializationEvidence.implementationInitializersDisabled).toBe(true);

    const exposed = new ContractPrivilegeAnalyzer().analyze({
      ...verifiedInput(),
      contractName: 'InitializableFixture',
    });
    expect(exposed.initializationEvidence.exposedInitializer).toBe(true);
    expect(exposed.initializationEvidence.implementationInitializersDisabled).toBe(false);
  });

  it('uses ABI evidence at medium confidence when source is unavailable', () => {
    const result = new ContractPrivilegeAnalyzer().analyze({
      ...verifiedInput(),
      sourceVerified: false,
      sourceFiles: undefined,
      abi: [
        {
          type: 'function',
          name: 'setRouter',
          inputs: [{ name: 'router', type: 'address' }],
          outputs: [],
          stateMutability: 'nonpayable',
        },
      ],
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      capability: 'mutable_router',
      confidence: 'medium',
      conclusion: 'indicated',
    });
  });

  it('uses selector heuristics at low confidence and avoids certainty', () => {
    const selector = keccak256(stringToHex('mint(address,uint256)')).slice(2, 10);
    const result = new ContractPrivilegeAnalyzer().analyze({
      ...verifiedInput(),
      sourceVerified: false,
      sourceFiles: undefined,
      abi: null,
      runtimeBytecode: `0x63${selector}600052` as Hex,
    });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      capability: 'mint',
      confidence: 'low',
      conclusion: 'indicated',
    });
    expect(result.findings[0]?.explanation).toContain('does not prove behavior or authorization');
  });
});
