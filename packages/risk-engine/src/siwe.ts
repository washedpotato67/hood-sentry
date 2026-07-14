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
export type NonceRecord = { nonce: string; expiresAt: number; consumed: boolean };
export function validateSiwe(
  m: SiweMessage,
  expected: { domain: string; uri: string; chainId: number; now: number },
  nonce: NonceRecord,
  signatureValid: boolean,
): void {
  if (m.domain !== expected.domain || m.uri !== expected.uri || m.chainId !== expected.chainId)
    throw new Error('SIWE context mismatch');
  if (nonce.consumed || Date.now() > nonce.expiresAt) throw new Error('Nonce invalid or expired');
  const issued = Date.parse(m.issuedAt);
  if (Number.isNaN(issued) || issued > expected.now * 1000) throw new Error('issuedAt invalid');
  if (m.expirationTime && Date.parse(m.expirationTime) <= expected.now * 1000)
    throw new Error('Message expired');
  if (m.notBefore && Date.parse(m.notBefore) > expected.now * 1000)
    throw new Error('Message not active');
  if (!signatureValid) throw new Error('Invalid signature');
  nonce.consumed = true;
}
