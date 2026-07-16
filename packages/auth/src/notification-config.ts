import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';

const envelopeSchema = z.object({
  version: z.literal(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  authenticationTag: z.string().min(1),
});

export type EncryptedNotificationConfig = z.infer<typeof envelopeSchema>;

function encryptionKey(secret: string): Buffer {
  return createHmac('sha256', z.string().min(32).parse(secret))
    .update('hood-sentry-notification-config-v1')
    .digest();
}

export function encryptNotificationConfig(
  config: Readonly<Record<string, unknown>>,
  secret: string,
): EncryptedNotificationConfig {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(config), 'utf8'), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    authenticationTag: cipher.getAuthTag().toString('base64url'),
  };
}

export function decryptNotificationConfig(
  rawEnvelope: unknown,
  secret: string,
): Readonly<Record<string, unknown>> {
  const envelope = envelopeSchema.parse(rawEnvelope);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    Buffer.from(envelope.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
  return z.record(z.unknown()).parse(JSON.parse(plaintext));
}
