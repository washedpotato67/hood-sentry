import { decryptNotificationConfig } from '@hood-sentry/auth';
import type { AlertEvent, AlertRule, Database } from '@hood-sentry/db';
import { schema } from '@hood-sentry/db';
import type { Logger } from '@hood-sentry/observability';
import type {
  DeliveryProviderResult,
  EmailDeliveryProvider,
  SignedWebhookProvider,
  TelegramDeliveryProvider,
  WebPushProvider,
} from '@hood-sentry/providers';
import { HttpsDeliveryError, ProviderHttpError } from '@hood-sentry/providers';
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';

const requestedChannelsSchema = z.array(z.enum(['in_app', 'email', 'telegram', 'webhook', 'push']));
const emailConfigSchema = z.object({ email: z.string().email() });
const telegramConfigSchema = z.object({ chatId: z.string().min(1).max(128) });
const pushConfigSchema = z.object({
  endpoint: z.string().url(),
  publicKey: z.string().min(1).max(1_024),
  authenticationSecret: z.string().min(1).max(1_024),
});

type DeliveryServices = {
  database: Database;
  logger: Pick<Logger, 'warn'>;
  publicAppUrl: string;
  emailFrom: string;
  notificationEncryptionSecret: string;
  email?: EmailDeliveryProvider;
  telegram?: TelegramDeliveryProvider;
  push?: WebPushProvider;
  webhook?: SignedWebhookProvider;
  now?: () => Date;
};

type AlertDelivery = Pick<
  AlertEvent,
  | 'id'
  | 'alertRuleId'
  | 'chainId'
  | 'blockNumber'
  | 'blockHash'
  | 'transactionHash'
  | 'logIndex'
  | 'triggeredAt'
  | 'severity'
  | 'metadata'
>;

type RuleDelivery = Pick<AlertRule, 'id' | 'userId' | 'targetAddress' | 'ruleType' | 'channels'>;

function deliveryErrorCode(error: unknown): string {
  if (error instanceof ProviderHttpError || error instanceof HttpsDeliveryError) return error.code;
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)) {
    return error.message;
  }
  return 'DELIVERY_FAILED';
}

function alertText(event: AlertDelivery, rule: RuleDelivery): string {
  const lines = [
    `Hood Sentry ${event.severity.toUpperCase()} alert`,
    `Rule: ${rule.ruleType}`,
    `Target: ${rule.targetAddress}`,
    `Chain: ${event.chainId.toString()}`,
    `Block: ${event.blockNumber.toString()}`,
  ];
  if (event.transactionHash !== null) lines.push(`Transaction: ${event.transactionHash}`);
  return lines.join('\n');
}

export class AlertDeliveryService {
  private readonly now: () => Date;

  constructor(private readonly services: DeliveryServices) {
    this.now = services.now ?? (() => new Date());
  }

  async deliver(event: AlertDelivery, rule: RuleDelivery): Promise<void> {
    const requested = new Set(requestedChannelsSchema.parse(rule.channels));
    const failures: string[] = [];
    const channels = await this.services.database.db
      .select()
      .from(schema.notificationChannels)
      .where(
        and(
          eq(schema.notificationChannels.userId, rule.userId),
          eq(schema.notificationChannels.verified, true),
        ),
      );

    for (const channel of channels) {
      if (!requested.has(channel.channelType)) continue;
      const code = await this.deliverChannel(channel, event, rule);
      if (code !== null) failures.push(code);
    }

    if (requested.has('webhook')) {
      failures.push(...(await this.deliverWebhooks(event, rule)));
    }

    if (failures.length > 0) {
      throw new Error(`ALERT_DELIVERY_FAILED:${[...new Set(failures)].join(',')}`);
    }
  }

