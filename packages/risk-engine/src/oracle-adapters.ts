export type OracleStatus =
  | 'available'
  | 'stale'
  | 'sequencer_down'
  | 'grace_period'
  | 'paused'
  | 'invalid_answer'
  | 'configuration_missing'
  | 'provider_error';
export type OracleObservation = {
  feed: `0x${string}`;
  chainId: number;
  rawAnswer: bigint | null;
  decimals: number | null;
  round: bigint | null;
  updatedAt: bigint | null;
  observedAt: bigint;
  sourceBlock: bigint;
  status: OracleStatus;
  reason?: string;
};
export function validateOracle(
  o: OracleObservation,
  heartbeat: bigint,
  now: bigint,
  sequencer?: { up: boolean; recoveredAt?: bigint; grace: bigint },
  paused = false,
): OracleObservation {
  if (paused) return { ...o, status: 'paused', reason: 'Oracle is paused' };
  if (o.rawAnswer === null || o.decimals === null || o.updatedAt === null)
    return { ...o, status: 'configuration_missing' };
  if (o.rawAnswer <= 0n)
    return { ...o, status: 'invalid_answer', reason: 'Answer is not positive' };
  if (o.updatedAt > now) return { ...o, status: 'invalid_answer', reason: 'Future timestamp' };
  if (now - o.updatedAt > heartbeat) return { ...o, status: 'stale', reason: 'Heartbeat exceeded' };
  if (sequencer && !sequencer.up) return { ...o, status: 'sequencer_down' };
  if (sequencer?.recoveredAt !== undefined && now - sequencer.recoveredAt < sequencer.grace)
    return { ...o, status: 'grace_period' };
  return { ...o, status: 'available' };
}
