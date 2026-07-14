export type RelationshipKind =
  | 'CREATED'
  | 'FUNDED'
  | 'TRANSFERRED_TO'
  | 'OWNS'
  | 'ADMINISTERS'
  | 'UPGRADED'
  | 'PROVIDED_LIQUIDITY'
  | 'REMOVED_LIQUIDITY'
  | 'SHARES_BYTECODE'
  | 'SHARES_ROLE'
  | 'INTERACTED_WITH'
  | 'LAUNCHED_ON'
  | 'MIGRATED_TO'
  | 'CLAIMED_FEES';
export type RelationshipEdge = {
  from: `0x${string}`;
  to: `0x${string}`;
  kind: RelationshipKind;
  chainId: number;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  logIndex?: number;
  confidence: 'high' | 'medium' | 'low';
  provenance: string;
  externalLabel?: {
    provider: string;
    label: string;
    fetchedAt: string;
    confidence: 'high' | 'medium' | 'low';
  };
  evidence: string;
  canonical: boolean;
};
export type RelationshipGraph = {
  edges: readonly RelationshipEdge[];
  nodes: readonly `0x${string}`[];
  nextCursor: string | null;
  warnings: readonly string[];
};
export function buildRelationshipGraph(
  edges: readonly RelationshipEdge[],
  roots: readonly `0x${string}`[],
  depthLimit: number,
  maxEdges = 500,
  cursor = 0,
): RelationshipGraph {
  const allowed = new Set(roots.map((r) => r.toLowerCase()));
  const seen = new Set<string>();
  const selected: RelationshipEdge[] = [];
  const queue = roots.map((r) => ({ address: r.toLowerCase(), depth: 0 }));
  while (queue.length > 0 && selected.length < maxEdges) {
    const item = queue.shift();
    if (!item) break;
    for (const edge of edges.filter((e) => e.from.toLowerCase() === item.address && e.canonical)) {
      const key = `${edge.from.toLowerCase()}:${edge.to.toLowerCase()}:${edge.kind}:${edge.transactionHash}:${edge.logIndex ?? -1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(edge);
      if (item.depth < depthLimit) {
        allowed.add(edge.to.toLowerCase());
        queue.push({ address: edge.to.toLowerCase(), depth: item.depth + 1 });
      }
    }
  }
  const page = selected.slice(cursor, cursor + maxEdges);
  return {
    edges: page,
    nodes: [...allowed] as `0x${string}`[],
    nextCursor: cursor + maxEdges < selected.length ? String(cursor + maxEdges) : null,
    warnings: selected.length >= maxEdges ? ['Graph depth or edge limit reached'] : [],
  };
}
