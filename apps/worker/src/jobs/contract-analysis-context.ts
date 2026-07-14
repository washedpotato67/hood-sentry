import type { BlockscoutEnrichmentResult } from '@hood-sentry/chain';
import {
  type AttributedSourceFile,
  ContractPrivilegeAnalyzer,
  type ExplorerProxyClaim,
  PrivilegeStateReader,
  type ProxyAnalysisClient,
  ProxyAnalyzer,
  type RiskDataSource,
  type RiskScanContext,
  type SourceVerificationClaim,
  extractAccessControlRoles,
} from '@hood-sentry/risk-engine';
import { type Address, type Hash, getAddress, isHash, keccak256, stringToHex } from 'viem';
import type { RiskContextLoader, RiskScanJobInput } from './risk-scan.js';

export interface ContractMetadataProvider {
  enrichContract(chainId: number, address: string): Promise<BlockscoutEnrichmentResult>;
}

function unavailableEnrichment(message: string): BlockscoutEnrichmentResult {
  return {
    status: 'unavailable',
    metadata: null,
    warnings: [{ code: 'PROVIDER_UNAVAILABLE', message, provider: 'blockscout' }],
    cacheStatus: 'miss',
  };
}

async function loadEnrichment(
  provider: ContractMetadataProvider,
  chainId: number,
  address: Address,
): Promise<BlockscoutEnrichmentResult> {
  try {
    return await provider.enrichContract(chainId, address);
  } catch (error) {
    return unavailableEnrichment(
      error instanceof Error ? error.message : 'Blockscout enrichment failed',
    );
  }
}

function explorerClaim(result: BlockscoutEnrichmentResult): ExplorerProxyClaim | undefined {
  const metadata = result.metadata;
  if (metadata === null) return undefined;
  return {
    provider: metadata.provenance.provider,
    fetchedAt: metadata.provenance.fetchedAt,
    proxyType: metadata.proxy.proxyType,
    implementationAddresses: metadata.proxy.implementationAddresses,
    adminAddress: metadata.proxy.adminAddress,
  };
}

function sourceFiles(result: BlockscoutEnrichmentResult): readonly AttributedSourceFile[] {
  const metadata = result.metadata;
  if (metadata === null || !metadata.verified) return [];
  return metadata.sourceFiles.map((file) => ({
    path: file.path,
    source: file.source,
    provider: metadata.provenance.provider,
    fetchedAt: metadata.provenance.fetchedAt,
    sourceHash: keccak256(stringToHex(file.source)),
  }));
}

function sourceClaim(
  result: BlockscoutEnrichmentResult,
  address: Address,
): SourceVerificationClaim | null {
  const metadata = result.metadata;
  if (metadata === null) return null;
  return {
    address,
    verified: metadata.verified,
    provider: metadata.provenance.provider,
    fetchedAt: metadata.provenance.fetchedAt,
    sourceHash:
      metadata.sourceHash !== null && isHash(metadata.sourceHash) ? metadata.sourceHash : null,
  };
}

function pinnedBlockHash(context: RiskScanContext): Hash {
  if (!isHash(context.sourceBlockHash))
    throw new Error('Risk context source block hash is malformed');
  return context.sourceBlockHash;
}

function explorerDataSource(
  result: BlockscoutEnrichmentResult,
  key: string,
  context: RiskScanContext,
): RiskDataSource {
  const metadata = result.metadata;
  return {
    key,
    kind: 'explorer',
    provider: metadata?.provenance.provider ?? 'blockscout',
    status: metadata === null ? 'unavailable' : metadata.verified ? 'available' : 'unavailable',
    sourceBlock: context.sourceBlock,
    sourceBlockHash: context.sourceBlockHash,
    fetchedAt: metadata?.provenance.fetchedAt ?? null,
    reason:
      metadata === null
        ? result.warnings.map((warning) => warning.code).join(',') || 'PROVIDER_UNAVAILABLE'
        : metadata.verified
          ? null
          : 'SOURCE_UNVERIFIED',
  };
}

function abiDataSource(
  result: BlockscoutEnrichmentResult,
  context: RiskScanContext,
): RiskDataSource {
  const metadata = result.metadata;
  return {
    key: 'contract_abi',
    kind: 'explorer',
    provider: metadata?.provenance.provider ?? 'blockscout',
    status: metadata?.abi === null || metadata?.abi === undefined ? 'unavailable' : 'available',
    sourceBlock: context.sourceBlock,
    sourceBlockHash: context.sourceBlockHash,
    fetchedAt: metadata?.provenance.fetchedAt ?? null,
    reason: metadata?.abi === null || metadata?.abi === undefined ? 'ABI_UNAVAILABLE' : null,
  };
}

