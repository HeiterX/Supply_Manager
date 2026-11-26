import {
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { InlineKeyboardMarkup } from 'grammy/types';
import { randomUUID } from 'node:crypto';
import { Prisma, type TelegramDelivery } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { allowedCategories, type Category } from './telegram-link.service.js';
import { TelegramFailure, TelegramService } from './telegram.service.js';

export type TelegramEvent = {
  // Stable CORE-09 event ID, unchanged on retries. No scheduler or deadline inference here.
  id: string;
  category: Category;
  recipientIds: string[];
  text: string;
  path: string;
};
export function webUrl(path: string) {
  try {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\'))
      return undefined;
    const origin = new URL(process.env.FRONTEND_ORIGIN?.split(',')[0] ?? '');
    if (
      origin.protocol !== 'https:' &&
      !(
        process.env.NODE_ENV !== 'production' &&
        origin.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(origin.hostname)
      )
    )
      return undefined;
    return new URL(path, origin.origin).toString();
  } catch {
    return undefined;
  }
}

@Injectable()
export class TelegramDeliveryService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private cleanupAt = 0;
  private readonly logger = new Logger(TelegramDeliveryService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV !== 'test' && this.telegram.isConfigured())
      this.schedule();
  }
  onModuleDestroy() {
    this.stopping = true;
    clearTimeout(this.timer);
  }
  private schedule() {
    this.timer = setTimeout(() => {
      void this.drain()
        .catch(() => this.logger.warn('Telegram worker database failure'))
        .finally(() => {
          if (!this.stopping) this.schedule();
        });
    }, 1000);
    this.timer.unref();
  }

  async queue(
    tx: Prisma.TransactionClient,
    eventKey: string,
    chatId: string,
    text: string,
    userId?: string,
    category?: Category,
    keyboard?: InlineKeyboardMarkup,
    procurementOnly = false,
  ) {
    await tx.telegramDelivery.createMany({
      data: [
        {
          eventKey,
          recipientKey: userId ?? chatId,
          chatId,
          userId,
          category,
          procurementOnly,
          text: text.slice(0, 4000),
          keyboard: keyboard
            ? (keyboard as unknown as Prisma.InputJsonValue)
            : undefined,
        },
      ],
      skipDuplicates: true,
    });
  }

  async publish(tx: Prisma.TransactionClient, event: TelegramEvent) {
    const users = await tx.user.findMany({
      where: {
        id: { in: event.recipientIds },
        status: 'ACTIVE',
        role: { in: ['ADMIN', 'PROCUREMENT'] },
        telegramChatId: { not: null },
        telegramMuted: false,
      },
    });
    for (const user of users) {
      const subscription = await tx.telegramSubscription.findUnique({
        where: {
          userId_category: { userId: user.id, category: event.category },
        },
      });
      if (subscription?.enabled === false) continue;
      const url = webUrl(event.path);
      await this.queue(
        tx,
        event.id,
        user.telegramChatId!,
        event.text,
        user.id,
        event.category,
        url
          ? { inline_keyboard: [[{ text: 'Открыть в Supply Manager', url }]] }
          : undefined,
      );
    }
  }

  async requestCreated(
    tx: Prisma.TransactionClient,
    request: { id: string; number: number; status: string },
  ) {
    // No assignment model exists yet. Explicit routing, never broadcast to every role member.
    const usernames = (process.env.TELEGRAM_REQUEST_RECIPIENT_USERNAMES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const users = await tx.user.findMany({
      where: {
        username: { in: usernames },
        status: 'ACTIVE',
        role: { in: ['ADMIN', 'PROCUREMENT'] },
      },
      select: { id: true },
    });
    await this.publish(tx, {
      id: `request:${request.id}:created`,
      category: 'NEW_REQUEST',
      recipientIds: users.map((u) => u.id),
      text: `Новая заявка №${request.number}\nСтатус: ${request.status}`,
      path: '/requests',
    });
  }

  async taskChanged(tx: Prisma.TransactionClient, taskId: string) {
    const usernames = (process.env.TELEGRAM_PURCHASE_RECIPIENT_USERNAMES ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!usernames.length) return;
    const task = await tx.task.findUniqueOrThrow({ where: { id: taskId } });
    const recipients = await tx.user.findMany({
      where: {
        username: { in: usernames },
        status: 'ACTIVE',
        role: { in: ['ADMIN', 'PROCUREMENT'] },
      },
      select: { id: true },
    });
    await this.publish(tx, {
      id: `task:${taskId}:${randomUUID()}`,
      category: 'PURCHASE_CHANGED',
      recipientIds: recipients.map((u) => u.id),
      text: `Изменена закупка №${task.number}\nСтатус: ${task.status}\nСледующее действие: ${task.nextAction ?? 'не указано'}`,
      path: `/tasks/${taskId}`,
    });
  }

  async drain() {
    if (Date.now() > this.cleanupAt) {
      await this.prisma.telegramRate.deleteMany({
        where: { window: { lt: new Date(Date.now() - 86_400_000) } },
      });
      await this.prisma.telegramLink.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      await this.prisma.telegramButton.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } },
      });
      this.cleanupAt = Date.now() + 3_600_000;
    }
    // Expired leases are uncertain sends: do not blindly resend and produce duplicates.
    await this.prisma.telegramDelivery.updateMany({
      where: { status: 'SENDING', leaseUntil: { lt: new Date() } },
      data: { status: 'UNKNOWN', errorCode: 'LEASE_EXPIRED' },
    });
    const rows = await this.prisma.telegramDelivery.findMany({
      where: { status: 'PENDING', availableAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    for (const row of rows) {
      if (this.stopping) break;
      const claimed = await this.prisma.telegramDelivery.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: {
          status: 'SENDING',
          attempts: { increment: 1 },
          leaseUntil: new Date(Date.now() + 60_000),
        },
      });
      if (!claimed.count) continue;
      await this.deliver(row);
    }
  }

  private async deliver(row: TelegramDelivery) {
    if (row.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: row.userId },
      });
      const subscription = row.category
        ? await this.prisma.telegramSubscription.findUnique({
            where: {
              userId_category: { userId: row.userId, category: row.category },
            },
          })
        : null;
      if (
        !user ||
        user.status !== 'ACTIVE' ||
        user.telegramMuted ||
        user.telegramChatId !== row.chatId ||
        (row.procurementOnly && user.role === 'EMPLOYEE') ||
        (row.category &&
          (!allowedCategories(user.role).includes(row.category as Category) ||
            subscription?.enabled === false))
      ) {
        await this.prisma.telegramDelivery.update({
          where: { id: row.id },
          data: { status: 'CANCELLED' },
        });
        return;
      }
    }
    // CORE-09: cancel stale/out-of-scope action notices immediately before sending.
    // A queued outbox record does not grant permanent access after reassignment.
    if (row.eventKey.startsWith('core09:')) {
      const parts = row.eventKey.split(':');
      const version = Number(parts[2]);
      const action = parts.length === 4 && Number.isSafeInteger(version)
        ? await this.prisma.nextAction.findUnique({
            where: { id: parts[1] },
            include: { task: { select: { status: true } } },
          }) : null;
      const valid = action &&
        action.assigneeId === row.userId &&
        action.version === version &&
        (action.status === 'ACTIVE' || (parts[3] === 'COMPLETED' && action.status === 'COMPLETED')) &&
        !['CLOSED','CANCELLED'].includes(action.task.status);
      if (!valid) {
        await this.prisma.telegramDelivery.update({
          where: { id: row.id }, data: { status: 'CANCELLED' },
        });
        return;
      }
    }
    try {
      const sent = await this.telegram.send(
        row.chatId,
        row.text,
        (row.keyboard ?? undefined) as unknown as
          InlineKeyboardMarkup | undefined,
      );
      await this.prisma.telegramDelivery.update({
        where: { id: row.id },
        data: { status: 'SENT', messageId: sent.message_id, errorCode: null },
      });
    } catch (error) {
      const failure =
        error instanceof TelegramFailure
          ? error
          : new TelegramFailure('NETWORK');
      const attempts = row.attempts + 1;
      const transient = failure.code === '429' || /^5\d\d$/.test(failure.code);
      // A network timeout may happen after Telegram accepted the message: mark UNKNOWN.
      const status =
        failure.code === 'NETWORK'
          ? 'UNKNOWN'
          : transient && attempts < 5
            ? 'PENDING'
            : 'FAILED';
      await this.prisma.telegramDelivery.update({
        where: { id: row.id },
        data: {
          status,
          errorCode: failure.code,
          availableAt: new Date(
            Date.now() +
              Math.max(failure.retryAfter * 1000, 1000 * 2 ** attempts) +
              Math.floor(Math.random() * 500),
          ),
        },
      });
      if (failure.code === '403' && row.userId)
        await this.prisma.user.updateMany({
          where: { id: row.userId, telegramChatId: row.chatId },
          data: { telegramMuted: true },
        });
      this.logger.warn(`Telegram delivery ${row.id}: ${failure.code}`);
    }
  }
}
