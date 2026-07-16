import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { decryptNotificationConfig, encryptNotificationConfig } from '@hood-sentry/auth';
import type {
  AlertRepository,
  ContractRepository,
  ProductRepository,
  ProjectRepository,
  ReportRepository,
} from '@hood-sentry/db';
import type {
  EmailDeliveryProvider,
  TelegramDeliveryProvider,
  WebPushProvider,
} from '@hood-sentry/providers';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  toChecksumAddress,
} from '@hood-sentry/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { type AuthSessionManager, requireTrustedOrigin } from '../auth-session.js';

const idParamsSchema = z.object({ id: z.string().uuid() });
const itemParamsSchema = z.object({ id: z.string().uuid(), itemId: z.string().uuid() });
const slugParamsSchema = z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) });
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(1024).optional(),
});
const chainIdSchema = z.union([z.literal(4663), z.literal(46630)]);
const targetTypeSchema = z.enum(['token', 'wallet', 'contract', 'project']);

const watchlistInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  isDefault: z.boolean().default(false),
});
const watchlistUpdateSchema = watchlistInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const watchlistItemSchema = z.object({
  chainId: chainIdSchema,
  targetAddress: z.string(),
  targetType: targetTypeSchema,
  notes: z.string().trim().max(500).nullable().default(null),
});

