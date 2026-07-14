export function safeExternalUrl(value: string): URL {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsafe external URL');
  return url;
}
export function safeAddressMetadata(address: string, metadataAddress: string) {
  if (address.toLowerCase() !== metadataAddress.toLowerCase())
    throw new Error('Metadata cannot replace contract address');
  return address;
}
export function sanitizeMarkdown(value: string) {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '');
}
