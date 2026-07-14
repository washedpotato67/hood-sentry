import {
  type Env,
  type PublicEnv,
  envSchema,
  getConfigFingerprint,
  getPublicEnv,
} from './schema.js';

let cachedEnv: Readonly<Env> | null = null;
let frozen = false;

export class ConfigurationError extends Error {
  constructor(public readonly issues: Array<{ path: string; message: string }>) {
    const summary = issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    super(`Invalid environment configuration — ${summary}`);
    this.name = 'ConfigurationError';
  }
}

export function loadEnv(): Readonly<Env> {
  if (cachedEnv) return cachedEnv;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));

    // biome-ignore lint/suspicious/noConsole: startup error must be visible
    console.error('[config] Invalid environment configuration:');
    for (const issue of issues) {
      // biome-ignore lint/suspicious/noConsole: startup error must be visible
      console.error(`  - ${issue.path}: ${issue.message}`);
    }

    throw new ConfigurationError(issues);
  }

  cachedEnv = Object.freeze({ ...result.data });
  frozen = true;
  return cachedEnv;
}

export function getEnv(): Readonly<Env> {
  if (!cachedEnv) {
    return loadEnv();
  }
  return cachedEnv;
}

export function isFrozen(): boolean {
  return frozen;
}

export function getFingerprint(): Record<string, string> {
  const env = getEnv();
  return getConfigFingerprint(env as Env);
}

export function getSafePublicEnv(): PublicEnv {
  const env = getEnv();
  return getPublicEnv(env as Env);
}

export function resetEnvCache(): void {
  cachedEnv = null;
  frozen = false;
}
