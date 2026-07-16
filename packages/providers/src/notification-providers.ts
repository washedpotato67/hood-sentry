import { z } from 'zod';
import { ProviderHttpClient } from './http-client.js';
import { getProviderDefinition, getProviderServiceUrl } from './registry.js';

const emailInputSchema = z.object({
  from: z.string().trim().min(3).max(320),
  to: z.string().email(),
  subject: z.string().trim().min(1).max(200),
  text: z.string().min(1).max(50_000),
  idempotencyKey: z.string().min(1).max(256),
});

const telegramInputSchema = z.object({
  chatId: z.string().trim().min(1).max(128),
  text: z.string().min(1).max(4_096),
});

const resendResponseSchema = z.object({ id: z.string().min(1).max(255) });
const telegramResponseSchema = z.object({
  ok: z.literal(true),
  result: z.object({ message_id: z.number().int() }).passthrough(),
});

export type EmailDeliveryInput = z.infer<typeof emailInputSchema>;
export type TelegramDeliveryInput = z.infer<typeof telegramInputSchema>;

export type DeliveryProviderResult = {
  providerId: string;
  providerMessageId: string;
  status: number;
};

export interface EmailDeliveryProvider {
  send(input: EmailDeliveryInput): Promise<DeliveryProviderResult>;
}

export interface TelegramDeliveryProvider {
  send(input: TelegramDeliveryInput): Promise<DeliveryProviderResult>;
}

export class ResendEmailProvider implements EmailDeliveryProvider {
  private readonly client: ProviderHttpClient;

  constructor(
    private readonly apiKey: string,
    fetchRequest?: typeof fetch,
  ) {
    const provider = getProviderDefinition('resend');
    this.apiKey = z.string().trim().min(1).max(512).parse(apiKey);
    this.client = new ProviderHttpClient({
      providerId: provider.providerId,
      fetchRequest,
      timeoutMs: provider.timeoutMs,
      maximumAttempts: provider.maximumAttempts,
      requestsPerSecond: provider.requestsPerSecond,
    });
  }

  async send(rawInput: EmailDeliveryInput): Promise<DeliveryProviderResult> {
    const input = emailInputSchema.parse(rawInput);
    const response = await this.client.request({
      url: `${getProviderServiceUrl('resend')}/emails`,
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
        'user-agent': 'Hood-Sentry/0.1',
      },
      body: JSON.stringify({
        from: input.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
      }),
      schema: resendResponseSchema,
      secretValues: [this.apiKey],
    });
    return {
      providerId: response.provenance.providerId,
      providerMessageId: response.data.id,
      status: response.provenance.status,
    };
  }
}

export class TelegramBotProvider implements TelegramDeliveryProvider {
  private readonly client: ProviderHttpClient;

  constructor(
    private readonly botToken: string,
    fetchRequest?: typeof fetch,
  ) {
    const provider = getProviderDefinition('telegram');
    this.botToken = z
      .string()
      .regex(/^[0-9]{6,}:[A-Za-z0-9_-]{20,}$/)
      .parse(botToken);
    this.client = new ProviderHttpClient({
      providerId: provider.providerId,
      fetchRequest,
      timeoutMs: provider.timeoutMs,
      maximumAttempts: provider.maximumAttempts,
      requestsPerSecond: provider.requestsPerSecond,
    });
  }

  async send(rawInput: TelegramDeliveryInput): Promise<DeliveryProviderResult> {
    const input = telegramInputSchema.parse(rawInput);
    const response = await this.client.request({
      url: `${getProviderServiceUrl('telegram')}/bot${this.botToken}/sendMessage`,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: input.chatId,
        text: input.text,
        link_preview_options: { is_disabled: true },
      }),
      schema: telegramResponseSchema,
      secretValues: [this.botToken],
    });
    return {
      providerId: response.provenance.providerId,
      providerMessageId: response.data.result.message_id.toString(),
      status: response.provenance.status,
    };
  }
}
