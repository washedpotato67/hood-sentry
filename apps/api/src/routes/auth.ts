import {
  createSessionToken,
  createSiweNonce,
  hashOpaqueSecret,
  parseCompleteSiweMessage,
  siweVerificationRequestSchema,
  validateSiwe,
} from '@hood-sentry/auth';
import type { AuthRepository } from '@hood-sentry/db';
import { AppError } from '@hood-sentry/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthSessionManager, requireTrustedOrigin } from '../auth-session.js';

type AuthRuntimeRepository = Pick<
  AuthRepository,
  | 'insertSiweNonce'
  | 'getSiweNonce'
  | 'consumeSiweNonce'
  | 'provisionUserForWallet'
  | 'insertSession'
  | 'revokeSession'
  | 'getSessionByToken'
  | 'getUser'
  | 'getUserWalletsByUser'
>;

export type SiweSignatureVerifier = (input: {
  address: `0x${string}`;
  domain: string;
  nonce: string;
  message: string;
  signature: `0x${string}`;
  time: Date;
}) => Promise<boolean>;

export type AuthRouteOptions = {
  repository: AuthRuntimeRepository;
  verifier: SiweSignatureVerifier;
  chainId: number;
  domain: string;
  uri: string;
  publicAppUrl: string;
  sessionSecret: string;
  sessionDurationSeconds: number;
  production: boolean;
  now?: () => Date;
};

const hexSchema = z.custom<`0x${string}`>(
  (value) => typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value),
  'Signature must be hex encoded',
);

function authError(code: string, message: string): AppError {
  return new AppError(code, message, 401);
}

export async function authRoutes(app: FastifyInstance, options: AuthRouteOptions) {
  const now = options.now ?? (() => new Date());
  const sessions = new AuthSessionManager(
    options.repository,
    options.sessionSecret,
    options.production,
    now,
  );

  app.post('/auth/siwe/nonce', async (request) => {
    requireTrustedOrigin(request, options.publicAppUrl);
    const issuedAt = now();
    const expiresAt = new Date(issuedAt.getTime() + 5 * 60 * 1_000);
    const nonce = createSiweNonce();
    await options.repository.insertSiweNonce({
      hashedNonce: hashOpaqueSecret(nonce, options.sessionSecret),
      domain: options.domain,
      uri: options.uri,
      expiresAt,
    });
    return {
      data: {
        nonce,
        domain: options.domain,
        uri: options.uri,
        chainId: options.chainId,
        issuedAt: issuedAt.toISOString(),
        expirationTime: expiresAt.toISOString(),
      },
    };
  });

  app.post('/auth/siwe/verify', async (request, reply) => {
    requireTrustedOrigin(request, options.publicAppUrl);
    const body = siweVerificationRequestSchema.parse(request.body);
    const message = parseCompleteSiweMessage(body.message);
    const requestTime = now();
    const hashedNonce = hashOpaqueSecret(message.nonce, options.sessionSecret);
    const nonce = await options.repository.getSiweNonce(hashedNonce);
    if (nonce === null) throw authError('SIWE_NONCE_INVALID', 'The sign-in nonce is invalid');
    if (nonce.domain !== options.domain || nonce.uri !== options.uri) {
      throw authError('SIWE_CONTEXT_INVALID', 'The sign-in context is invalid');
    }
    const signature = hexSchema.parse(body.signature);
    const signatureValid = await options.verifier({
      address: message.address,
      domain: options.domain,
      nonce: message.nonce,
      message: body.message,
      signature,
      time: requestTime,
    });
    try {
      validateSiwe(
        message,
        {
          domain: options.domain,
          uri: options.uri,
          chainId: options.chainId,
          now: Math.floor(requestTime.getTime() / 1_000),
        },
        {
          nonce: message.nonce,
          expiresAt: nonce.expiresAt.getTime(),
          consumed: nonce.consumedAt !== null,
        },
        signatureValid,
      );
    } catch {
      throw authError('SIWE_VERIFICATION_FAILED', 'The sign-in message failed verification');
    }
    const consumed = await options.repository.consumeSiweNonce(
      hashedNonce,
      options.domain,
      options.uri,
      requestTime,
    );
    if (consumed === null) throw authError('SIWE_NONCE_REPLAYED', 'The sign-in nonce was reused');

    const identity = await options.repository.provisionUserForWallet(
      options.chainId,
      message.address,
      requestTime,
    );
    const sessionToken = createSessionToken();
    const expiresAt = new Date(requestTime.getTime() + options.sessionDurationSeconds * 1_000);
    const session = await options.repository.insertSession({
      userId: identity.user.id,
      hashedSessionToken: hashOpaqueSecret(sessionToken, options.sessionSecret),
      expiresAt,
      deviceMetadata: { walletId: identity.wallet.id },
      ipAddress: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
      revokedAt: null,
    });
    sessions.setCookie(reply, sessionToken, options.sessionDurationSeconds);
    return {
      data: {
        authenticated: true,
        userId: identity.user.id,
        sessionId: session.id,
        expiresAt: expiresAt.toISOString(),
        wallets: [
          {
            chainId: identity.wallet.chainId,
            address: identity.wallet.address,
            isPrimary: identity.wallet.isPrimary,
            verifiedAt: identity.wallet.verifiedAt.toISOString(),
          },
        ],
      },
    };
  });

  app.get('/auth/session', async (request) => {
    const authenticated = await sessions.authenticate(request);
    if (authenticated === null) return { data: { authenticated: false, wallets: [] } };
    return {
      data: {
        authenticated: true,
        userId: authenticated.user.id,
        sessionId: authenticated.sessionId,
        wallets: authenticated.wallets.map((wallet) => ({
          chainId: wallet.chainId,
          address: wallet.address,
          isPrimary: wallet.isPrimary,
          verifiedAt: wallet.verifiedAt.toISOString(),
        })),
      },
    };
  });

  app.post('/auth/logout', async (request, reply) => {
    requireTrustedOrigin(request, options.publicAppUrl);
    const authenticated = await sessions.require(request);
    await options.repository.revokeSession(authenticated.sessionId);
    sessions.clearCookie(reply);
    return { data: { authenticated: false } };
  });
}
