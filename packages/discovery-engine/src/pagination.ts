import { z } from 'zod';
import type { DiscoveryPage } from './types.js';

const cursorSchema = z.object({
  version: z.literal(1),
  offset: z.number().int().nonnegative(),
  fingerprint: z.string().min(1),
});

export function encodeCursor(offset: number, fingerprint: string): string {
  return Buffer.from(JSON.stringify({ version: 1, offset, fingerprint }), 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(cursor: string | undefined, fingerprint: string): number {
  if (cursor === undefined) return 0;
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    if (parsed.fingerprint !== fingerprint)
      throw new Error('Cursor does not match the current query');
    return parsed.offset;
  } catch (error) {
    if (error instanceof Error && error.message === 'Cursor does not match the current query')
      throw error;
    throw new Error('Cursor is malformed');
  }
}

export function paginate<T>(
  items: readonly T[],
  limit: number,
  cursor: string | undefined,
  fingerprint: string,
): DiscoveryPage<T> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Page limit is outside the supported range');
  const offset = decodeCursor(cursor, fingerprint);
  const data = items.slice(offset, offset + limit);
  const nextOffset = offset + data.length;
  const hasMore = nextOffset < items.length;
  return { data, nextCursor: hasMore ? encodeCursor(nextOffset, fingerprint) : null, hasMore };
}
