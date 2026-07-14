import { describe, expect, it } from 'vitest';
import { AlertService } from '../alerts.js';
import { NotificationService } from '../notifications.js';
import { WatchlistService } from '../watchlists.js';
describe('watchlists, alerts, and notifications', () => {
  it('enforces ownership, duplicates, and limits', () => {
    const s = new WatchlistService({ free: 1 });
    const l = s.create('u', 'token', 'Main');
    s.add(l.id, 'u', '0x1111111111111111111111111111111111111111');
    expect(s.add(l.id, 'u', '0x1111111111111111111111111111111111111111').items).toHaveLength(1);
    expect(() => s.add(l.id, 'x', '0x2222222222222222222222222222222222222222')).toThrow();
    expect(() => s.add(l.id, 'u', '0x2222222222222222222222222222222222222222')).toThrow();
  });
  it('deduplicates alerts and deliveries', () => {
    const a = new AlertService();
    a.create({
      id: 'r',
      ownerId: 'u',
      kind: 'price_threshold',
      target: '0x1111111111111111111111111111111111111111',
      enabled: true,
      cooldownSeconds: 60,
      finality: 'confirmed',
    });
    expect(a.evaluate('r', 'e', 1)).not.toBeNull();
    expect(a.evaluate('r', 'e2', 2)).toBeNull();
    const n = new NotificationService();
    expect(n.enqueue('email', 'e').id).toBe(n.enqueue('email', 'e').id);
  });
});
