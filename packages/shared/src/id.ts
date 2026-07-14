import { randomUUID } from 'node:crypto';

export function generateRequestId(): string {
  return `req_${randomUUID().replace(/-/g, '')}`;
}

export function generateId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '')}`;
}
