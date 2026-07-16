import { z } from 'zod';

const userSchema = z.object({ id: z.number().int().positive() });
const chatSchema = z.object({ id: z.number().int() });
const messageSchema = z.object({
  message_id: z.number().int().nonnegative(),
  from: userSchema.optional(),
  chat: chatSchema,
  text: z.string().max(4_096).optional(),
});
const updateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: messageSchema.optional(),
});
const updatesResponseSchema = z.object({
  ok: z.literal(true),
  result: z.array(updateSchema),
});
const sendResponseSchema = z.object({ ok: z.literal(true), result: messageSchema });

export type BotCommand =
  | { name: 'start'; payload: string | null }
  | { name: 'help' }
  | { name: 'id' }
  | { name: 'status' }
  | { name: 'unknown'; value: string };

export function parseCommand(text: string): BotCommand | null {
  const firstLine = text.trim().split('\n')[0]?.trim();
  if (firstLine === undefined || !firstLine.startsWith('/')) return null;
  const [rawName = '', ...parts] = firstLine.split(/\s+/);
  const name = rawName.slice(1).split('@')[0]?.toLowerCase() ?? '';
  if (name === 'start') return { name, payload: parts.join(' ').slice(0, 256) || null };
  if (name === 'help' || name === 'id' || name === 'status') return { name };
  return { name: 'unknown', value: name.slice(0, 64) };
}

export function commandReply(
  command: BotCommand,
  chatId: number,
  status: 'ready' | 'degraded' | 'unknown' = 'unknown',
): string {
  if (command.name === 'id') {
    return `Your Telegram chat ID is ${chatId}. Enter this value in Hood Sentry Alerts, then submit the verification code sent here.`;
  }
  if (command.name === 'status') return `Hood Sentry API status: ${status}.`;
  if (command.name === 'start') {
    return [
      'Hood Sentry Telegram alerts are active.',
      `Your chat ID is ${chatId}.`,
      'Open the Alerts page, add a Telegram channel, and verify the six-digit code.',
      'This bot never requests a seed phrase, private key, or wallet transaction.',
    ].join('\n');
  }
  if (command.name === 'help') {
    return ['/id: show your chat ID', '/status: check API readiness', '/help: show commands'].join(
      '\n',
    );
  }
  return `Unknown command /${command.value}. Send /help for supported commands.`;
}

export class TelegramPollingBot {
  private offset = 0;

  constructor(
    private readonly token: string,
    private readonly apiBaseUrl: string,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly onError: (error: Error) => void = () => undefined,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const updates = await this.getUpdates(signal);
        for (const update of updates) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          const message = update.message;
          if (message?.text === undefined) continue;
          const command = parseCommand(message.text);
          if (command === null) continue;
          const status =
            command.name === 'status' ? await this.readStatus(signal) : ('unknown' as const);
          await this.sendMessage(
            message.chat.id,
            commandReply(command, message.chat.id, status),
            signal,
          );
        }
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof Error && error.name === 'AbortError') return;
        this.onError(error instanceof Error ? error : new Error('Telegram polling failed'));
        if (signal.aborted) return;
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
  }

  private async getUpdates(signal: AbortSignal) {
    const response = await this.fetchImplementation(
      `https://api.telegram.org/bot${this.token}/getUpdates?offset=${this.offset}&timeout=25&allowed_updates=%5B%22message%22%5D`,
      { signal },
    );
    if (!response.ok) throw new Error(`TELEGRAM_UPDATES_HTTP_${response.status}`);
    return updatesResponseSchema.parse(await response.json()).result;
  }

  private async sendMessage(chatId: number, text: string, signal: AbortSignal): Promise<void> {
    const response = await this.fetchImplementation(
      `https://api.telegram.org/bot${this.token}/sendMessage`,
      {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      },
    );
    if (!response.ok) throw new Error(`TELEGRAM_SEND_HTTP_${response.status}`);
    sendResponseSchema.parse(await response.json());
  }

  private async readStatus(signal: AbortSignal): Promise<'ready' | 'degraded' | 'unknown'> {
    try {
      const response = await this.fetchImplementation(`${this.apiBaseUrl}/health/ready`, {
        signal,
      });
      if (!response.ok) return 'degraded';
      const value = z.object({ status: z.string() }).parse(await response.json());
      return value.status === 'ready' ? 'ready' : 'degraded';
    } catch {
      return 'unknown';
    }
  }
}
