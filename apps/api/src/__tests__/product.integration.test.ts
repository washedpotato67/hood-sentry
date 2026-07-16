import { hashOpaqueSecret } from '@hood-sentry/auth';
import type {
  NormalizedPool,
  NormalizedQuote,
  PreparedProtocolTransaction,
  QuoteRequest,
} from '@hood-sentry/chain';
import {
  type Database,
  DrizzleAlertRepository,
  DrizzleAuthRepository,
  DrizzleContractRepositoryImpl,
  DrizzleProductRepository,
  DrizzleProjectRepository,
  DrizzleReportRepository,
  createDatabase,
} from '@hood-sentry/db';
import { resetAndMigrate } from '@hood-sentry/db/testing';
import type { EmailDeliveryInput, EmailDeliveryProvider } from '@hood-sentry/providers';
import Fastify from 'fastify';
import { keccak256 } from 'viem';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiKeyService } from '../api-key-service.js';
import { AuthSessionManager } from '../auth-session.js';
import { adminRoutes } from '../routes/admin.js';
import { apiKeyRoutes } from '../routes/api-keys.js';
import { productRoutes } from '../routes/product.js';
import { tokenEntitlementRoutes } from '../routes/token-entitlements.js';
import { tradingRoutes } from '../routes/trading.js';
import { TokenEntitlementService } from '../token-entitlement-service.js';
import { type TradingRuntime, TradingService } from '../trading-service.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/hood_sentry_test';
const ORIGIN = 'http://localhost:3000';
const SESSION_SECRET = 's'.repeat(48);
const SESSION_TOKEN = `session-${'a'.repeat(48)}`;
const WALLET = '0x1111111111111111111111111111111111111111';
const NOW = new Date('2026-07-15T12:00:00.000Z');
const TOKEN = '0x2222222222222222222222222222222222222222';
const TOKEN_BYTECODE = '0x6001600055' as const;
const TOKEN_BYTECODE_HASH = keccak256(TOKEN_BYTECODE);
const OUTPUT_TOKEN = '0x3333333333333333333333333333333333333333';
const FACTORY = '0x4444444444444444444444444444444444444444';
const ROUTER = '0x5555555555555555555555555555555555555555';
const POOL = '0x6666666666666666666666666666666666666666';
const SWAP_SELECTOR = '0x38ed1739' as const;
const BROADCAST_HASH = `0x${'e'.repeat(64)}` as const;
const POOL_FIXTURE: NormalizedPool = {
  chainId: 46630,
  protocolKey: 'fixture-dex',
  protocolVersion: 'v1',
  poolAddress: POOL,
  factoryAddress: FACTORY,
  token0Address: TOKEN,
  token1Address: OUTPUT_TOKEN,
  feeTier: 3_000n,
  poolType: 'constantProduct',
  createdBlockNumber: 1n,
  createdBlockHash: `0x${'1'.repeat(64)}`,
  creationTransactionHash: `0x${'2'.repeat(64)}`,
  creationLogIndex: 0,
  canonical: true,
};

class FixtureTradingAdapter {
  readonly chainId = 46630;
  readonly protocolKey = 'fixture-dex';
  readonly version = 'v1';
  private quoteSequence = 0;

