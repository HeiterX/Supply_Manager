import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type { Update, InlineKeyboardMarkup } from 'grammy/types';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { TelegramLinkService } from '../telegram/telegram-link.service.js';
import {
  TelegramDeliveryService,
  webUrl,
} from '../telegram/telegram-delivery.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { PurchaseRequestsService } from './purchase-requests.service.js';

export function verifyWebhookSecret(secret?: string) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (
    !expected ||
    expected.length < 32 ||
    !secret ||
    secret.length > 256 ||
    !timingSafeEqual(
      createHash('sha256').update(secret).digest(),
      createHash('sha256').update(expected).digest(),
    )
  )
    throw new UnauthorizedException();
}

@Injectable()
export class TelegramUpdatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly links: TelegramLinkService,
    private readonly delivery: TelegramDeliveryService,
    private readonly tasks: TasksService,
    private readonly requests: PurchaseRequestsService,
  ) {}

  async handle(input: unknown) {
    if (
      !input ||
      typeof input !== 'object' ||
      !Number.isSafeInteger((input as Update).update_id) ||
      (input as Update).update_id < 0
    )
      throw new BadRequestException();
    const update = input as Update;
    const callback = update.callback_query;
    const message = callback?.message ?? update.message;
    const from = callback?.from ?? update.message?.from;
    // Private bot chats only; callbacks must be sent by the private chat owner.
    if (
      !message ||
      !from ||
      message.chat.type !== 'private' ||
      !Number.isSafeInteger(from.id) ||
      from.id <= 0 ||
      from.id !== message.chat.id
    )
      return { ok: true };
    const chatId = String(from.id);
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.telegramUpdateReceipt.create({
            data: {
              updateId: BigInt(update.update_id),
              callbackId: callback?.id,
            },
          });
          const window = new Date(Math.floor(Date.now() / 60_000) * 60_000);
          const rate = await tx.telegramRate.upsert({
            where: { chatId: `${chatId}:${window.getTime()}` },
            create: {
              chatId: `${chatId}:${window.getTime()}`,
              window,
              count: 1,
            },
            update: { count: { increment: 1 } },
          });
          if (rate.count > 20) return;
          const user = await tx.user.findUnique({
            where: { telegramChatId: chatId },
          });
          const reply = async (
            text: string,
            keyboard?: InlineKeyboardMarkup,
            procurementOnly = false,
          ) => {
            await this.delivery.queue(
              tx,
              `update:${update.update_id}`,
              chatId,
              text,
              user?.status === 'ACTIVE' ? user.id : undefined,
              undefined,
              keyboard,
              procurementOnly,
            );
          };
          let command = 'text' in message ? (message.text?.trim() ?? '') : '';
          if (command.length > 256) return;
          if (command.startsWith('/start ')) {
            const claimed = await this.links.claim(
              tx,
              command.slice(7),
              chatId,
              from.username,
            );
            await reply(
              claimed
                ? 'Вернитесь в Настройки → Telegram и подтвердите именно этот аккаунт. Подключение ещё не завершено.'
                : 'Ссылка недействительна или истекла. Создайте новую ссылку в настройках Supply Manager.',
            );
            return;
          }
          if (!user || user.status !== 'ACTIVE') {
            await reply(
              'Добро пожаловать в Supply Manager! Для работы с ботом подключите Telegram в настройках своего аккаунта.',
            );
            return;
          }
          if (callback) {
            const id = callback.data;
            if (!id || !/^[a-f0-9]{32}$/.test(id)) {
              await reply('Кнопка устарела. Откройте /menu.');
              return;
            }
            const button = await tx.telegramButton.findFirst({
              where: {
                id,
                userId: user.id,
                usedAt: null,
                expiresAt: { gt: new Date() },
              },
            });
            if (!button) {
              await reply(
                'Кнопка устарела или уже использована. Откройте /menu.',
              );
              return;
            }
            const used = await tx.telegramButton.updateMany({
              where: { id, usedAt: null },
              data: { usedAt: new Date() },
            });
            if (!used.count) return;
            command = button.command;
          }
          const procurement =
            user.role === 'ADMIN' || user.role === 'PROCUREMENT';
          if (command === '/tasks') {
            if (!procurement) {
              const mine = await this.requests.findMine(user);
              await reply(
                mine
                  .slice(0, 10)
                  .map((r) => `Заявка №${r.number}: ${r.status}`)
                  .join('\n') || 'У вас пока нет заявок.',
              );
            } else {
              const tasks = await this.tasks.findAll();
              await reply(
                tasks
                  .filter((t) => !['CLOSED', 'CANCELLED'].includes(t.status))
                  .slice(0, 10)
                  .map(
                    (t) =>
                      `Закупка №${t.number}: ${t.status}\nСледующее действие: ${t.nextAction ?? 'не указано'}`,
                  )
                  .join('\n\n') || 'Активных закупок нет.',
                undefined,
                true,
              );
            }
          } else if (/^\/status\s+[1-9]\d{0,8}$/.test(command)) {
            if (!procurement) {
              await reply(
                'Просмотр закупок недоступен вашей роли. /tasks — ваши заявки.',
              );
              return;
            }
            const number = Number(command.split(/\s+/)[1]);
            const found = await tx.task.findUnique({
              where: { number },
              select: { id: true },
            });
            if (!found) {
              await reply('Закупка недоступна.');
              return;
            }
            const task = await this.tasks.findOne(found.id);
            const url = webUrl(`/tasks/${task.id}`);
            await reply(
              `Закупка №${task.number}\nСтатус: ${task.status}\nСледующее действие: ${task.nextAction ?? 'не указано'}\nНапоминание: ${task.reminderAt?.toISOString() ?? 'не задано'}`,
              url
                ? { inline_keyboard: [[{ text: 'Открыть закупку', url }]] }
                : undefined,
              true,
            );
          } else if (command === '/overdue' || command === '/actions') {
            await reply(
              procurement
                ? 'Сервис персональных действий и напоминаний пока недоступен. Активные закупки: /tasks.'
                : 'Просмотр действий закупок недоступен вашей роли.',
            );
          } else if (command === '/settings' || command === '/notifications') {
            const url = webUrl('/settings/telegram');
            await reply(
              'Подключение и подписки управляются в Настройки → Telegram.',
              url
                ? { inline_keyboard: [[{ text: 'Настройки Telegram', url }]] }
                : undefined,
            );
          } else if (command === '/help') {
            await reply(
              '/menu — меню\n/tasks — доступные закупки или свои заявки\n/settings — подключение и подписки' +
                (procurement
                  ? '\n/status НОМЕР — закупка\n/actions — персональные действия\n/overdue — просрочки (сервис пока недоступен)'
                  : ''),
            );
          } else {
            const entries = procurement
              ? [
                  ['Мои действия', '/actions'],
                  ['Активные закупки', '/tasks'],
                  ['Просроченные действия', '/overdue'],
                  ['Уведомления', '/notifications'],
                  ['Настройки', '/settings'],
                  ['Помощь', '/help'],
                ]
              : [
                  ['Мои заявки', '/tasks'],
                  ['Настройки', '/settings'],
                  ['Помощь', '/help'],
                ];
            const keyboard = [];
            for (const [text, action] of entries) {
              const id = randomBytes(16).toString('hex');
              await tx.telegramButton.create({
                data: {
                  id,
                  userId: user.id,
                  command: action,
                  expiresAt: new Date(Date.now() + 600_000),
                },
              });
              keyboard.push([{ text, callback_data: id }]);
            }
            await reply(
              `Supply Manager\nВаша роль: ${user.role}\nВыберите действие:`,
              { inline_keyboard: keyboard },
            );
          }
        },
        { timeout: 15_000 },
      );
    } catch (error) {
      // Unique receipts protect simultaneous update IDs and callback IDs in one transaction.
      if ((error as { code?: string }).code !== 'P2002') throw error;
    }
    if (callback) await this.telegram.answer(callback.id);
    return { ok: true };
  }
}