const alertRuleTypeSchema = z.enum([
  'price_change',
  'volume_spike',
  'large_transfer',
  'contract_event',
  'risk_score_change',
  'governance_proposal',
]);
const alertChannelSchema = z.enum(['in_app', 'email', 'telegram', 'webhook', 'push']);
const alertCommonSchema = z.object({
  chainId: chainIdSchema,
  targetAddress: z.string(),
  channels: z.array(alertChannelSchema).min(1).max(5),
  enabled: z.boolean().default(true),
});
const unsignedIntegerStringSchema = z.string().regex(/^[0-9]+$/);
const evmAddressStringSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const alertSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
const alertInputSchema = z.discriminatedUnion('ruleType', [
  alertCommonSchema.extend({
    ruleType: z.literal('price_change'),
    condition: z.object({
      changeBps: unsignedIntegerStringSchema,
      windowSeconds: unsignedIntegerStringSchema,
      direction: z.enum(['up', 'down', 'either']).default('either'),
      severity: alertSeveritySchema.optional(),
    }),
  }),
  alertCommonSchema.extend({
    ruleType: z.literal('volume_spike'),
    condition: z.object({
      minimumVolumeRaw: unsignedIntegerStringSchema,
      multiplierBps: unsignedIntegerStringSchema,
      windowSeconds: unsignedIntegerStringSchema,
      severity: alertSeveritySchema.optional(),
    }),
  }),
  alertCommonSchema.extend({
    ruleType: z.literal('large_transfer'),
    condition: z.object({
      minimumAmountRaw: unsignedIntegerStringSchema,
      fromAddresses: z.array(evmAddressStringSchema).max(100).optional(),
      toAddresses: z.array(evmAddressStringSchema).max(100).optional(),
      severity: alertSeveritySchema.optional(),
    }),
  }),
  alertCommonSchema.extend({
    ruleType: z.literal('contract_event'),
    condition: z.object({
      eventTypes: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
      severity: alertSeveritySchema.optional(),
    }),
  }),
  alertCommonSchema.extend({
    ruleType: z.literal('risk_score_change'),
    condition: z.object({
      minimumDeltaBps: unsignedIntegerStringSchema,
      direction: z.enum(['increase', 'decrease', 'either']).default('increase'),
      severity: alertSeveritySchema.optional(),
    }),
  }),
  alertCommonSchema.extend({
    ruleType: z.literal('governance_proposal'),
    condition: z.object({
      eventTypes: z.array(z.string().trim().min(1).max(100)).min(1).max(50),
      severity: alertSeveritySchema.optional(),
    }),
  }),
]);
const alertUpdateSchema = z
  .object({
    chainId: chainIdSchema.optional(),
    targetAddress: z.string().optional(),
    ruleType: alertRuleTypeSchema.optional(),
    condition: z.record(z.unknown()).optional(),
    channels: z.array(alertChannelSchema).min(1).max(5).optional(),
    enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

const notificationChannelSchema = z.discriminatedUnion('channelType', [
  z.object({ channelType: z.literal('email'), email: z.string().email() }),
  z.object({ channelType: z.literal('telegram'), chatId: z.string().min(1).max(128) }),
  z.object({
    channelType: z.literal('push'),
    endpoint: z.string().url(),
    publicKey: z.string().min(1).max(1024),
    authenticationSecret: z.string().min(1).max(1024),
  }),
]);
const notificationVerificationSchema = z.object({ code: z.string().regex(/^[0-9]{6}$/) });

const webhookEventSchema = z.enum([
  'alert.triggered',
  'alert.resolved',
  'risk.changed',
  'project.reported',
  'transaction.finalized',
]);
const webhookInputSchema = z.object({
  url: z.string().url(),
  events: z.array(webhookEventSchema).min(1).max(10),
  enabled: z.boolean().default(true),
});
const webhookUpdateSchema = webhookInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

const projectClaimIntentInputSchema = z.object({
  projectProfileId: z.string().uuid(),
  claimType: z.enum(['ownership', 'maintainer', 'contributor']),
  walletAddress: z.string().optional(),
});
const claimPayloadSchema = z.object({
  projectProfileId: z.string().uuid(),
  claimType: z.enum(['ownership', 'maintainer', 'contributor']),
  chainId: chainIdSchema,
  walletAddress: z.string(),
  deadline: z.string().datetime(),
  nonce: z.string().uuid(),
});
const projectClaimInputSchema = z.object({
  intent: z.string().min(1).max(4096),
  signature: z.custom<`0x${string}`>(
    (value) => typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value),
  ),
});
const projectUpdateSchema = z
  .object({
    projectName: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5_000).nullable().optional(),
    websiteUrl: z.string().url().nullable().optional(),
    logoUri: z.string().url().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
const projectCreateSchema = z.object({
  chainId: chainIdSchema,
  projectName: z.string().trim().min(1).max(255),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(255),
  description: z.string().trim().max(5_000).nullable().default(null),
  websiteUrl: z.string().url().nullable().default(null),
  logoUri: z.string().url().nullable().default(null),
});
const projectContractSchema = z.object({
  chainId: chainIdSchema,
  contractAddress: z.string(),
  contractType: z.enum([
    'token',
    'staking',
    'governance',
    'treasury',
    'bond',
    'vesting',
    'factory',
    'router',
  ]),
});

const reportInputSchema = z.object({
  chainId: chainIdSchema,
  targetAddress: z.string(),
  targetType: z.enum(['token', 'wallet', 'contract', 'project']),
  reportType: z.enum([
    'scam',
    'rug_pull',
    'honeypot',
    'exploit',
    'phishing',
    'impersonation',
    'other',
  ]),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  description: z.string().trim().min(30).max(10_000),
  evidenceUrls: z.array(z.string().url()).max(10).default([]),
});
const reportEvidenceSchema = z
  .object({
    evidenceType: z.enum([
      'screenshot',
      'transaction_hash',
      'contract_code',
      'chat_log',
      'url',
      'document',
    ]),
    evidenceData: z.record(z.unknown()),
  })
  .superRefine((value, context) => {
    const bytes = Buffer.byteLength(JSON.stringify(value.evidenceData), 'utf8');
    if (bytes > 100_000) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Evidence data exceeds 100 KB' });
    }
  });
const appealSchema = z.object({ reason: z.string().trim().min(30).max(10_000) });

type SignatureVerifier = (input: {
  address: `0x${string}`;
  message: string;
  signature: `0x${string}`;
}) => Promise<boolean>;

export type ProductRouteOptions = {
  sessions: AuthSessionManager;
  publicAppUrl: string;
  sessionSecret: string;
  webhookSigningSecret?: string;
  emailFrom: string;
  emailDelivery?: EmailDeliveryProvider;
  telegramDelivery?: TelegramDeliveryProvider;
  pushDelivery?: Pick<WebPushProvider, 'send'>;
  webPushPublicKey?: string;
  defaultChainId: 4663 | 46630;
  product: ProductRepository;
  alerts: AlertRepository;
  projects: ProjectRepository;
  reports: ReportRepository;
  contracts: ContractRepository;
  verifySignature: SignatureVerifier;
  projectClaimsEnabled: boolean;
  communityReportsEnabled: boolean;
  webhooksEnabled: boolean;
  now?: () => Date;
};

function feature(enabled: boolean, name: string): void {
  if (!enabled) throw new AppError('FEATURE_DISABLED', `${name} is disabled`, 503);
}

async function writeSession(request: FastifyRequest, options: ProductRouteOptions) {
  requireTrustedOrigin(request, options.publicAppUrl);
  return options.sessions.require(request);
}

function publicWebhookUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new AppError('WEBHOOK_URL_INVALID', 'Webhook URLs must use HTTPS', 400);
  }
  const hostname = url.hostname.toLowerCase();
  const blockedName =
    hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local');
  const privateV4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
  const privateV6 = hostname === '::1' || hostname.startsWith('fc') || hostname.startsWith('fd');
  if (blockedName || (isIP(hostname) === 4 && privateV4) || (isIP(hostname) === 6 && privateV6)) {
    throw new AppError('WEBHOOK_URL_PRIVATE', 'Webhook URLs must use a public host', 400);
  }
  return url.toString();
}

