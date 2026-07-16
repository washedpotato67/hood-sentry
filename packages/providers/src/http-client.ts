import { z } from 'zod';

export type ProviderHttpErrorCode =
  | 'PROVIDER_CIRCUIT_OPEN'
  | 'PROVIDER_HTTP_ERROR'
  | 'PROVIDER_NETWORK_ERROR'
  | 'PROVIDER_RESPONSE_INVALID'
  | 'PROVIDER_RESPONSE_TOO_LARGE'
  | 'PROVIDER_TIMEOUT';

export class ProviderHttpError extends Error {
  constructor(
    readonly code: ProviderHttpErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status: number | null = null,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderHttpError';
  }
}

export type ProviderHttpClientOptions = {
  providerId: string;
  fetchRequest?: typeof fetch;
  timeoutMs?: number;
  maximumAttempts?: number;
  retryBaseDelayMs?: number;
  maximumResponseBytes?: number;
  requestsPerSecond?: number;
  circuitFailureThreshold?: number;
  circuitResetMs?: number;
  now?: () => Date;
  random?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
};

export type ProviderHttpRequest<T> = {
  url: string;
  schema: z.ZodType<T>;
  method?: 'GET' | 'POST';
  headers?: Readonly<Record<string, string>>;
  body?: string;
  secretValues?: readonly string[];
};

