import type {
  BlockscoutContractMetadata,
  ChainProxyState,
  DataQualityWarning,
  ExplorerConflict,
  ReconciledProxyMetadata,
} from './types.js';

function addressesMatch(left: string | null, right: string | null): boolean {
  return left?.toLowerCase() === right?.toLowerCase();
}

function addConflict(
  conflicts: ExplorerConflict[],
  field: ExplorerConflict['field'],
  chainValue: string | null,
  explorerValue: string | null,
  metadata: BlockscoutContractMetadata,
): void {
  if (explorerValue === null || addressesMatch(chainValue, explorerValue)) {
    return;
  }

  conflicts.push({
    field,
    chainValue,
    explorerValue,
    provider: 'blockscout',
    fetchedAt: metadata.provenance.fetchedAt,
  });
}

export function reconcileBlockscoutProxyMetadata(
  chainState: ChainProxyState,
  metadata: BlockscoutContractMetadata,
): ReconciledProxyMetadata {
  const conflicts: ExplorerConflict[] = [];
  const explorerImplementation = metadata.proxy.implementationAddresses[0] ?? null;

  addConflict(
    conflicts,
    'implementation_address',
    chainState.implementationAddress,
    explorerImplementation,
    metadata,
  );
  addConflict(
    conflicts,
    'admin_address',
    chainState.adminAddress,
    metadata.proxy.adminAddress,
    metadata,
  );

  const dataQualityWarnings: DataQualityWarning[] = conflicts.map((conflict) => ({
    category: 'explorer_chain_conflict',
    severity: 'warning',
    message: `Blockscout ${conflict.field} conflicts with direct chain state`,
    conflict,
  }));

  return {
    current: { ...chainState },
    explorer: metadata.proxy,
    conflicts,
    dataQualityWarnings,
  };
}
