import { describe, expect, it } from 'vitest';
import { consumeClaim, issueClaim } from '../project-profiles.js';
describe('project profile claims', () => {
  it('consumes claims once and validates binding', () => {
    const c = issueClaim('p', '0x1111111111111111111111111111111111111111', 'app.test', 0);
    const consumed = consumeClaim(c, c.wallet, 'app.test', 1, true);
    expect(consumed.consumed).toBe(true);
    expect(() => consumeClaim(consumed, c.wallet, 'app.test', 1, true)).toThrow();
  });
});