function encodeClaimIntent(payload: z.infer<typeof claimPayloadSchema>, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function decodeClaimIntent(intent: string, secret: string): z.infer<typeof claimPayloadSchema> {
  const parts = intent.split('.');
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    throw new AppError('CLAIM_INTENT_INVALID', 'The project claim intent is invalid', 400);
  }
  const expected = createHmac('sha256', secret).update(parts[0]).digest();
  const provided = Buffer.from(parts[1], 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new AppError('CLAIM_INTENT_INVALID', 'The project claim intent is invalid', 400);
  }
  try {
    return claimPayloadSchema.parse(
      JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
    );
  } catch {
    throw new AppError('CLAIM_INTENT_INVALID', 'The project claim intent is invalid', 400);
  }
}

function claimMessage(payload: z.infer<typeof claimPayloadSchema>): string {
  return [
    'Hood Sentry project identity claim',
    `Project profile: ${payload.projectProfileId}`,
    `Claim type: ${payload.claimType}`,
    `Chain ID: ${payload.chainId}`,
    `Wallet: ${toChecksumAddress(payload.walletAddress)}`,
    `Deadline: ${payload.deadline}`,
    `Nonce: ${payload.nonce}`,
  ].join('\n');
}

function normalizeTargetIdentity(
  targetType: z.infer<typeof targetTypeSchema>,
  value: string,
): string {
  return targetType === 'project'
    ? z.string().uuid().parse(value).toLowerCase()
    : toChecksumAddress(value).toLowerCase();
}

function visibleTargetIdentity(targetType: string, value: string): string {
  return targetType === 'project' ? value : toChecksumAddress(value);
}

function errorHasCode(error: unknown, code: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if ('code' in current && current.code === code) return true;
    current = 'cause' in current ? current.cause : undefined;
  }
  return false;
}

function deriveWebhookSecret(signingSecret: string, id: string, version: number): string {
  return createHmac('sha256', signingSecret)
    .update(`${id}:${version.toString()}`)
    .digest('base64url');
}

function notificationChallengeHash(channelId: string, code: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`notification-channel:${channelId}:${code}`)
    .digest('hex');
}

async function sendNotificationChallenge(
  channel: Awaited<ReturnType<ProductRepository['createNotificationChannel']>>,
  config: Readonly<Record<string, unknown>>,
  options: ProductRouteOptions,
  code: string,
): Promise<void> {
  if (channel.channelType === 'email') {
    if (options.emailDelivery === undefined) {
      throw new AppError('EMAIL_PROVIDER_MISSING', 'Email delivery is unavailable', 503);
    }
    const parsed = z.object({ email: z.string().email() }).parse(config);
    await options.emailDelivery.send({
      from: options.emailFrom,
      to: parsed.email,
      subject: 'Verify your Hood Sentry alert channel',
      text: `Your Hood Sentry verification code is ${code}. It expires in 10 minutes.`,
      idempotencyKey: `${channel.id}:verification:${notificationChallengeHash(
        channel.id,
        code,
        options.sessionSecret,
      ).slice(0, 32)}`,
    });
    return;
  }
  if (channel.channelType === 'telegram') {
    if (options.telegramDelivery === undefined) {
      throw new AppError('TELEGRAM_PROVIDER_MISSING', 'Telegram delivery is unavailable', 503);
    }
    const parsed = z.object({ chatId: z.string().min(1).max(128) }).parse(config);
    await options.telegramDelivery.send({
      chatId: parsed.chatId,
      text: `Hood Sentry verification code: ${code}\nExpires in 10 minutes.`,
    });
    return;
  }
  if (channel.channelType === 'push') {
    if (options.pushDelivery === undefined) {
      throw new AppError('PUSH_PROVIDER_MISSING', 'Browser push delivery is unavailable', 503);
    }
    const parsed = z
      .object({
        endpoint: z.string().url(),
        publicKey: z.string().min(1).max(1_024),
        authenticationSecret: z.string().min(1).max(1_024),
      })
      .parse(config);
    await options.pushDelivery.send(parsed, {
      title: 'Verify Hood Sentry alerts',
      body: `Your verification code is ${code}`,
      url: `${options.publicAppUrl}/settings/notifications`,
      eventId: channel.id,
    });
    return;
  }
  throw new AppError(
    'NOTIFICATION_CHANNEL_UNSUPPORTED',
    'Notification channel is unsupported',
    400,
  );
}

function visibleWebhook(endpoint: Awaited<ReturnType<ProductRepository['createWebhook']>>) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    events: endpoint.events,
    enabled: endpoint.enabled,
    createdAt: endpoint.createdAt.toISOString(),
    updatedAt: endpoint.updatedAt.toISOString(),
  };
}

