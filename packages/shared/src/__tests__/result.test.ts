import { describe, expect, it } from 'vitest';
import { err, ok, unwrap } from '../result.js';

describe('Result', () => {
  it('creates ok result', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
    }
  });

  it('creates error result', () => {
    const result = err(new Error('fail'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('fail');
    }
  });

  it('unwrap returns value for ok result', () => {
    const result = ok(42);
    expect(unwrap(result)).toBe(42);
  });

  it('unwrap throws for error result', () => {
    const result = err(new Error('fail'));
    expect(() => unwrap(result)).toThrow('fail');
  });
});
