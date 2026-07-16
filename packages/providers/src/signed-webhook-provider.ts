import { createHash, createHmac } from 'node:crypto';
import { z } from 'zod';
import { PinnedHttpsClient } from './pinned-https.js';

const webhookInputSchema = z.object({
  endpointId: z.string().uuid(),
  endpointUrl: z.string().url(),
  secretHash: z.string().regex(/^[0-9a-f]{64}$/),
  secretVersion: z.number().int().positive(),
  deliveryId: z.string().uuid(),
  eventType: z.string().min(1).max(100),
  payload: z.record(z.unknown()),
});

export type SignedWebhookInput = z.infer<typeof webhookInputSchema>;

export function deriveWebhookSecret(
  rootSecret: string,
  endpointId: string,
  version: number,
): string {
  return createHmac('sha256', rootSecret)
    .update(`${endpointId}:${version.toString()}`)
    .digest('base64url');
}

export class SignedWebhookProvider {
  private readonly rootSecret: string;

  constructor(
    rootSecret: string,
    private readonly http = new PinnedHttpsClient(),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.rootSecret = z.string().min(32).parse(rootSecret);
  }

  async send(rawInput: SignedWebhookInput) {
    const input = webhookInputSchema.parse(rawInput);
    const secret = deriveWebhookSecret(this.rootSecret, input.endpointId, input.secretVersion);
    const calculatedHash = createHash('sha256').update(secret).digest('hex');
    if (calculatedHash !== input.secretHash) {
      throw new Error('WEBHOOK_SECRET_INTEGRITY_FAILURE');
    }
    const body = JSON.stringify({ type: input.eventType, data: input.payload });
    const timestamp = Math.floor(this.now().getTime() / 1_000).toString();
    const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
    const response = await this.http.post(
      input.endpointUrl,
      {
        'content-type': 'application/json',
        'user-agent': 'Hood-Sentry-Webhooks/1.0',
        'x-hood-sentry-delivery': input.deliveryId,
        'x-hood-sentry-timestamp': timestamp,
        'x-hood-sentry-signature': `v1=${signature}`,
      },
      body,
    );
    return {
      providerId: 'signed-webhook',
      providerMessageId: input.deliveryId,
      status: response.status,
      responseBody: response.body,
    };
  }
}
