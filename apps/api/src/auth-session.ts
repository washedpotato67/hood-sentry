import { hashOpaqueSecret } from '@hood-sentry/auth';
import type { AuthRepository, User, UserWallet } from '@hood-sentry/db';
import { UnauthorizedError } from '@hood-sentry/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

const SESSION_COOKIE = 'hood_sentry_session';

export type AuthenticatedSession = {
  sessionId: string;
  user: User;
  wallets: readonly UserWallet[];
};

type SessionRepository = Pick<
  AuthRepository,
  'getSessionByToken' | 'getUser' | 'getUserWalletsByUser'
>;

function cookieValue(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    const value = pair.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  return null;
}

function cookieHeader(value: string, maximumAgeSeconds: number, secure: boolean): string {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maximumAgeSeconds}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export class AuthSessionManager {
  constructor(
    private readonly repository: SessionRepository,
    private readonly signingSecret: string,
    private readonly secureCookies: boolean,
    private readonly now: () => Date = () => new Date(),
  ) {}

  setCookie(reply: FastifyReply, token: string, maximumAgeSeconds: number): void {
    reply.header('set-cookie', cookieHeader(token, maximumAgeSeconds, this.secureCookies));
  }

  clearCookie(reply: FastifyReply): void {
    reply.header('set-cookie', cookieHeader('', 0, this.secureCookies));
  }

  async authenticate(request: FastifyRequest): Promise<AuthenticatedSession | null> {
    const token = cookieValue(request.headers.cookie, SESSION_COOKIE);
    if (token === null || token.length < 32 || token.length > 256) return null;
    const session = await this.repository.getSessionByToken(
      hashOpaqueSecret(token, this.signingSecret),
    );
    const now = this.now();
    if (session === null || session.revokedAt !== null || session.expiresAt <= now) return null;
    const user = await this.repository.getUser(session.userId);
    if (user === null || user.status !== 'active') return null;
    const wallets = await this.repository.getUserWalletsByUser(user.id);
    return { sessionId: session.id, user, wallets };
  }

  async require(request: FastifyRequest): Promise<AuthenticatedSession> {
    const session = await this.authenticate(request);
    if (session === null) throw new UnauthorizedError('A valid session is required');
    return session;
  }
}

export function requireTrustedOrigin(request: FastifyRequest, publicAppUrl: string): void {
  const origin = request.headers.origin;
  const expected = new URL(publicAppUrl).origin;
  if (origin !== expected) throw new UnauthorizedError('Request origin is invalid');
}
