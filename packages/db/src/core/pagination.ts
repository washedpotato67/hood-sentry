export interface CursorPaginationOptions {
  limit: number;
  cursor?: string;
  orderBy: 'asc' | 'desc';
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function encodeCursor(value: string | number | Date): string {
  const strValue = value instanceof Date ? value.toISOString() : String(value);
  return Buffer.from(strValue).toString('base64');
}

export function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64').toString('utf-8');
}

export function decodeCursorAsDate(cursor: string): Date {
  return new Date(decodeCursor(cursor));
}

export function decodeCursorAsNumber(cursor: string): number {
  return Number(decodeCursor(cursor));
}

export function buildPaginatedResult<T>(
  data: T[],
  limit: number,
  getCursorValue: (item: T) => string | number | Date,
): PaginatedResult<T> {
  const hasMore = data.length > limit;
  const trimmedData = hasMore ? data.slice(0, limit) : data;
  const lastItem = trimmedData[trimmedData.length - 1];

  return {
    data: trimmedData,
    nextCursor: hasMore && lastItem ? encodeCursor(getCursorValue(lastItem)) : null,
    hasMore,
  };
}
