const SECRET_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /authorization/i,
  /cookie/i,
  /session/i,
  /access[_-]?key/i,
  /mnemonic/i,
  /seed[_-]?phrase/i,
  /signing[_-]?key/i,
  /encryption[_-]?key/i,
  /webhook[_-]?secret/i,
  /client[_-]?secret/i,
  /refresh[_-]?token/i,
  /bearer/i,
];

const PII_KEY_PATTERNS: ReadonlyArray<RegExp> = [
  /email/i,
  /phone/i,
  /ssn/i,
  /social[_-]?security/i,
  /credit[_-]?card/i,
  /ip[_-]?address/i,
];

const SIGNATURE_PATTERN = /^0x[a-fA-F0-9]{130}$/;
const PRIVATE_KEY_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const SESSION_COOKIE_PATTERN = /connect\.sid=|session_id=|sessionid=/i;
const PROVIDER_URL_WITH_KEY_PATTERN = /https?:\/\/[^\s]*\b(key|token|apikey|api_key)=[^\s&]+/i;

const REDACTED = '[REDACTED]';
const REDACTED_PII = '[PII_REDACTED]';
const TRUNCATED_SUFFIX = '…';

function redactStringValue(key: string, value: string): string {
  if (SIGNATURE_PATTERN.test(value)) {
    return `${value.slice(0, 10)}${TRUNCATED_SUFFIX}[sig]`;
  }
  if (PRIVATE_KEY_PATTERN.test(value) && /key|secret|private/i.test(key)) {
    return REDACTED;
  }
  if (SESSION_COOKIE_PATTERN.test(value)) {
    return REDACTED;
  }
  if (PROVIDER_URL_WITH_KEY_PATTERN.test(value)) {
    return value.replace(/(\b(?:key|token|apikey|api_key))=([^\s&]+)/gi, '$1=[REDACTED]');
  }
  return value;
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function isPiiKey(key: string): boolean {
  return PII_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function redactSecrets(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj;
  if (typeof obj === 'number' || typeof obj === 'boolean' || typeof obj === 'bigint') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSecrets(item));
  }

  if (typeof obj !== 'object') return obj;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSecretKey(key)) {
      result[key] = REDACTED;
    } else if (isPiiKey(key)) {
      result[key] = REDACTED_PII;
    } else if (typeof value === 'string') {
      result[key] = redactStringValue(key, value);
    } else {
      result[key] = redactSecrets(value);
    }
  }
  return result;
}

export function hashIdentifier(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `0x${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function sanitizeProviderUrl(url: string): string {
  return url.replace(/(\b(?:key|token|apikey|api_key|secret))=([^\s&]+)/gi, '$1=[REDACTED]');
}

export { REDACTED, REDACTED_PII };
