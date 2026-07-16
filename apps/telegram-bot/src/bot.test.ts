import { describe, expect, it, vi } from 'vitest';
import { commandReply, parseCommand } from './bot.js';

describe('Telegram bot commands', () => {
  it('parses commands without accepting arbitrary text as commands', () => {
    expect(parseCommand('/start link-value')).toEqual({ name: 'start', payload: 'link-value' });
    expect(parseCommand('/id@HoodSentryBot')).toEqual({ name: 'id' });
    expect(parseCommand('hello')).toBeNull();
  });

  it('returns a linking flow without requesting wallet secrets', () => {
    const reply = commandReply({ name: 'start', payload: null }, 123);
    expect(reply).toContain('123');
    expect(reply).toContain('never requests');
  });

  it('reports polling failures through the service error callback', async () => {
    const controller = new AbortController();
    const onError = vi.fn<(error: Error) => void>(() => controller.abort());
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('telegram unavailable'));
    const { TelegramPollingBot } = await import('./bot.js');
    const bot = new TelegramPollingBot(
      'token',
      'http://localhost:4000',
      fetchImplementation,
      onError,
    );

    await bot.run(controller.signal);

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'telegram unavailable' }),
    );
  });
});
