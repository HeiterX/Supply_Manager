import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';

import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  TelegramService,
  type TelegramCallbackQuery,
} from '../telegram/telegram.service.js';
import { PurchaseRequestsService } from './purchase-requests.service.js';

@Injectable()
export class TelegramUpdatesService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    TelegramUpdatesService.name,
  );

  private running = false;
  private offset = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramService: TelegramService,
    private readonly purchaseRequestsService: PurchaseRequestsService,
  ) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    if (!this.telegramService.isConfigured()) {
      this.logger.warn(
        'Telegram polling disabled: Telegram is not configured',
      );
      return;
    }

    const linked = await this.ensureOperatorLinked();

    if (!linked) {
      this.logger.warn(
        'Telegram polling disabled: operator is not linked',
      );
      return;
    }

    this.running = true;

    this.logger.log(
      'Telegram polling started',
    );

    void this.poll();
  }

  onModuleDestroy() {
    this.running = false;
  }

  private async ensureOperatorLinked(): Promise<boolean> {
    const username =
      process.env.TELEGRAM_OPERATOR_USERNAME?.trim();

    const chatId =
      process.env.TELEGRAM_CHAT_ID?.trim();

    if (!username || !chatId) {
      this.logger.warn(
        'TELEGRAM_OPERATOR_USERNAME or TELEGRAM_CHAT_ID is missing',
      );
      return false;
    }

    const user = await this.prisma.user.findUnique({
      where: {
        username,
      },
    });

    if (!user) {
      this.logger.error(
        `Telegram operator "${username}" not found`,
      );
      return false;
    }

    if (
      user.status !== 'ACTIVE' ||
      (user.role !== 'ADMIN' &&
        user.role !== 'PROCUREMENT')
    ) {
      this.logger.error(
        `User "${username}" cannot operate Telegram actions`,
      );
      return false;
    }

    if (
      user.telegramChatId &&
      user.telegramChatId !== chatId
    ) {
      this.logger.error(
        `User "${username}" is already linked to another Telegram chat`,
      );
      return false;
    }

    const existingUser =
      await this.prisma.user.findUnique({
        where: {
          telegramChatId: chatId,
        },
      });

    if (
      existingUser &&
      existingUser.id !== user.id
    ) {
      this.logger.error(
        'This Telegram chat is already linked to another user',
      );
      return false;
    }

    if (!user.telegramChatId) {
      await this.prisma.user.update({
        where: {
          id: user.id,
        },
        data: {
          telegramChatId: chatId,
        },
      });

      this.logger.log(
        `Telegram chat linked to user "${username}"`,
      );
    }

    return true;
  }

  private async poll() {
    while (this.running) {
      try {
        const updates =
          await this.telegramService.getUpdates(
            this.offset,
          );

        for (const update of updates) {
          this.offset = update.update_id + 1;

          if (update.callback_query) {
            await this.handleCallback(
              update.callback_query,
            );
          }
        }
      } catch (error) {
        this.logger.error(
          'Telegram polling error',
          error instanceof Error
            ? error.stack
            : String(error),
        );

        await this.delay(3000);
      }
    }
  }

  private async handleCallback(
    callback: TelegramCallbackQuery,
  ) {
    const data = callback.data;

    if (!data?.startsWith('accept_request:')) {
      await this.telegramService.answerCallbackQuery(
        callback.id,
        'Неизвестная команда',
      );
      return;
    }

    try {
      const telegramChatId = String(
        callback.from.id,
      );

      const user =
        await this.prisma.user.findUnique({
          where: {
            telegramChatId,
          },
        });

      if (
        !user ||
        user.status !== 'ACTIVE' ||
        (user.role !== 'ADMIN' &&
          user.role !== 'PROCUREMENT')
      ) {
        await this.telegramService.answerCallbackQuery(
          callback.id,
          'Нет доступа к этой операции',
          true,
        );
        return;
      }

      const requestId = data.slice(
        'accept_request:'.length,
      );

      const authUser: AuthUser = {
        id: user.id,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        phone: user.phone,
        department: user.department,
        position: user.position,
        role: user.role,
        status: user.status,
        telegramChatId: user.telegramChatId,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };

      const purchaseRequest =
        await this.purchaseRequestsService.accept(
          authUser,
          requestId,
        );

      const task = purchaseRequest?.task;

      if (!task) {
        throw new Error(
          'Закупка после принятия заявки не найдена',
        );
      }

      await this.telegramService.answerCallbackQuery(
        callback.id,
        `Создана закупка №${task.number}`,
      );

      if (callback.message) {
        const originalText =
          callback.message.text ??
          '📦 Заявка Supply Manager';

        await this.telegramService.editMessageText(
          callback.message.chat.id,
          callback.message.message_id,
          `${originalText}\n\n` +
            `✅ Принята в работу\n` +
            `📦 Закупка №${task.number}\n` +
            `👤 Обработал: ${user.fullName}`,
        );
      }

      this.logger.log(
        `Purchase request ${requestId} accepted from Telegram by ${user.username}`,
      );
    } catch (error) {
      this.logger.error(
        'Telegram accept action failed',
        error instanceof Error
          ? error.stack
          : String(error),
      );

      await this.telegramService
        .answerCallbackQuery(
          callback.id,
          error instanceof Error
            ? error.message.slice(0, 180)
            : 'Не удалось принять заявку',
          true,
        )
        .catch(() => undefined);
    }
  }

  private delay(milliseconds: number) {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}
