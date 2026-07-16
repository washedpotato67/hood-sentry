import type { Session, SiweNonce, User, UserWallet, UserWithWallet } from '@hood-sentry/db';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { authRoutes } from '../routes/auth.js';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const ORIGIN = 'http://localhost:3000';

class MemoryAuthRepository {
  readonly nonces = new Map<string, SiweNonce>();
  readonly sessions = new Map<string, Session>();
  readonly user: User = {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'active',
    createdAt: new Date('2026-07-15T10:00:00.000Z'),
    updatedAt: new Date('2026-07-15T10:00:00.000Z'),
    deletedAt: null,
  };
  readonly wallet: UserWallet = {
    id: '22222222-2222-4222-8222-222222222222',
    userId: this.user.id,
    chainId: 46630,
    address: ADDRESS.toLowerCase(),
    verifiedAt: new Date('2026-07-15T10:00:00.000Z'),
    isPrimary: true,
    createdAt: new Date('2026-07-15T10:00:00.000Z'),
    updatedAt: new Date('2026-07-15T10:00:00.000Z'),
    deletedAt: null,
  };

  async insertSiweNonce(
    input: Omit<SiweNonce, 'id' | 'issuedAt' | 'consumedAt'>,
  ): Promise<SiweNonce> {
    const nonce: SiweNonce = {
      ...input,
      id: '33333333-3333-4333-8333-333333333333',
      issuedAt: new Date('2026-07-15T10:00:00.000Z'),
      consumedAt: null,
    };
    this.nonces.set(nonce.hashedNonce, nonce);
    return nonce;
  }

  async getSiweNonce(hashedNonce: string): Promise<SiweNonce | null> {
    return this.nonces.get(hashedNonce) ?? null;
  }

  async consumeSiweNonce(
    hashedNonce: string,
    domain: string,
    uri: string,
    now: Date,
  ): Promise<SiweNonce | null> {
    const nonce = this.nonces.get(hashedNonce);
    if (
      nonce === undefined ||
      nonce.consumedAt !== null ||
      nonce.expiresAt <= now ||
      nonce.domain !== domain ||
      nonce.uri !== uri
    ) {
      return null;
    }
    const consumed = { ...nonce, consumedAt: now };
    this.nonces.set(hashedNonce, consumed);
    return consumed;
  }

  async provisionUserForWallet(): Promise<UserWithWallet> {
    return { user: this.user, wallet: this.wallet };
  }

  async insertSession(input: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>): Promise<Session> {
    const session: Session = {
      ...input,
      id: '44444444-4444-4444-8444-444444444444',
      createdAt: new Date('2026-07-15T10:00:00.000Z'),
      updatedAt: new Date('2026-07-15T10:00:00.000Z'),
    };
    this.sessions.set(session.hashedSessionToken, session);
    return session;
  }

  async getSessionByToken(hashedToken: string): Promise<Session | null> {
    return this.sessions.get(hashedToken) ?? null;
  }

  async getUser(id: string): Promise<User | null> {
    return id === this.user.id ? this.user : null;
  }

  async getUserWalletsByUser(userId: string): Promise<UserWallet[]> {
    return userId === this.user.id ? [this.wallet] : [];
  }

  async revokeSession(id: string): Promise<Session | null> {
    const entry = [...this.sessions.entries()].find(([, session]) => session.id === id);
    if (entry === undefined) return null;
    const [key, session] = entry;
    const revoked = { ...session, revokedAt: new Date('2026-07-15T10:01:00.000Z') };
    this.sessions.set(key, revoked);
    return revoked;
  }
}

function message(nonce: string): string {
  return `localhost wants you to sign in with your Ethereum account:
${ADDRESS}

Sign in to Hood Sentry.

URI: ${ORIGIN}
Version: 1
Chain ID: 46630
Nonce: ${nonce}
Issued At: 2026-07-15T10:00:00.000Z
Expiration Time: 2026-07-15T10:05:00.000Z`;
}

async function setup() {
  const repository = new MemoryAuthRepository();
  const app = Fastify();
  await app.register(authRoutes, {
    prefix: '/v1',
    repository,
    verifier: async () => true,
    chainId: 46630,
    domain: 'localhost',
    uri: ORIGIN,
    publicAppUrl: ORIGIN,
    sessionSecret: 's'.repeat(48),
    sessionDurationSeconds: 3_600,
    production: false,
    now: () => new Date('2026-07-15T10:00:00.000Z'),
  });
  return { app, repository };
}

describe('SIWE authentication routes', () => {
  it('issues, verifies, reads, and revokes a session', async () => {
    const { app } = await setup();
    const nonceResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/siwe/nonce',
      headers: { origin: ORIGIN },
    });
    expect(nonceResponse.statusCode).toBe(200);
    const nonce = nonceResponse.json<{ data: { nonce: string } }>().data.nonce;

    const verifyResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/siwe/verify',
      headers: { origin: ORIGIN },
      payload: { message: message(nonce), signature: '0x01' },
    });
    expect(verifyResponse.statusCode).toBe(200);
    const cookie = verifyResponse.headers['set-cookie'];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');

    const sessionResponse = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie },
    });
    expect(sessionResponse.json()).toMatchObject({
      data: { authenticated: true, wallets: [{ chainId: 46630, address: ADDRESS.toLowerCase() }] },
    });

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { cookie, origin: ORIGIN },
    });
    expect(logoutResponse.statusCode).toBe(200);

    const revokedResponse = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie },
    });
    expect(revokedResponse.json()).toEqual({ data: { authenticated: false, wallets: [] } });
    await app.close();
  });

  it('rejects an untrusted origin and nonce replay', async () => {
    const { app } = await setup();
    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/auth/siwe/nonce',
      headers: { origin: 'https://attacker.example' },
    });
    expect(rejected.statusCode).toBe(401);

    const nonceResponse = await app.inject({
      method: 'POST',
      url: '/v1/auth/siwe/nonce',
      headers: { origin: ORIGIN },
    });
    const nonce = nonceResponse.json<{ data: { nonce: string } }>().data.nonce;
    const payload = { message: message(nonce), signature: '0x01' };
    const first = await app.inject({
      method: 'POST',
      url: '/v1/auth/siwe/verify',
      headers: { origin: ORIGIN },
      payload,
    });
    const replay = await app.inject({
      method: 'POST',
      url: '/v1/auth/siwe/verify',
      headers: { origin: ORIGIN },
      payload,
    });
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(401);
    await app.close();
  });
});
