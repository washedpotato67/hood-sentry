export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Canonical values cannot contain non-finite numbers');
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') return JSON.stringify({ $bigint: value.toString() });
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const record = Object.entries(value).filter((entry) => entry[1] !== undefined);
    record.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${record
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(',')}}`;
  }
  throw new Error(`Unsupported canonical value type: ${typeof value}`);
}
