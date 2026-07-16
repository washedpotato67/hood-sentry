export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; status: number };

function apiOrigin(): string {
  if (typeof window !== 'undefined') return '/api/sentry';
  return process.env.SENTRY_API_INTERNAL_URL ?? 'http://localhost:4000';
}

export async function apiDelete(path: string): Promise<ApiResult<null>> {
  try {
    const response = await fetch(`${apiOrigin()}${path}`, {
      method: 'DELETE',
      cache: 'no-store',
      credentials: 'include',
    });
    if (response.ok) return { ok: true, data: null };
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string };
    } | null;
    return {
      ok: false,
      status: response.status,
      code: body?.error?.code ?? `HTTP_${response.status}`,
      message: body?.error?.message ?? 'The service rejected the delete request.',
    };
  } catch {
    return {
      ok: false,
      status: 503,
      code: 'SERVICE_UNREACHABLE',
      message: 'The Sentry API is unreachable.',
    };
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${apiOrigin()}${path}`, {
      ...init,
      cache: init.cache ?? 'no-store',
      credentials: 'include',
      headers: {
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...init.headers,
      },
    });
    const body = (await response.json().catch(() => null)) as {
      data?: T;
      error?: { code?: string; message?: string };
    } | null;
    if (!response.ok || body?.data === undefined) {
      return {
        ok: false,
        status: response.status,
        code: body?.error?.code ?? `HTTP_${response.status}`,
        message: body?.error?.message ?? 'The service did not return data.',
      };
    }
    return { ok: true, data: body.data };
  } catch {
    return {
      ok: false,
      status: 503,
      code: 'SERVICE_UNREACHABLE',
      message: 'The Sentry API is unreachable.',
    };
  }
}

export function chainId(): number {
  const configured = Number(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID ?? '46630');
  return configured === 4663 ? 4663 : 46630;
}

export function compactAddress(address: string): string {
  return address.length < 14 ? address : `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function formatRaw(value: string | null | undefined, decimals: number | null = 18): string {
  if (value === null || value === undefined || decimals === null || !/^-?[0-9]+$/.test(value)) {
    return 'Unavailable';
  }
  const negative = value.startsWith('-');
  const digits = negative ? value.slice(1) : value;
  const padded = digits.padStart(decimals + 1, '0');
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction = decimals === 0 ? '' : padded.slice(-decimals).replace(/0+$/, '').slice(0, 6);
  return `${negative ? '-' : ''}${BigInt(whole).toLocaleString()}${fraction ? `.${fraction}` : ''}`;
}