  private async deliverChannel(
    channel: typeof schema.notificationChannels.$inferSelect,
    event: AlertDelivery,
    rule: RuleDelivery,
  ): Promise<string | null> {
    const delivery = await this.claimNotificationDelivery(channel.id, event.id);
    if (delivery === null) return null;
    try {
      const result = await this.sendChannel(channel, event, rule, delivery.id);
      await this.services.database.db
        .update(schema.notificationDeliveries)
        .set({
          status: 'delivered',
          deliveredAt: this.now(),
          providerMessageId: result.providerMessageId,
          responseStatus: result.status,
          errorMessage: null,
          updatedAt: this.now(),
        })
        .where(eq(schema.notificationDeliveries.id, delivery.id));
      return null;
    } catch (error) {
      const code = deliveryErrorCode(error);
      await this.services.database.db
        .update(schema.notificationDeliveries)
        .set({ status: 'failed', errorMessage: code, updatedAt: this.now() })
        .where(eq(schema.notificationDeliveries.id, delivery.id));
      this.services.logger.warn('Alert notification delivery failed', {
        deliveryId: delivery.id,
        channelType: channel.channelType,
        code,
      });
      return code;
    }
  }

  private async sendChannel(
    channel: typeof schema.notificationChannels.$inferSelect,
    event: AlertDelivery,
    rule: RuleDelivery,
    deliveryId: string,
  ): Promise<DeliveryProviderResult> {
    const text = alertText(event, rule);
    const decryptedConfig = decryptNotificationConfig(
      channel.channelConfig,
      this.services.notificationEncryptionSecret,
    );
    if (channel.channelType === 'email') {
      if (this.services.email === undefined) throw new Error('EMAIL_PROVIDER_NOT_CONFIGURED');
      const config = emailConfigSchema.parse(decryptedConfig);
      return await this.services.email.send({
        from: this.services.emailFrom,
        to: config.email,
        subject: `Hood Sentry ${event.severity} alert`,
        text: `${text}\nOpen: ${this.services.publicAppUrl}/alerts/${event.id}`,
        idempotencyKey: deliveryId,
      });
    }
    if (channel.channelType === 'telegram') {
      if (this.services.telegram === undefined) throw new Error('TELEGRAM_PROVIDER_NOT_CONFIGURED');
      const config = telegramConfigSchema.parse(decryptedConfig);
      return await this.services.telegram.send({
        chatId: config.chatId,
        text: `${text}\n${this.services.publicAppUrl}/alerts/${event.id}`,
      });
    }
    if (channel.channelType === 'push') {
      if (this.services.push === undefined) throw new Error('PUSH_PROVIDER_NOT_CONFIGURED');
      const config = pushConfigSchema.parse(decryptedConfig);
      return await this.services.push.send(config, {
        title: `Hood Sentry ${event.severity} alert`,
        body: text,
        url: `${this.services.publicAppUrl}/alerts/${event.id}`,
        eventId: event.id,
      });
    }
    throw new Error('NOTIFICATION_CHANNEL_UNSUPPORTED');
  }

  private async claimNotificationDelivery(channelId: string, eventId: string) {
    await this.services.database.db
      .insert(schema.notificationDeliveries)
      .values({ notificationChannelId: channelId, alertEventId: eventId, status: 'pending' })
      .onConflictDoNothing();

    const staleBefore = new Date(this.now().getTime() - 5 * 60 * 1_000);
    const rows = await this.services.database.db
      .update(schema.notificationDeliveries)
      .set({
        status: 'sent',
        sentAt: this.now(),
        retryCount: sql`${schema.notificationDeliveries.retryCount} + 1`,
        updatedAt: this.now(),
      })
      .where(
        and(
          eq(schema.notificationDeliveries.notificationChannelId, channelId),
          eq(schema.notificationDeliveries.alertEventId, eventId),
          lt(schema.notificationDeliveries.retryCount, 10),
          or(
            inArray(schema.notificationDeliveries.status, ['pending', 'failed']),
            and(
              eq(schema.notificationDeliveries.status, 'sent'),
              lt(schema.notificationDeliveries.updatedAt, staleBefore),
            ),
          ),
        ),
      )
      .returning({ id: schema.notificationDeliveries.id });
    return rows[0] ?? null;
  }