function chainDataSource(key: string, context: RiskScanContext): RiskDataSource {
  return {
    key,
    kind: 'chain',
    provider: 'shared_resilient_rpc',
    status: 'available',
    sourceBlock: context.sourceBlock,
    sourceBlockHash: context.sourceBlockHash,
    fetchedAt: null,
    reason: null,
  };
}

function mergeSources(
  current: readonly RiskDataSource[],
  additions: readonly RiskDataSource[],
): RiskDataSource[] {
  const sources = new Map(current.map((source) => [source.key, source]));
  for (const source of additions) sources.set(source.key, source);
  return [...sources.values()].sort((left, right) => left.key.localeCompare(right.key));
}

export class ContractAnalysisContextLoader implements RiskContextLoader {
  private readonly proxyAnalyzer: ProxyAnalyzer;
  private readonly privilegeAnalyzer = new ContractPrivilegeAnalyzer();
  private readonly privilegeStateReader: PrivilegeStateReader;

  constructor(
    private readonly baseLoader: RiskContextLoader,
    private readonly chainClient: ProxyAnalysisClient,
    private readonly metadataProvider: ContractMetadataProvider,
  ) {
    this.proxyAnalyzer = new ProxyAnalyzer(chainClient);
    this.privilegeStateReader = new PrivilegeStateReader(chainClient);
  }

  async loadContext(input: RiskScanJobInput, methodologyVersion: string): Promise<RiskScanContext> {
    const context = await this.baseLoader.loadContext(input, methodologyVersion);
    const target = getAddress(context.target.address);
    const targetEnrichment = await loadEnrichment(
      this.metadataProvider,
      context.target.chainId,
      target,
    );
    const preliminaryProxy = await this.proxyAnalyzer.analyze({
      chainId: context.target.chainId,
      address: target,
      sourceBlock: context.sourceBlock,
      sourceBlockHash: pinnedBlockHash(context),
      explorer: explorerClaim(targetEnrichment),
    });
    const analysisAddress = preliminaryProxy.implementationAddress ?? target;
    const implementationEnrichment =
      analysisAddress === target
        ? targetEnrichment
        : await loadEnrichment(this.metadataProvider, context.target.chainId, analysisAddress);
    const runtimeBytecode = await this.chainClient.getCode(analysisAddress, context.sourceBlock);
    const metadata = implementationEnrichment.metadata;
    const preliminaryPrivilege = this.privilegeAnalyzer.analyze({
      chainId: context.target.chainId,
      address: analysisAddress,
      sourceBlock: context.sourceBlock,
      sourceBlockHash: pinnedBlockHash(context),
      contractName: metadata?.contractName ?? undefined,
      sourceVerified: metadata?.verified ?? false,
      sourceFiles: sourceFiles(implementationEnrichment),
      abi: metadata?.abi ?? null,
      runtimeBytecode,
      controllers: [],
    });
    const controllers = await this.privilegeStateReader.readControllers({
      contractAddress: target,
      sourceBlock: context.sourceBlock,
      roles:
        preliminaryPrivilege.ast === null
          ? []
          : extractAccessControlRoles(preliminaryPrivilege.ast),
      provenanceKey: 'chain_privilege_state',
    });
    const privilegeAnalysis = this.privilegeAnalyzer.analyze({
      chainId: context.target.chainId,
      address: analysisAddress,
      sourceBlock: context.sourceBlock,
      sourceBlockHash: pinnedBlockHash(context),
      contractName: metadata?.contractName ?? undefined,
      sourceVerified: metadata?.verified ?? false,
      sourceFiles: sourceFiles(implementationEnrichment),
      abi: metadata?.abi ?? null,
      runtimeBytecode,
      controllers,
    });
    const claims = [
      sourceClaim(targetEnrichment, target),
      analysisAddress === target ? null : sourceClaim(implementationEnrichment, analysisAddress),
    ].filter((claim): claim is SourceVerificationClaim => claim !== null);
    const proxyAnalysis = await this.proxyAnalyzer.analyze({
      chainId: context.target.chainId,
      address: target,
      sourceBlock: context.sourceBlock,
      sourceBlockHash: pinnedBlockHash(context),
      explorer: explorerClaim(targetEnrichment),
      sourceVerification: claims,
      initialization: privilegeAnalysis.initializationEvidence,
    });
    const sourceContext = analysisAddress === target ? targetEnrichment : implementationEnrichment;
    return {
      ...context,
      data: {
        ...context.data,
        proxyAnalysis,
        privilegeAnalysis,
      },
      dataSources: mergeSources(context.dataSources, [
        chainDataSource('chain_proxy_state', context),
        chainDataSource('chain_privilege_state', context),
        chainDataSource('chain_runtime_bytecode', context),
        explorerDataSource(targetEnrichment, 'explorer_contract_metadata', context),
        explorerDataSource(sourceContext, 'contract_source', context),
        abiDataSource(sourceContext, context),
      ]),
    };
  }
}
