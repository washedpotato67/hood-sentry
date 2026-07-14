import { describe, expect, it } from 'vitest';
import { generateId, generateRequestId } from '../id.js';

describe('generateRequestId', () => {
  it('generates ID with req_ prefix', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^req_[a-f0-9]{32}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
    expect(ids.size).toBe(100);
  });
});

describe('generateId', () => {
  it('generates ID with custom prefix', () => {
    const id = generateId('scan');
    expect(id).toMatch(/^scan_[a-f0-9]{32}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId('test')));
    expect(ids.size).toBe(100);
  });
});