  private async deliverWebhooks(event: AlertDelivery, rule: RuleDelivery): Promise<string[]> {
    const endpoints = await this.services.database.db
      .select()
      .from(schema.webhookEndpoints)
      .where(
        and(
          eq(schema.webhookEndpoints.userId, rule.userId),
          eq(schema.webhookEndpoints.enabled, true),
        ),
      );
    const failures: string[] = [];
    for (const endpoint of endpoints) {
      const events = z.array(z.string()).safeParse(endpoint.events);
      if (!events.success || !events.data.includes('alert.triggered')) continue;
      const code = await this.deliverWebhook(endpoint, event, rule);
      if (code !== null) failures.push(code);
    }
    return failures;
  }

  private async deliverWebhook(
    endpoint: typeof schema.webhookEndpoints.$inferSelect,
    event: AlertDelivery,
    rule: RuleDelivery,
  ): Promise<string | null> {
    const idempotencyKey = `${endpoint.id}:alert.triggered:${event.id}`;
    const payload = {
      id: event.id,
      alertRuleId: rule.id,
      chainId: event.chainId,
      targetAddress: rule.targetAddress,
      ruleType: rule.ruleType,
      severity: event.severity,
      blockNumber: event.blockNumber.toString(),
      blockHash: event.blockHash,
      transactionHash: event.transactionHash,
      logIndex: event.logIndex,
      triggeredAt: event.triggeredAt.toISOString(),
      evidence: event.metadata,
    };
    await this.services.database.db
      .insert(schema.webhookDeliveries)
      .values({
        webhookEndpointId: endpoint.id,
        eventType: 'alert.triggered',
        idempotencyKey,
        payload,
        status: 'pending',
      })
      .onConflictDoNothing();
    const staleBefore = new Date(this.now().getTime() - 5 * 60 * 1_000);
    const claimed = await this.services.database.db
      .update(schema.webhookDeliveries)
      .set({
        status: 'sent',
        retryCount: sql`${schema.webhookDeliveries.retryCount} + 1`,
        updatedAt: this.now(),
      })
      .where(
        and(
          eq(schema.webhookDeliveries.idempotencyKey, idempotencyKey),
          lt(schema.webhookDeliveries.retryCount, 10),
          or(
            inArray(schema.webhookDeliveries.status, ['pending', 'failed']),
            and(
              eq(schema.webhookDeliveries.status, 'sent'),
              lt(schema.webhookDeliveries.updatedAt, staleBefore),
            ),
          ),
        ),
      )
      .returning({ id: schema.webhookDeliveries.id });
    const delivery = claimed[0];
    if (delivery === undefined) return null;
    if (this.services.webhook === undefined) {
      await this.failWebhook(delivery.id, 'WEBHOOK_PROVIDER_NOT_CONFIGURED');
      return 'WEBHOOK_PROVIDER_NOT_CONFIGURED';
    }
    try {
      const result = await this.services.webhook.send({
        endpointId: endpoint.id,
        endpointUrl: endpoint.url,
        secretHash: endpoint.secretHash,
        secretVersion: endpoint.secretVersion,
        deliveryId: delivery.id,
        eventType: 'alert.triggered',
        payload,
      });
      await this.services.database.db
        .update(schema.webhookDeliveries)
        .set({
          status: 'delivered',
          responseStatus: result.status,
          responseBody: null,
          deliveredAt: this.now(),
          updatedAt: this.now(),
        })
        .where(eq(schema.webhookDeliveries.id, delivery.id));
      return null;
    } catch (error) {
      const code = deliveryErrorCode(error);
      await this.failWebhook(delivery.id, code);
      this.services.logger.warn('Signed webhook delivery failed', {
        deliveryId: delivery.id,
        endpointId: endpoint.id,
        code,
      });
      return code;
    }
  }

  private async failWebhook(id: string, code: string): Promise<void> {
    await this.services.database.db
      .update(schema.webhookDeliveries)
      .set({ status: 'failed', responseBody: code, updatedAt: this.now() })
      .where(eq(schema.webhookDeliveries.id, id));
  }
}