export async function productRoutes(app: FastifyInstance, options: ProductRouteOptions) {
  const now = options.now ?? (() => new Date());
  const issueNotificationChallenge = async (
    channel: Awaited<ReturnType<ProductRepository['createNotificationChannel']>>,
    config: Readonly<Record<string, unknown>>,
  ): Promise<void> => {
    const code = randomInt(100_000, 1_000_000).toString();
    const issuedAt = now();
    const stored = await options.product.setNotificationChallenge(
      channel.userId,
      channel.id,
      notificationChallengeHash(channel.id, code, options.sessionSecret),
      new Date(issuedAt.getTime() + 10 * 60 * 1_000),
      issuedAt,
    );
    if (!stored) throw new NotFoundError('Notification channel', channel.id);
    await sendNotificationChallenge(channel, config, options, code);
  };

  app.get('/watchlists', async (request) => {
    const session = await options.sessions.require(request);
    const lists = await options.product.listWatchlists(session.user.id);
    const data = await Promise.all(
      lists.map(async (list) => ({
        ...list,
        createdAt: list.createdAt.toISOString(),
        updatedAt: list.updatedAt.toISOString(),
        items: (await options.product.listWatchlistItems(session.user.id, list.id)).map((item) => ({
          ...item,
          targetAddress: visibleTargetIdentity(item.targetType, item.targetAddress),
          addedAt: item.addedAt.toISOString(),
        })),
      })),
    );
    return { data };
  });

  app.post('/watchlists', async (request, reply) => {
    const session = await writeSession(request, options);
    const input = watchlistInputSchema.parse(request.body);
    const created = await options.product.createWatchlist(
      session.user.id,
      input.name,
      input.isDefault,
    );
    return reply.status(201).send({ data: created });
  });

  app.patch('/watchlists/:id', async (request) => {
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    const updated = await options.product.updateWatchlist(
      session.user.id,
      id,
      watchlistUpdateSchema.parse(request.body),
    );
    if (updated === null) throw new NotFoundError('Watchlist', id);
    return { data: updated };
  });

  app.delete('/watchlists/:id', async (request, reply) => {
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    if (!(await options.product.deleteWatchlist(session.user.id, id))) {
      throw new NotFoundError('Watchlist', id);
    }
    return reply.status(204).send();
  });

  app.post('/watchlists/:id/items', async (request, reply) => {
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    const input = watchlistItemSchema.parse(request.body);
    const created = await options.product.addWatchlistItem(session.user.id, {
      watchlistId: id,
      chainId: input.chainId,
      targetAddress: normalizeTargetIdentity(input.targetType, input.targetAddress),
      targetType: input.targetType,
      notes: input.notes,
    });
    return reply.status(201).send({ data: created });
  });

  app.delete('/watchlists/:id/items/:itemId', async (request, reply) => {
    const session = await writeSession(request, options);
    const { id, itemId } = itemParamsSchema.parse(request.params);
    if (!(await options.product.deleteWatchlistItem(session.user.id, id, itemId))) {
      throw new NotFoundError('Watchlist item', itemId);
    }
    return reply.status(204).send();
  });

  app.get('/alerts', async (request) => {
    const session = await options.sessions.require(request);
    const query = paginationSchema.parse(request.query);
    return {
      data: await options.alerts.getAlertRulesByUser(session.user.id, {
        ...query,
        orderBy: 'desc',
      }),
    };
  });

  app.post('/alerts', async (request, reply) => {
    const session = await writeSession(request, options);
    const input = alertInputSchema.parse(request.body);
    const created = await options.alerts.insertAlertRule({
      userId: session.user.id,
      chainId: input.chainId,
      targetAddress: toChecksumAddress(input.targetAddress).toLowerCase(),
      ruleType: input.ruleType,
      condition: input.condition,
      channels: input.channels,
      enabled: input.enabled,
    });
    return reply.status(201).send({ data: created });
  });

  app.patch('/alerts/:id', async (request) => {
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    const existing = await options.alerts.getAlertRule(id);
    if (existing === null || existing.userId !== session.user.id)
      throw new NotFoundError('Alert', id);
    const parsed = alertUpdateSchema.parse(request.body);
    const validated = alertInputSchema.parse({
      chainId: parsed.chainId ?? existing.chainId,
      targetAddress: parsed.targetAddress ?? existing.targetAddress,
      ruleType: parsed.ruleType ?? existing.ruleType,
      condition: parsed.condition ?? existing.condition,
      channels: parsed.channels ?? existing.channels,
      enabled: parsed.enabled ?? existing.enabled,
    });
    return {
      data: await options.alerts.updateAlertRule(id, {
        ...validated,
        targetAddress: toChecksumAddress(validated.targetAddress).toLowerCase(),
      }),
    };
  });

  app.delete('/alerts/:id', async (request, reply) => {
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    const existing = await options.alerts.getAlertRule(id);
    if (existing === null || existing.userId !== session.user.id)
      throw new NotFoundError('Alert', id);
    await options.alerts.deleteAlertRule(id);
    return reply.status(204).send();
  });

  app.post('/alerts/:id/test', async (request) => {
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    const rule = await options.alerts.getAlertRule(id);
    if (rule === null || rule.userId !== session.user.id) throw new NotFoundError('Alert', id);
    return {
      data: {
        status: 'validated',
        alertId: rule.id,
        enabled: rule.enabled,
        configuredChannels: rule.channels,
        liveEventCreated: false,
        reason: 'A test does not fabricate chain evidence or alert events.',
      },
    };
  });

  app.get('/alert-events', async (request) => {
    const session = await options.sessions.require(request);
    const query = paginationSchema.parse(request.query);
    const rules = await options.alerts.getAlertRulesByUser(session.user.id, {
      limit: 100,
      orderBy: 'desc',
    });
    const eventPages = await Promise.all(
      rules.data.map((rule) =>
        options.alerts.getAlertEventsByRule(rule.id, { ...query, orderBy: 'desc' }),
      ),
    );
    const events = eventPages
      .flatMap((page) => page.data)
      .sort((left, right) => right.triggeredAt.getTime() - left.triggeredAt.getTime())
      .slice(0, query.limit)
      .map((event) => ({
        ...event,
        blockNumber: event.blockNumber.toString(),
        triggeredAt: event.triggeredAt.toISOString(),
        resolvedAt: event.resolvedAt?.toISOString() ?? null,
      }));
    return { data: events };
  });

  app.get('/notification-channels', async (request) => {
    const session = await options.sessions.require(request);
    const channels = await options.product.listNotificationChannels(session.user.id);
    return {
      data: channels.map((channel) => ({
        id: channel.id,
        channelType: channel.channelType,
        verified: channel.verified,
        verifiedAt: channel.verifiedAt?.toISOString() ?? null,
        createdAt: channel.createdAt.toISOString(),
      })),
    };
  });

  app.get('/notification-channels/capabilities', async (request) => {
    await options.sessions.require(request);
    return {
      data: {
        email: options.emailDelivery !== undefined,
        telegram: options.telegramDelivery !== undefined,
        push: options.pushDelivery !== undefined && options.webPushPublicKey !== undefined,
        webPushPublicKey: options.webPushPublicKey ?? null,
      },
    };
  });

  app.post('/notification-channels', async (request, reply) => {
    const session = await writeSession(request, options);
    const input = notificationChannelSchema.parse(request.body);
    if (input.channelType === 'email' && options.emailDelivery === undefined) {
      throw new AppError('EMAIL_PROVIDER_MISSING', 'Email delivery is unavailable', 503);
    }
    if (input.channelType === 'telegram' && options.telegramDelivery === undefined) {
      throw new AppError('TELEGRAM_PROVIDER_MISSING', 'Telegram delivery is unavailable', 503);
    }
    if (input.channelType === 'push' && options.pushDelivery === undefined) {
      throw new AppError('PUSH_PROVIDER_MISSING', 'Browser push delivery is unavailable', 503);
    }
    const channelConfig =
      input.channelType === 'email'
        ? { email: input.email.toLowerCase() }
        : input.channelType === 'telegram'
          ? { chatId: input.chatId }
          : {
              endpoint: input.endpoint,
              publicKey: input.publicKey,
              authenticationSecret: input.authenticationSecret,
            };
    const created = await options.product.createNotificationChannel({
      userId: session.user.id,
      channelType: input.channelType,
      channelConfig: encryptNotificationConfig(channelConfig, options.sessionSecret),
      verified: false,
      verifiedAt: null,
      verificationTokenHash: null,
      verificationExpiresAt: null,
      verificationSentAt: null,
      verificationAttempts: 0,
    });
    await issueNotificationChallenge(created, channelConfig);
    return reply.status(201).send({
      data: {
        id: created.id,
        channelType: created.channelType,
        verified: created.verified,
        verificationSent: true,
      },
    });
  });

  app.post('/notification-channels/:id/verify', async (request) => {
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    const input = notificationVerificationSchema.parse(request.body);
    const channel = await options.product.getNotificationChannel(session.user.id, id);
    if (channel === null) throw new NotFoundError('Notification channel', id);
    if (channel.verified) return { data: { id, verified: true } };
    const verified = await options.product.verifyNotificationChannel(
      session.user.id,
      id,
      notificationChallengeHash(id, input.code, options.sessionSecret),
      now(),
    );
    if (!verified) {
      await options.product.recordNotificationVerificationFailure(session.user.id, id);
      throw new AppError(
        'NOTIFICATION_VERIFICATION_INVALID',
        'The verification code is invalid or expired',
        400,
      );
    }
    return { data: { id, verified: true } };
  });

  app.post('/notification-channels/:id/resend', async (request) => {
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    const channel = await options.product.getNotificationChannel(session.user.id, id);
    if (channel === null) throw new NotFoundError('Notification channel', id);
    if (channel.verified) return { data: { id, verified: true, verificationSent: false } };
    const currentTime = now();
    if (
      channel.verificationSentAt !== null &&
      currentTime.getTime() - channel.verificationSentAt.getTime() < 60_000
    ) {
      throw new RateLimitError(60);
    }
    const config = decryptNotificationConfig(channel.channelConfig, options.sessionSecret);
    await issueNotificationChallenge(channel, config);
    return { data: { id, verified: false, verificationSent: true } };
  });

  app.delete('/notification-channels/:id', async (request, reply) => {
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    const deleted = await options.product.deleteNotificationChannel(session.user.id, id);
    if (!deleted) throw new NotFoundError('Notification channel', id);
    return reply.status(204).send();
  });

  app.get('/webhooks', async (request) => {
    feature(options.webhooksEnabled, 'Webhooks');
    const session = await options.sessions.require(request);
    return { data: (await options.product.listWebhooks(session.user.id)).map(visibleWebhook) };
  });

  app.post('/webhooks', async (request, reply) => {
    feature(options.webhooksEnabled, 'Webhooks');
    if (options.webhookSigningSecret === undefined) {
      throw new AppError('WEBHOOK_SECRET_MISSING', 'Webhook signing is unavailable', 503);
    }
    const session = await writeSession(request, options);
    const input = webhookInputSchema.parse(request.body);
    const id = randomUUID();
    const secretVersion = 1;
    const secret = deriveWebhookSecret(options.webhookSigningSecret, id, secretVersion);
    const created = await options.product.createWebhook({
      id,
      userId: session.user.id,
      url: publicWebhookUrl(input.url),
      secretHash: createHash('sha256').update(secret).digest('hex'),
      secretVersion,
      events: input.events,
      enabled: input.enabled,
    });
    return reply.status(201).send({ data: { ...visibleWebhook(created), signingSecret: secret } });
  });

  app.patch('/webhooks/:id', async (request) => {
    feature(options.webhooksEnabled, 'Webhooks');
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    const input = webhookUpdateSchema.parse(request.body);
    const updated = await options.product.updateWebhook(session.user.id, id, {
      ...input,
      url: input.url === undefined ? undefined : publicWebhookUrl(input.url),
    });
    if (updated === null) throw new NotFoundError('Webhook', id);
    return { data: visibleWebhook(updated) };
  });

  app.post('/webhooks/:id/rotate-secret', async (request) => {
    feature(options.webhooksEnabled, 'Webhooks');
    if (options.webhookSigningSecret === undefined) {
      throw new AppError('WEBHOOK_SECRET_MISSING', 'Webhook signing is unavailable', 503);
    }
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    const current = await options.product.getWebhook(session.user.id, id);
    if (current === null) throw new NotFoundError('Webhook', id);
    const nextVersion = current.secretVersion + 1;
    const secret = deriveWebhookSecret(options.webhookSigningSecret, id, nextVersion);
    const updated = await options.product.rotateWebhookSecret(
      session.user.id,
      id,
      current.secretVersion,
      createHash('sha256').update(secret).digest('hex'),
    );
    if (updated === null) throw new ConflictError('The webhook secret changed during rotation');
    return { data: { id, signingSecret: secret } };
  });

  app.delete('/webhooks/:id', async (request, reply) => {
    feature(options.webhooksEnabled, 'Webhooks');
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    if (!(await options.product.deleteWebhook(session.user.id, id))) {
      throw new NotFoundError('Webhook', id);
    }
    return reply.status(204).send();
  });

  app.get('/projects', async (request) => {
    const query = paginationSchema
      .extend({ chainId: z.coerce.number().pipe(chainIdSchema).optional() })
      .parse(request.query);
    const result =
      query.chainId === undefined
        ? await options.projects.getProjectProfiles({ ...query, orderBy: 'desc' })
        : await options.projects.getProjectProfilesByChain(query.chainId, {
            ...query,
            orderBy: 'desc',
          });
    return { data: result };
  });

  app.post('/projects', async (request, reply) => {
    feature(options.projectClaimsEnabled, 'Project claims');
    const session = await writeSession(request, options);
    const input = projectCreateSchema.parse(request.body);
    const wallet = session.wallets.find(
      (entry) => entry.chainId === input.chainId && entry.isPrimary,
    );
    if (wallet === undefined)
      throw new ForbiddenError('A verified project-chain wallet is required');
    try {
      const project = await options.projects.insertProjectProfile({
        chainId: input.chainId,
        projectName: input.projectName,
        slug: input.slug,
        description: input.description,
        websiteUrl: input.websiteUrl,
        logoUri: input.logoUri,
        verified: false,
        verifiedAt: null,
      });
      await options.product.appendProjectVersion(
        project.id,
        { action: 'profile_created', identityVerified: false, submittedBy: wallet.address },
        session.user.id,
      );
      return reply.status(201).send({ data: project });
    } catch (error) {
      if (errorHasCode(error, '23505')) throw new ConflictError('The project slug already exists');
      throw error;
    }
  });

  app.get('/projects/:slug', async (request) => {
    const { slug } = slugParamsSchema.parse(request.params);
    const project = await options.projects.getProjectProfileBySlug(slug);
    if (project === null) throw new NotFoundError('Project', slug);
    const contracts = await options.projects.getProjectContractsByProject(project.id);
    return { data: { ...project, contracts } };
  });

  app.get('/projects/:slug/history', async (request) => {
    const { slug } = slugParamsSchema.parse(request.params);
    const project = await options.projects.getProjectProfileBySlug(slug);
    if (project === null) throw new NotFoundError('Project', slug);
    return { data: await options.product.listProjectVersions(project.id) };
  });

  app.get('/projects/:slug/reports', async (request) => {
    const { slug } = slugParamsSchema.parse(request.params);
    const query = paginationSchema.parse(request.query);
    const project = await options.projects.getProjectProfileBySlug(slug);
    if (project === null) throw new NotFoundError('Project', slug);
    return {
      data: await options.reports.getReportsByTarget(project.chainId, project.id, {
        ...query,
        orderBy: 'desc',
      }),
    };
  });

  app.post('/projects/claim-intent', async (request) => {
    feature(options.projectClaimsEnabled, 'Project claims');
    const session = await writeSession(request, options);
    const input = projectClaimIntentInputSchema.parse(request.body);
    const project = await options.projects.getProjectProfile(input.projectProfileId);
    if (project === null) throw new NotFoundError('Project', input.projectProfileId);
    const requestedAddress =
      input.walletAddress === undefined
        ? null
        : toChecksumAddress(input.walletAddress).toLowerCase();
    const wallet = session.wallets.find(
      (entry) =>
        entry.chainId === project.chainId &&
        (requestedAddress === null ? entry.isPrimary : entry.address === requestedAddress),
    );
    if (wallet === undefined)
      throw new ForbiddenError('A verified project-chain wallet is required');
    const payload: z.infer<typeof claimPayloadSchema> = {
      projectProfileId: project.id,
      claimType: input.claimType,
      chainId: chainIdSchema.parse(project.chainId),
      walletAddress: wallet.address,
      deadline: new Date(now().getTime() + 10 * 60 * 1_000).toISOString(),
      nonce: randomUUID(),
    };
    const intent = encodeClaimIntent(payload, options.sessionSecret);
    return { data: { intent, message: claimMessage(payload), ...payload } };
  });

  app.get('/project-claims', async (request) => {
    const session = await options.sessions.require(request);
    return {
      data: await options.product.listProjectClaims(
        session.wallets.map((wallet) => wallet.address),
      ),
    };
  });

  app.post('/projects/claim', async (request, reply) => {
    feature(options.projectClaimsEnabled, 'Project claims');
    const session = await writeSession(request, options);
    const input = projectClaimInputSchema.parse(request.body);
    const payload = decodeClaimIntent(input.intent, options.sessionSecret);
    if (new Date(payload.deadline) <= now()) {
      throw new AppError('CLAIM_INTENT_EXPIRED', 'The project claim intent expired', 400);
    }
    const wallet = session.wallets.find(
      (entry) =>
        entry.chainId === payload.chainId && entry.address === payload.walletAddress.toLowerCase(),
    );
    if (wallet === undefined) throw new ForbiddenError('The signing wallet is not linked');
    const message = claimMessage(payload);
    const valid = await options.verifySignature({
      address: toChecksumAddress(wallet.address),
      message,
      signature: input.signature,
    });
    if (!valid)
      throw new AppError('CLAIM_SIGNATURE_INVALID', 'The claim signature is invalid', 401);
    let claim: Awaited<ReturnType<ProductRepository['createProjectClaim']>>;
    try {
      claim = await options.product.createProjectClaim({
        projectProfileId: payload.projectProfileId,
        claimerAddress: wallet.address,
        claimType: payload.claimType,
        evidence: {
          chainId: payload.chainId,
          signedMessage: message,
          signature: input.signature,
          intentNonce: payload.nonce,
          deadline: payload.deadline,
        },
        status: 'pending',
      });
    } catch (error) {
      if (errorHasCode(error, '23505')) {
        throw new ConflictError('The project claim intent was already submitted');
      }
      throw error;
    }
    return reply.status(201).send({ data: claim });
  });

  app.patch('/projects/:id', async (request) => {
    feature(options.projectClaimsEnabled, 'Project claims');
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    const project = await options.projects.getProjectProfile(id);
    if (project === null) throw new NotFoundError('Project', id);
    const authorized = await options.product.hasApprovedProjectClaim(
      id,
      session.wallets
        .filter((wallet) => wallet.chainId === project.chainId)
        .map((wallet) => wallet.address),
    );
    if (!authorized) throw new ForbiddenError('An approved ownership claim is required');
    const updates = projectUpdateSchema.parse(request.body);
    const updated = await options.projects.updateProjectProfile(id, updates);
    if (updated === null) throw new NotFoundError('Project', id);
    await options.product.appendProjectVersion(id, updates, session.user.id);
    return { data: updated };
  });

  app.post('/projects/:id/contracts', async (request, reply) => {
    feature(options.projectClaimsEnabled, 'Project claims');
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    const project = await options.projects.getProjectProfile(id);
    if (project === null) throw new NotFoundError('Project', id);
    const authorized = await options.product.hasApprovedProjectClaim(
      id,
      session.wallets
        .filter((wallet) => wallet.chainId === project.chainId)
        .map((wallet) => wallet.address),
    );
    if (!authorized) throw new ForbiddenError('An approved ownership claim is required');
    const input = projectContractSchema.parse(request.body);
    if (input.chainId !== project.chainId) {
      throw new ConflictError('The project contract chain must match the project profile chain');
    }
    const address = toChecksumAddress(input.contractAddress);
    const chainContract = await options.contracts.getContract(input.chainId, address.toLowerCase());
    const created = await options.projects.insertProjectContract({
      projectProfileId: id,
      chainId: input.chainId,
      contractAddress: address.toLowerCase(),
      contractType: input.contractType,
      verified: chainContract?.verified ?? false,
      verifiedAt: chainContract?.verified ? now() : null,
    });
    return reply.status(201).send({ data: created });
  });

  app.post('/reports', async (request, reply) => {
    feature(options.communityReportsEnabled, 'Community reports');
    const session = await writeSession(request, options);
    const input = reportInputSchema.parse(request.body);
    const wallet = session.wallets.find(
      (entry) => entry.chainId === input.chainId && entry.isPrimary,
    );
    if (wallet === undefined) throw new ForbiddenError('A verified wallet is required');
    const targetAddress = normalizeTargetIdentity(input.targetType, input.targetAddress);
    if (input.targetType === 'project') {
      const project = await options.projects.getProjectProfile(targetAddress);
      if (project === null || project.chainId !== input.chainId) {
        throw new NotFoundError('Project', targetAddress);
      }
    }
    const report = await options.reports.insertReport({
      chainId: input.chainId,
      targetAddress,
      targetType: input.targetType,
      reporterAddress: wallet.address,
      reportType: input.reportType,
      severity: input.severity,
      description: input.description,
      evidenceUrls: input.evidenceUrls,
      status: 'submitted',
      submittedAt: now(),
      reviewedAt: null,
      resolvedAt: null,
    });
    return reply.status(201).send({ data: report });
  });

  app.get('/reports', async (request) => {
    const session = await options.sessions.require(request);
    const query = paginationSchema.parse(request.query);
    const pages = await Promise.all(
      session.wallets.map((wallet) =>
        options.reports.getReportsByReporter(wallet.address, {
          limit: query.limit,
          orderBy: 'desc',
        }),
      ),
    );
    const reports = pages
      .flatMap((page) => page.data)
      .sort((left, right) => right.submittedAt.getTime() - left.submittedAt.getTime())
      .slice(0, query.limit);
    return { data: reports };
  });

  app.get('/reports/:id', async (request) => {
    const { id } = idParamsSchema.parse(request.params);
    const report = await options.reports.getReport(id);
    if (report === null) throw new NotFoundError('Report', id);
    return {
      data: {
        ...report,
        evidence: await options.reports.getEvidenceByReport(id),
        resolutions: await options.product.listReportResolutions(id),
        appeals: await options.product.listReportAppeals(id),
      },
    };
  });

  app.post('/reports/:id/evidence', async (request, reply) => {
    feature(options.communityReportsEnabled, 'Community reports');
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    const report = await options.reports.getReport(id);
    if (report === null) throw new NotFoundError('Report', id);
    const wallet = session.wallets.find((entry) => entry.address === report.reporterAddress);
    if (wallet === undefined) throw new ForbiddenError('Only the reporter may add evidence');
    const input = reportEvidenceSchema.parse(request.body);
    const evidence = await options.reports.insertEvidence({
      reportId: id,
      evidenceType: input.evidenceType,
      evidenceData: input.evidenceData,
      submittedBy: wallet.address,
      submittedAt: now(),
    });
    return reply.status(201).send({ data: evidence });
  });

  app.post('/reports/:id/appeal', async (request, reply) => {
    feature(options.communityReportsEnabled, 'Community reports');
    const session = await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    const report = await options.reports.getReport(id);
    if (report === null) throw new NotFoundError('Report', id);
    const wallet = session.wallets.find(
      (entry) => entry.chainId === report.chainId && entry.isPrimary,
    );
    if (wallet === undefined) throw new ForbiddenError('A verified wallet is required');
    const input = appealSchema.parse(request.body);
    let appeal: Awaited<ReturnType<ProductRepository['createReportAppeal']>>;
    try {
      appeal = await options.product.createReportAppeal({
        reportId: id,
        appellantAddress: wallet.address,
        appealReason: input.reason,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'REPORT_NOT_APPEALABLE') {
        throw new ConflictError('The report is no longer eligible for appeal');
      }
      if (errorHasCode(error, '23505')) {
        throw new ConflictError('A pending appeal already exists for this wallet');
      }
      throw error;
    }
    return reply.status(201).send({ data: appeal });
  });

  app.post('/reports/:id/bond-intent', async (request) => {
    await writeSession(request, options);
    const { id } = idParamsSchema.parse(request.params);
    if ((await options.reports.getReport(id)) === null) throw new NotFoundError('Report', id);
    return {
      data: {
        status: 'unavailable',
        reason: 'SENTRY_TOKEN_NOT_VERIFIED',
        writeEnabled: false,
      },
    };
  });
}
