import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrammyError } from 'grammy';
import { TelegramFailure, TelegramService } from './telegram.service.js';
import { verifyWebhookSecret } from '../purchase-requests/telegram-updates.service.js';
import { allowedCategories, hashToken } from './telegram-link.service.js';
import { webUrl } from './telegram-delivery.service.js';

const mock = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  answerCallbackQuery: vi.fn(),
}));
vi.mock('grammy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('grammy')>()),
  Api: class {
    sendMessage = mock.sendMessage;
    answerCallbackQuery = mock.answerCallbackQuery;
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe('Telegram API security', () => {
  it('verifies a strong webhook secret and fails closed', () => {
    expect(() => verifyWebhookSecret()).toThrow();
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 's'.repeat(40));
    expect(() => verifyWebhookSecret('wrong')).toThrow();
    expect(() => verifyWebhookSecret('s'.repeat(40))).not.toThrow();
  });
  it('hashes tokens and limits EMPLOYEE categories', () => {
    expect(hashToken('token')).toMatch(/^[a-f0-9]{64}$/);
    expect(allowedCategories('EMPLOYEE')).toEqual([]);
    expect(allowedCategories('ADMIN')).toHaveLength(5);
    expect(allowedCategories('PROCUREMENT')).toHaveLength(5);
  });
  it('refuses insecure production links', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FRONTEND_ORIGIN', 'http://localhost:3001');
    expect(webUrl('/settings/telegram')).toBeUndefined();
    vi.stubEnv('FRONTEND_ORIGIN', 'https://supply.example');
    expect(webUrl('/settings/telegram')).toBe(
      'https://supply.example/settings/telegram',
    );
  });
  it('returns success only after API acknowledgement and protects content', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'synthetic-test-token');
    mock.sendMessage.mockResolvedValue({ message_id: 71 });
    expect(await new TelegramService().send('123', 'hello')).toEqual({
      message_id: 71,
    });
    expect(mock.sendMessage).toHaveBeenCalledWith(
      '123',
      'hello',
      expect.objectContaining({ protect_content: true }),
    );
  });
  it('sanitizes network errors containing token URLs', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'synthetic-test-token');
    mock.sendMessage.mockRejectedValue(
      new Error('https://api.telegram.org/botSECRET/sendMessage'),
    );
    const error = await new TelegramService()
      .send('123', 'private')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TelegramFailure);
    expect(String(error)).not.toContain('SECRET');
    expect((error as TelegramFailure).code).toBe('NETWORK');
  });
  it('extracts 429 Retry-After without exposing API description', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'synthetic-test-token');
    mock.sendMessage.mockRejectedValue(
      new GrammyError(
        'private secret',
        {
          ok: false,
          error_code: 429,
          description: 'secret',
          parameters: { retry_after: 13 },
        },
        'sendMessage',
        {},
      ),
    );
    await expect(
      new TelegramService().send('123', 'private'),
    ).rejects.toMatchObject({
      code: '429',
      retryAfter: 13,
      message: 'Telegram delivery failed: 429',
    });
  });
});
