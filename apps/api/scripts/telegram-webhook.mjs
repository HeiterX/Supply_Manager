import 'dotenv/config';
import { Api } from 'grammy';

// Explicit operator command, never invoked by startup, builds or tests.
try {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const url = new URL(process.env.TELEGRAM_WEBHOOK_URL ?? '');
  if (!token || !secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret) || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api/v1/telegram/webhook')) throw new Error();
  const api = new Api(token, { timeoutSeconds: 20 });
  await api.setWebhook(url.toString(), { secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
  await api.setMyCommands([
    { command: 'menu', description: 'Главное меню' },
    { command: 'tasks', description: 'Доступные закупки или свои заявки' },
    { command: 'status', description: 'Статус закупки по номеру' },
    { command: 'overdue', description: 'Состояние интеграции просрочек' },
    { command: 'settings', description: 'Настройки Telegram' },
    { command: 'help', description: 'Помощь' },
  ]);
  const info = await api.getWebhookInfo();
  if (info.url !== url.toString()) throw new Error();
  console.log(`Telegram webhook configured; pending updates: ${info.pending_update_count}`);
} catch {
  // Do not print API errors or token-bearing URLs.
  console.error('Telegram webhook setup failed. Check HTTPS URL, token, secret and network access.');
  process.exitCode = 1;
}
