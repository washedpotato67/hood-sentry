import * as webPush from 'web-push';
import { z } from 'zod';
import { PinnedHttpsClient } from './pinned-https.js';

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  publicKey: z.string().min(1).max(1_024),
  authenticationSecret: z.string().min(1).max(1_024),
});

const payloadSchema = z.object({
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(1_000),
  url: z.string().url(),
  eventId: z.string().uuid(),
});

export type PushSubscriptionConfig = z.infer<typeof subscriptionSchema>;
export type PushAlertPayload = z.infer<typeof payloadSchema>;

export class WebPushProvider {
  private readonly publicKey: string;
  private readonly privateKey: string;
  private readonly subject: string;

  constructor(
    config: { publicKey: string; privateKey: string; subject: string },
    private readonly http = new PinnedHttpsClient(),
  ) {
    this.publicKey = z.string().min(1).max(1_024).parse(config.publicKey);
    this.privateKey = z.string().min(1).max(1_024).parse(config.privateKey);
    this.subject = z
      .string()
      .refine((value) => value.startsWith('mailto:') || value.startsWith('https:'))
      .parse(config.subject);
  }

  async send(rawSubscription: PushSubscriptionConfig, rawPayload: PushAlertPayload) {
    const subscription = subscriptionSchema.parse(rawSubscription);
    const payload = payloadSchema.parse(rawPayload);
    const request = webPush.generateRequestDetails(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.publicKey, auth: subscription.authenticationSecret },
      },
      JSON.stringify(payload),
      {
        vapidDetails: {
          subject: this.subject,
          publicKey: this.publicKey,
          privateKey: this.privateKey,
        },
        TTL: 3_600,
        urgency: 'high',
        topic: payload.eventId.replaceAll('-', '').slice(0, 32),
      },
    );
    const response = await this.http.post(request.endpoint, request.headers, request.body);
    return { providerId: 'web-push', providerMessageId: payload.eventId, status: response.status };
  }
}