  async getQuote(request: QuoteRequest): Promise<NormalizedQuote> {
    this.quoteSequence += 1;
    return {
      quoteId: `fixture-quote-${this.quoteSequence}`,
      chainId: request.chainId,
      protocolKey: this.protocolKey,
      protocolVersion: this.version,
      inputTokenAddress: request.inputTokenAddress,
      outputTokenAddress: request.outputTokenAddress,
      amountInRaw: request.amountInRaw,
      expectedAmountOutRaw: request.amountInRaw * 2n,
      minimumAmountOutRaw: request.minimumAmountOutRaw,
      estimatedGas: 100_000n,
      priceImpactBps: 25n,
      protocolFeeRaw: (request.amountInRaw * 3n) / 1_000n,
      route: request.route,
      spenderAddress: ROUTER,
      transactionTarget: ROUTER,
      transactionSelector: SWAP_SELECTOR,
      sourceBlockNumber: 100n,
      createdAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 30_000).toISOString(),
      warnings: [],
    };
  }

  async prepareSwapTransaction(
    quote: NormalizedQuote,
    userAddress: `0x${string}`,
  ): Promise<PreparedProtocolTransaction> {
    return {
      chainId: this.chainId,
      protocolKey: this.protocolKey,
      protocolVersion: this.version,
      to: ROUTER,
      data: SWAP_SELECTOR,
      value: 0n,
      spenderAddress: ROUTER,
      functionSelector: SWAP_SELECTOR,
      deadline: BigInt(Math.floor(new Date(quote.expiresAt).getTime() / 1_000)),
      quoteId: quote.quoteId,
      simulation: { success: true, gasUsed: 100_000n, returnValue: '0x' },
      warnings: [],
      expectedStateChanges: [],
      intent: {
        inputTokenAddress: quote.inputTokenAddress,
        outputTokenAddress: quote.outputTokenAddress,
        amountInRaw: quote.amountInRaw,
        minimumAmountOutRaw: quote.minimumAmountOutRaw,
        recipientAddress: userAddress,
        route: quote.route,
      },
    };
  }
}

class CapturingEmailProvider implements EmailDeliveryProvider {
  readonly messages: EmailDeliveryInput[] = [];

  async send(input: EmailDeliveryInput) {
    this.messages.push(input);
    return { providerId: 'fixture-email', providerMessageId: input.idempotencyKey, status: 200 };
  }
}

let database: Database;
let available = false;

beforeAll(async () => {
  const probe = createDatabase(TEST_DATABASE_URL);
  try {
    await probe.client`SELECT 1`;
    available = true;
  } catch {
    // biome-ignore lint/suspicious/noConsole: test output
    console.warn('Postgres not available, skipping product route integration tests');
  } finally {
    await probe.close();
  }
});

afterAll(async () => {
  if (database) await database.close();
});

async function setup() {
  if (database) await database.close();
  database = createDatabase(TEST_DATABASE_URL);
  await resetAndMigrate(database.client);
  await database.client`
    INSERT INTO chains (chain_id, name, native_symbol, enabled)
    VALUES (46630, 'Robinhood Chain Testnet', 'ETH', true)
  `;
  const auth = new DrizzleAuthRepository(database.db);
  const identity = await auth.provisionUserForWallet(46630, WALLET, NOW);
  await auth.insertSession({
    userId: identity.user.id,
    hashedSessionToken: hashOpaqueSecret(SESSION_TOKEN, SESSION_SECRET),
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    deviceMetadata: {},
    ipAddress: null,
    userAgent: null,
    revokedAt: null,
  });
  const email = new CapturingEmailProvider();
  const app = Fastify();
  const sessions = new AuthSessionManager(auth, SESSION_SECRET, false, () => NOW);
  const apiKeys = new ApiKeyService(database, SESSION_SECRET, () => NOW);
  await app.register(productRoutes, {
    prefix: '/v1',
    sessions,
    publicAppUrl: ORIGIN,
    sessionSecret: SESSION_SECRET,
    webhookSigningSecret: 'w'.repeat(48),
    emailFrom: 'Hood Sentry <alerts@example.com>',
    emailDelivery: email,
    defaultChainId: 46630,
    product: new DrizzleProductRepository(database.db),
    alerts: new DrizzleAlertRepository(database.db),
    projects: new DrizzleProjectRepository(database.db),
    reports: new DrizzleReportRepository(database.db),
    contracts: new DrizzleContractRepositoryImpl(database.db),
    verifySignature: async () => false,
    projectClaimsEnabled: true,
    communityReportsEnabled: true,
    webhooksEnabled: true,
    now: () => NOW,
  });
  await app.register(adminRoutes, {
    prefix: '/v1',
    database,
    sessions,
    publicAppUrl: ORIGIN,
  });
  await app.register(apiKeyRoutes, {
    prefix: '/v1',
    sessions,
    service: apiKeys,
    publicAppUrl: ORIGIN,
  });
  const tokenEntitlements = new TokenEntitlementService(
    database,
    {
      getChainId: async () => 46630,
      getBytecode: async () => TOKEN_BYTECODE,
      balanceOf: async () => 20n,
    },
    {
      enabled: true,
      chainId: 46630,
      tokenAddress: TOKEN,
      runtimeBytecodeHash: TOKEN_BYTECODE_HASH,
      verificationSourceUrl: 'https://explorer.example.com/address/token',
      verifiedAt: NOW.toISOString(),
      minimums: { free: 0n, scout: 10n, analyst: 20n, sentinel: 30n },
      cacheSeconds: 60,
      minimumHoldingSeconds: 0,
      version: 'sentry-entitlement-v1',
    },
    () => NOW,
  );
  await app.register(tokenEntitlementRoutes, {
    prefix: '/v1',
    sessions,
    service: tokenEntitlements,
    publicAppUrl: ORIGIN,
    chainId: 46630,
  });
  const tradingRuntime: TradingRuntime = {
    adapters: [new FixtureTradingAdapter()],
    client: {
      getChainId: async () => 46630,
      getBytecode: async () => TOKEN_BYTECODE,
      simulateTransaction: async () => ({
        success: true,
        gasUsed: 100_000n,
        returnValue: '0x',
      }),
    },
    allowedSpenders: new Set([ROUTER.toLowerCase()]),
  };
  const trading = new TradingService(
    database,
    {
      getActivePools: async () => [POOL_FIXTURE],
      saveQuote: async () => undefined,
    },
    tradingRuntime,
    {
      chainId: 46630,
      enabled: true,
      mainnetWritesEnabled: false,
      configurationVersion: 'fixture-registry-v1',
      quoteTtlSeconds: 30,
    },
    () => NOW,
    {
      getTransaction: async () => ({
        from: WALLET,
        to: ROUTER,
        input: SWAP_SELECTOR,
        value: 0n,
      }),
      getTransactionReceipt: async () => ({
        transactionHash: BROADCAST_HASH,
        status: 'success',
        blockNumber: 101n,
        blockHash: `0x${'f'.repeat(64)}`,
      }),
    },
  );
  await app.register(tradingRoutes, {
    prefix: '/v1',
    sessions,
    service: trading,
    publicAppUrl: ORIGIN,
    chainId: 46630,
  });
  return {
    app,
    email,
    userId: identity.user.id,
    apiKeys,
    cookie: `hood_sentry_session=${SESSION_TOKEN}`,
  };
}

