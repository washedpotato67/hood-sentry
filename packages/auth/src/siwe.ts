import { createHmac, randomBytes } from 'node:crypto';
import { getAddress, isHex } from 'viem';
import { parseSiweMessage } from 'viem/siwe';
import { z } from 'zod';

export type SiweMessage = {
  domain: string;
  address: `0x${string}`;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
  notBefore?: string;
};

export type ParsedSiweMessage = SiweMessage & { version: '1' };

export const siweVerificationRequestSchema = z.object({
  message: z.string().min(1).max(8_192),
  signature: z.string().refine((value) => isHex(value), 'Signature must be hex encoded'),
});

export function createSiweNonce(): string {
  return randomBytes(16).toString('hex');
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueSecret(secret: string, signingSecret: string): string {
  return createHmac('sha256', signingSecret).update(secret).digest('hex');
}

export function parseCompleteSiweMessage(message: string): ParsedSiweMessage {
  const parsed = parseSiweMessage(message);
  const schema = z.object({
    domain: z.string().min(1).max(255),
    address: z.string(),
    uri: z.string().url(),
    version: z.literal('1'),
    chainId: z.number().int().positive(),
    nonce: z.string().regex(/^[a-zA-Z0-9]{8,}$/),
    issuedAt: z.date(),
    expirationTime: z.date().optional(),
    notBefore: z.date().optional(),
  });
  const complete = schema.parse(parsed);
  return {
    domain: complete.domain,
    address: getAddress(complete.address),
    uri: complete.uri,
    version: complete.version,
    chainId: complete.chainId,
    nonce: complete.nonce,
    issuedAt: complete.issuedAt.toISOString(),
    expirationTime: complete.expirationTime?.toISOString(),
    notBefore: complete.notBefore?.toISOString(),
  };
}

export type NonceRecord = { nonce: string; expiresAt: number; consumed: boolean };
export function validateSiwe(
  m: SiweMessage,
  expected: { domain: string; uri: string; chainId: number; now: number },
  nonce: NonceRecord,
  signatureValid: boolean,
): void {
  if (m.domain !== expected.domain || m.uri !== expected.uri || m.chainId !== expected.chainId)
    throw new Error('SIWE context mismatch');
  if (m.nonce !== nonce.nonce || nonce.consumed || expected.now * 1000 > nonce.expiresAt)
    throw new Error('Nonce invalid or expired');
  const issued = Date.parse(m.issuedAt);
  if (Number.isNaN(issued) || issued > expected.now * 1000) throw new Error('issuedAt invalid');
  if (m.expirationTime && Date.parse(m.expirationTime) <= expected.now * 1000)
    throw new Error('Message expired');
  if (m.notBefore && Date.parse(m.notBefore) > expected.now * 1000)
    throw new Error('Message not active');
  if (!signatureValid) throw new Error('Invalid signature');
  nonce.consumed = true;
}