export type ProviderHttpResponse<T> = {
  data: T;
  provenance: {
    providerId: string;
    endpoint: string;
    fetchedAt: string;
    status: number;
  };
};

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function nonnegativeNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} cannot be negative`);
  return value;
}

function retryAfterMilliseconds(value: string | null, now: Date): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - now.getTime());
}

function redactEndpoint(rawUrl: string, secretValues: readonly string[]): string {
  const url = new URL(rawUrl);
  for (const [key] of url.searchParams) {
    if (/(api[-_]?key|token|secret|authorization|auth)/i.test(key)) {
      url.searchParams.set(key, '[REDACTED]');
    }
  }
  let safe = url.toString();
  for (const secret of secretValues) {
    if (secret.length === 0) continue;
    safe = safe.replaceAll(secret, '[REDACTED]');
    safe = safe.replaceAll(encodeURIComponent(secret), '[REDACTED]');
  }
  return safe;
}

async function readLimitedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new ProviderHttpError(
      'PROVIDER_RESPONSE_TOO_LARGE',
      'Provider response exceeds the configured size limit',
      false,
      response.status,
    );
  }
  if (response.body === null) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    totalBytes += chunk.value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new ProviderHttpError(
        'PROVIDER_RESPONSE_TOO_LARGE',
        'Provider response exceeds the configured size limit',
        false,
        response.status,
      );
    }
    chunks.push(chunk.value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new ProviderHttpError(
      'PROVIDER_RESPONSE_INVALID',
      'Provider response is not valid JSON',
      false,
      response.status,
    );
  }
}

export class ProviderHttpClient {
  private readonly providerId: string;
  private readonly fetchRequest: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maximumAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly maximumResponseBytes: number;
  private readonly minimumRequestIntervalMs: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitResetMs: number;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private consecutiveFailures = 0;
  private circuitOpenedAt: number | null = null;
  private lastRequestAt = 0;
  private rateLimitQueue: Promise<void> = Promise.resolve();

  constructor(options: ProviderHttpClientOptions) {
    this.providerId = z.string().min(1).parse(options.providerId);
    this.fetchRequest = options.fetchRequest ?? fetch;
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 5_000, 'Provider timeout');
    this.maximumAttempts = positiveInteger(
      options.maximumAttempts ?? 3,
      'Provider maximum attempts',
    );
    this.retryBaseDelayMs = nonnegativeNumber(
      options.retryBaseDelayMs ?? 250,
      'Provider retry delay',
    );
    this.maximumResponseBytes = positiveInteger(
      options.maximumResponseBytes ?? 1_000_000,
      'Provider response limit',
    );
    const requestsPerSecond = options.requestsPerSecond ?? 5;
    if (!Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0) {
      throw new Error('Provider requests per second must be positive');
    }
    this.minimumRequestIntervalMs = 1_000 / requestsPerSecond;
    this.circuitFailureThreshold = positiveInteger(
      options.circuitFailureThreshold ?? 5,
      'Provider circuit failure threshold',
    );
    this.circuitResetMs = positiveInteger(
      options.circuitResetMs ?? 30_000,
      'Provider circuit reset time',
    );
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async request<T>(input: ProviderHttpRequest<T>): Promise<ProviderHttpResponse<T>> {
    this.assertCircuitAvailable();
    let lastError: ProviderHttpError | null = null;

    for (let attempt = 1; attempt <= this.maximumAttempts; attempt += 1) {
      try {
        const result = await this.requestOnce(input);
        this.consecutiveFailures = 0;
        this.circuitOpenedAt = null;
        return result;
      } catch (error) {
        const providerError = this.normalizeError(error);
        lastError = providerError;
        if (!providerError.retryable || attempt === this.maximumAttempts) break;
        const exponential = this.retryBaseDelayMs * 2 ** (attempt - 1);
        const jitter = Math.floor(this.random() * Math.max(1, this.retryBaseDelayMs));
        const delay = providerError.retryAfterMs ?? exponential + jitter;
        await this.sleep(Math.min(delay, 30_000));
      }
    }

    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.circuitFailureThreshold) {
      this.circuitOpenedAt = this.now().getTime();
    }
    throw lastError ?? new ProviderHttpError('PROVIDER_NETWORK_ERROR', 'Provider failed', true);
  }

  private assertCircuitAvailable(): void {
    if (this.circuitOpenedAt === null) return;
    const elapsed = this.now().getTime() - this.circuitOpenedAt;
    if (elapsed >= this.circuitResetMs) {
      this.circuitOpenedAt = null;
      return;
    }
    throw new ProviderHttpError(
      'PROVIDER_CIRCUIT_OPEN',
      `${this.providerId} circuit is open`,
      false,
    );
  }

  private async acquireRateLimitSlot(): Promise<void> {
    const scheduled = this.rateLimitQueue.then(async () => {
      const currentTime = this.now().getTime();
      const waitMs = Math.max(0, this.lastRequestAt + this.minimumRequestIntervalMs - currentTime);
      if (waitMs > 0) await this.sleep(waitMs);
      this.lastRequestAt = this.now().getTime();
    });
    this.rateLimitQueue = scheduled.catch(() => undefined);
    await scheduled;
  }

  private async requestOnce<T>(input: ProviderHttpRequest<T>): Promise<ProviderHttpResponse<T>> {
    const url = new URL(input.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new ProviderHttpError(
        'PROVIDER_RESPONSE_INVALID',
        'Provider URL must use HTTP without embedded credentials',
        false,
      );
    }
    await this.acquireRateLimitSlot();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchRequest(url, {
        method: input.method ?? 'GET',
        headers: input.headers,
        body: input.body,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ProviderHttpError(
          'PROVIDER_HTTP_ERROR',
          `${this.providerId} returned HTTP ${response.status}`,
          response.status === 408 || response.status === 429 || response.status >= 500,
          response.status,
          retryAfterMilliseconds(response.headers.get('retry-after'), this.now()),
        );
      }
      const raw = await readLimitedJson(response, this.maximumResponseBytes);
      const parsed = input.schema.safeParse(raw);
      if (!parsed.success) {
        throw new ProviderHttpError(
          'PROVIDER_RESPONSE_INVALID',
          `${this.providerId} returned a response outside its schema`,
          false,
          response.status,
        );
      }
      return {
        data: parsed.data,
        provenance: {
          providerId: this.providerId,
          endpoint: redactEndpoint(input.url, input.secretValues ?? []),
          fetchedAt: this.now().toISOString(),
          status: response.status,
        },
      };
    } catch (error) {
      if (error instanceof ProviderHttpError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ProviderHttpError(
          'PROVIDER_TIMEOUT',
          `${this.providerId} request timed out`,
          true,
        );
      }
      throw new ProviderHttpError(
        'PROVIDER_NETWORK_ERROR',
        `${this.providerId} request failed`,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeError(error: unknown): ProviderHttpError {
    if (error instanceof ProviderHttpError) return error;
    return new ProviderHttpError(
      'PROVIDER_NETWORK_ERROR',
      `${this.providerId} request failed`,
      true,
    );
  }
}