describe('product routes', () => {
  beforeEach(({ skip }) => skip(!available, 'PostgreSQL is unavailable'));

  it('delivers and consumes an email verification code with encrypted storage', async () => {
    const { app, email, cookie } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/notification-channels',
      headers: { cookie, origin: ORIGIN },
      payload: { channelType: 'email', email: 'user@example.com' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ data: { id: string } }>().data.id;
    const message = email.messages[0];
    expect(message).toBeDefined();
    const code = message?.text.match(/[0-9]{6}/)?.[0];
    expect(code).toMatch(/^[0-9]{6}$/);

    const stored = await database.client`
      SELECT channel_config::text AS channel_config
      FROM notification_channels
      WHERE id = ${id}
    `;
    expect(stored[0]?.channel_config).not.toContain('user@example.com');

    const wrong = await app.inject({
      method: 'POST',
      url: `/v1/notification-channels/${id}/verify`,
      headers: { cookie, origin: ORIGIN },
      payload: { code: '000000' },
    });
    expect(wrong.statusCode).toBe(400);

    const verified = await app.inject({
      method: 'POST',
      url: `/v1/notification-channels/${id}/verify`,
      headers: { cookie, origin: ORIGIN },
      payload: { code },
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({ data: { id, verified: true } });
    await app.close();
  });

  it('returns webhook secrets once and advances the persisted rotation version', async () => {
    const { app, cookie } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: { cookie, origin: ORIGIN },
      payload: { url: 'https://hooks.example.com/sentry', events: ['alert.triggered'] },
    });
    expect(created.statusCode).toBe(201);
    const first = created.json<{ data: { id: string; signingSecret: string } }>().data;

    const rotated = await app.inject({
      method: 'POST',
      url: `/v1/webhooks/${first.id}/rotate-secret`,
      headers: { cookie, origin: ORIGIN },
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json<{ data: { signingSecret: string } }>().data.signingSecret).not.toBe(
      first.signingSecret,
    );
    const rows = await database.client`
      SELECT secret_version FROM webhook_endpoints WHERE id = ${first.id}
    `;
    expect(rows[0]?.secret_version).toBe(2);
    await app.close();
  });

  it('audits claim approval, report resolution, and accepted appeal review', async () => {
    const { app, cookie, userId } = await setup();
    await database.client`
      INSERT INTO admin_roles (user_id, role_name, granted_by)
      VALUES (${userId}, 'super_admin', ${userId})
    `;
    const projects = await database.client`
      INSERT INTO project_profiles (
        chain_id, project_name, slug, description, verified
      ) VALUES (46630, 'Fixture Project', 'fixture-project', 'Fixture profile', false)
      RETURNING id
    `;
    const projectId = projects[0]?.id;
    if (typeof projectId !== 'string') throw new Error('Project fixture insert failed');
    const claims = await database.client`
      INSERT INTO project_claims (
        project_profile_id, claimer_address, claim_type, evidence, status
      ) VALUES (
        ${projectId}, ${WALLET}, 'ownership',
        ${JSON.stringify({ intentNonce: '10000000-0000-4000-8000-000000000001' })}::jsonb,
        'pending'
      ) RETURNING id
    `;
    const claimId = claims[0]?.id;
    if (typeof claimId !== 'string') throw new Error('Claim fixture insert failed');

    const claimReview = await app.inject({
      method: 'POST',
      url: `/v1/admin/project-claims/${claimId}/review`,
      headers: { cookie, origin: ORIGIN },
      payload: { status: 'approved', reason: 'Wallet and project identity evidence verified.' },
    });
    expect(claimReview.statusCode).toBe(200);
    const verifiedProjects = await database.client`
      SELECT verified FROM project_profiles WHERE id = ${projectId}
    `;
    expect(verifiedProjects[0]?.verified).toBe(true);

    const reports = await database.client`
      INSERT INTO community_reports (
        chain_id, target_address, target_type, reporter_address, report_type,
        severity, description, evidence_urls, status, submitted_at
      ) VALUES (
        46630, ${WALLET}, 'wallet', ${WALLET}, 'scam', 'high',
        'Evidence-backed fixture report for moderation workflow testing.', '[]'::jsonb,
        'submitted', ${NOW.toISOString()}
      ) RETURNING id
    `;
    const reportId = reports[0]?.id;
    if (typeof reportId !== 'string') throw new Error('Report fixture insert failed');
    const resolution = await app.inject({
      method: 'POST',
      url: `/v1/admin/reports/${reportId}/review`,
      headers: { cookie, origin: ORIGIN },
      payload: {
        action: 'resolve',
        resolutionType: 'upheld',
        notes: 'Submitted evidence supports the reported abuse classification.',
      },
    });
    expect(resolution.statusCode).toBe(200);

    const appealed = await app.inject({
      method: 'POST',
      url: `/v1/reports/${reportId}/appeal`,
      headers: { cookie, origin: ORIGIN },
      payload: {
        reason: 'The resolution omitted relevant counter-evidence and needs another review.',
      },
    });
    expect(appealed.statusCode, appealed.body).toBe(201);
    const appealId = appealed.json<{ data: { id: string } }>().data.id;
    const appealReview = await app.inject({
      method: 'POST',
      url: `/v1/admin/report-appeals/${appealId}/review`,
      headers: { cookie, origin: ORIGIN },
      payload: { status: 'accepted', reason: 'Counter-evidence meets the review threshold.' },
    });
    expect(appealReview.statusCode).toBe(200);

    const detail = await app.inject({ method: 'GET', url: `/v1/reports/${reportId}` });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      data: {
        status: 'under_review',
        resolutions: [{ resolutionType: 'upheld' }],
        appeals: [{ id: appealId, status: 'accepted' }],
      },
    });
    const auditRows = await database.client`SELECT id FROM admin_audit_logs`;
    expect(auditRows).toHaveLength(3);
    await app.close();
  });

  it('issues one-time API secrets, enforces quotas, and revokes access', async () => {
    const { app, cookie, userId, apiKeys } = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/api-keys',
      headers: { cookie, origin: ORIGIN },
      payload: { name: 'Research terminal', scopes: ['tokens:read', 'risk:read'] },
    });
    expect(created.statusCode).toBe(201);
    const key = created.json<{ data: { id: string; token: string; prefix: string } }>().data;
    expect(key.token).toMatch(/^hs_[a-f0-9]{16}_/);

    const listed = await app.inject({
      method: 'GET',
      url: '/v1/api-keys',
      headers: { cookie, origin: ORIGIN },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.body).not.toContain(key.token);
    expect(listed.body).not.toContain('hashedSecret');

    const status = await app.inject({
      method: 'GET',
      url: '/v1/api-access/status',
      headers: { 'x-api-key': key.token },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      data: { prefix: key.prefix, minuteRemaining: 59, dayRemaining: 4_999 },
    });

    const limited = await apiKeys.issue({
      userId,
      name: 'Low quota fixture',
      scopes: ['tokens:read'],
      quotaPerMinute: 2,
      quotaPerDay: 2,
    });
    await apiKeys.authenticate(limited.token, 'tokens:read');
    await apiKeys.authenticate(limited.token, 'tokens:read');
    await expect(apiKeys.authenticate(limited.token, 'tokens:read')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/v1/api-keys/${key.id}`,
      headers: { cookie, origin: ORIGIN },
    });
    expect(revoked.statusCode).toBe(204);
    const rejected = await app.inject({
      method: 'GET',
      url: '/v1/api-access/status',
      headers: { 'x-api-key': key.token },
    });
    expect(rejected.statusCode).toBe(401);
    await app.close();
  });

  it('reconciles token access against indexed and direct chain evidence', async () => {
    const { app, cookie } = await setup();
    await database.client`
      INSERT INTO blocks (
        chain_id, number, hash, parent_hash, timestamp, finality_state, canonical
      ) VALUES (
        46630, 100,
        ${`0x${'a'.repeat(64)}`}, ${`0x${'b'.repeat(64)}`},
        ${NOW.toISOString()}, 'finalized', true
      )
    `;
    await database.client`
      INSERT INTO contracts (
        chain_id, address, creator_address, creation_tx_hash, creation_block,
        bytecode_hash, runtime_bytecode, verified, source_provider
      ) VALUES (
        46630, ${TOKEN.toLowerCase()}, ${WALLET.toLowerCase()},
        ${`0x${'c'.repeat(64)}`}, 100, ${TOKEN_BYTECODE_HASH.toLowerCase()},
        ${TOKEN_BYTECODE}, true, 'verified-source'
      )
    `;
    await database.client`
      INSERT INTO tokens (
        chain_id, address, name, symbol, decimals, token_type, metadata_status
      ) VALUES (46630, ${TOKEN.toLowerCase()}, 'Sentry', 'SENTRY', 18, 'erc20', 'complete')
    `;
    await database.client`
      INSERT INTO token_balances (
        chain_id, token_address, wallet_address, balance_raw, as_of_block
      ) VALUES (46630, ${TOKEN.toLowerCase()}, ${WALLET.toLowerCase()}, 20, 100)
    `;

    const reconciled = await app.inject({
      method: 'POST',
      url: '/v1/token-entitlements/reconcile',
      headers: { cookie, origin: ORIGIN },
    });
    expect(reconciled.statusCode, reconciled.body).toBe(200);
    expect(reconciled.json()).toMatchObject({
      data: {
        status: 'available',
        tier: 'analyst',
        eligibleTier: 'analyst',
        balanceRaw: '20',
        observedBlock: '100',
        writeEnabled: true,
        verification: { runtimeBytecodeHash: TOKEN_BYTECODE_HASH },
      },
    });

    const status = await app.inject({
      method: 'GET',
      url: '/v1/token-entitlements/status',
      headers: { cookie },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ data: { tier: 'analyst', status: 'available' } });
    await app.close();
  });

  it('prepares simulated swaps, approvals, and revocations with durable intent audits', async () => {
    const { app, cookie } = await setup();
    await database.client`
      INSERT INTO contracts (
        chain_id, address, creator_address, creation_tx_hash, creation_block,
        bytecode_hash, runtime_bytecode, verified, source_provider
      ) VALUES (
        46630, ${TOKEN.toLowerCase()}, ${WALLET.toLowerCase()},
        ${`0x${'d'.repeat(64)}`}, 100, ${TOKEN_BYTECODE_HASH.toLowerCase()},
        ${TOKEN_BYTECODE}, true, 'verified-source'
      )
    `;
    await database.client`
      INSERT INTO tokens (
        chain_id, address, name, symbol, decimals, token_type, metadata_status
      ) VALUES (46630, ${TOKEN.toLowerCase()}, 'Input Token', 'IN', 18, 'erc20', 'complete')
    `;

    const quoted = await app.inject({
      method: 'POST',
      url: '/v1/quotes',
      payload: {
        chainId: 46630,
        inputTokenAddress: TOKEN,
        outputTokenAddress: OUTPUT_TOKEN,
        amountInRaw: '1000',
        slippageBps: '100',
      },
    });
    expect(quoted.statusCode, quoted.body).toBe(200);
    const quote = quoted.json<{
      data: { quoteId: string; minimumAmountOutRaw: string; allowanceRequirement: unknown };
    }>().data;
    expect(quote.minimumAmountOutRaw).toBe('1980');
    expect(quote.allowanceRequirement).toEqual({ spenderAddress: ROUTER, amountRaw: '1000' });

    const swap = await app.inject({
      method: 'POST',
      url: '/v1/trades/prepare',
      headers: { cookie, origin: ORIGIN },
      payload: { quoteId: quote.quoteId },
    });
    expect(swap.statusCode, swap.body).toBe(200);
    expect(swap.json()).toMatchObject({
      data: {
        chainId: 46630,
        functionName: 'swapExactTokensForTokens',
        target: ROUTER,
        functionSelector: SWAP_SELECTOR,
        simulation: { success: true, gasUsed: '100000' },
      },
    });
    const swapIntentId = swap.json<{ data: { intentId: string } }>().data.intentId;
    const broadcast = await app.inject({
      method: 'POST',
      url: `/v1/transaction-intents/${swapIntentId}/broadcast`,
      headers: { cookie, origin: ORIGIN },
      payload: { transactionHash: BROADCAST_HASH },
    });
    expect(broadcast.statusCode, broadcast.body).toBe(200);
    expect(broadcast.json()).toMatchObject({ data: { status: 'broadcast' } });
    const confirmed = await app.inject({
      method: 'POST',
      url: `/v1/transaction-intents/${swapIntentId}/confirm`,
      headers: { cookie, origin: ORIGIN },
      payload: { transactionHash: BROADCAST_HASH },
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({
      data: { status: 'confirmed', blockNumber: '101' },
    });

    const approval = await app.inject({
      method: 'POST',
      url: '/v1/approvals/prepare',
      headers: { cookie, origin: ORIGIN },
      payload: {
        chainId: 46630,
        tokenAddress: TOKEN,
        spenderAddress: ROUTER,
        amountRaw: '1000',
      },
    });
    expect(approval.statusCode, approval.body).toBe(200);
    expect(approval.json()).toMatchObject({
      data: { functionName: 'approve', approvalAmount: '1000', simulation: { success: true } },
    });

    const revoke = await app.inject({
      method: 'POST',
      url: '/v1/approvals/revoke-prepare',
      headers: { cookie, origin: ORIGIN },
      payload: { chainId: 46630, tokenAddress: TOKEN, spenderAddress: ROUTER },
    });
    expect(revoke.statusCode, revoke.body).toBe(200);
    expect(revoke.json()).toMatchObject({
      data: { functionName: 'approve', approvalAmount: '0', simulation: { success: true } },
    });

    const intents = await database.client`
      SELECT intent_type, status, wallet_address, function_selector
      FROM transaction_intents ORDER BY created_at
    `;
    expect(intents).toHaveLength(3);
    expect(intents.filter((row) => row.status === 'confirmed')).toHaveLength(1);
    expect(intents.filter((row) => row.status === 'simulated')).toHaveLength(2);
    expect(intents.every((row) => row.wallet_address === WALLET.toLowerCase())).toBe(true);
    const events = await database.client`SELECT action FROM transaction_intent_events`;
    expect(events).toHaveLength(5);
    await app.close();
  });
});
