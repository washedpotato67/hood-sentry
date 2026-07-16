import { describe, expect, it } from 'vitest';
import { decryptNotificationConfig, encryptNotificationConfig } from '../notification-config.js';

describe('notification channel configuration encryption', () => {
  it('round-trips configuration without storing plaintext', () => {
    const secret = 's'.repeat(48);
    const encrypted = encryptNotificationConfig(
      { email: 'user@example.com', authenticationSecret: 'private-value' },
      secret,
    );
    expect(JSON.stringify(encrypted)).not.toContain('user@example.com');
    expect(decryptNotificationConfig(encrypted, secret)).toEqual({
      email: 'user@example.com',
      authenticationSecret: 'private-value',
    });
  });

  it('rejects a changed authentication tag', () => {
    const secret = 's'.repeat(48);
    const encrypted = encryptNotificationConfig({ chatId: '42' }, secret);
    expect(() =>
      decryptNotificationConfig({ ...encrypted, authenticationTag: 'changed' }, secret),
    ).toThrow();
  });
});
