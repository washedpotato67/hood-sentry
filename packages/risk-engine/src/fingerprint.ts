import { keccak256, stringToHex } from 'viem';
import { canonicalize } from './canonical.js';
import type { RiskTarget } from './types.js';

export function createFindingFingerprint(input: {
  target: RiskTarget;
  ruleId: string;
  ruleVersion: string;
  fingerprintSeed: string;
}): `0x${string}` {
  return keccak256(
    stringToHex(
      canonicalize({
        target: {
          type: input.target.type,
          chainId: input.target.chainId,
          address: input.target.address.toLowerCase(),
        },
        ruleId: input.ruleId,
        ruleVersion: input.ruleVersion,
        fingerprintSeed: input.fingerprintSeed,
      }),
    ),
  );
}

export function createRiskJobIdempotencyKey(input: {
  target: RiskTarget;
  engineVersion: string;
  sourceBlock: bigint;
  sourceBlockHash: string;
  rulesetVersion: string;
  methodologyVersion: string;
}): string {
  return keccak256(
    stringToHex(
      canonicalize({
        targetType: input.target.type,
        chainId: input.target.chainId,
        address: input.target.address.toLowerCase(),
        engineVersion: input.engineVersion,
        sourceBlock: input.sourceBlock,
        sourceBlockHash: input.sourceBlockHash.toLowerCase(),
        rulesetVersion: input.rulesetVersion,
        methodologyVersion: input.methodologyVersion,
      }),
    ),
  );
}

export function createRescanRequestIdempotencyKey(input: {
  target: RiskTarget;
  trigger: string;
  sourceBlock: bigint;
  sourceBlockHash: string;
  eventId: string;
  rulesetVersion: string;
}): string {
  return keccak256(
    stringToHex(
      canonicalize({
        targetType: input.target.type,
        chainId: input.target.chainId,
        address: input.target.address.toLowerCase(),
        trigger: input.trigger,
        sourceBlock: input.sourceBlock,
        sourceBlockHash: input.sourceBlockHash.toLowerCase(),
        eventId: input.eventId,
        rulesetVersion: input.rulesetVersion,
      }),
    ),
  );
}
