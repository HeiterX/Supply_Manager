import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  HttpException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

export const categories = [
  'NEW_REQUEST',
  'ASSIGNED_ACTION',
  'PURCHASE_CHANGED',
  'DUE_SOON',
  'OVERDUE',
] as const;
export type Category = (typeof categories)[number];
export function allowedCategories(role: string): readonly Category[] {
  return role === 'EMPLOYEE' ? [] : categories;
}
export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

@Injectable()
export class TelegramLinkService {
  constructor(private readonly prisma: PrismaService) {}
  async active(tx: Prisma.TransactionClient, id: string) {
    // UPDATE obtains a row lock, serializing token rotation, confirmation and unlink.
    const user = await tx.user.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
    if (user.status !== 'ACTIVE')
      throw new ForbiddenException('Учётная запись недоступна');
    return user;
  }
  async status(id: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id } });
    if (user.status !== 'ACTIVE') throw new ForbiddenException();
    const [pending, subscriptions, deliveries] = await Promise.all([
      this.prisma.telegramLink.findFirst({
        where: { userId: id, expiresAt: { gt: new Date() } },
      }),
      this.prisma.telegramSubscription.findMany({ where: { userId: id } }),
      this.prisma.telegramDelivery.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          status: true,
          errorCode: true,
          attempts: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      configured: Boolean(
        process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME,
      ),
      connected: Boolean(user.telegramChatId),
      chatId: user.telegramChatId,
      username: user.telegramUsername,
      muted: user.telegramMuted,
      pending: pending
        ? {
            id: pending.id,
            expiresAt: pending.expiresAt,
            chatId: pending.chatId,
            username: pending.username,
          }
        : null,
      subscriptions: allowedCategories(user.role).map((category) => ({
        category,
        enabled:
          subscriptions.find((s) => s.category === category)?.enabled ?? true,
      })),
      deliveries,
    };
  }
  async begin(id: string) {
    const name = process.env.TELEGRAM_BOT_USERNAME;
    if (
      !process.env.TELEGRAM_BOT_TOKEN ||
      !name ||
      !/^[A-Za-z0-9_]{5,32}$/.test(name)
    )
      throw new ServiceUnavailableException('Telegram не настроен');
    return this.prisma.$transaction(async (tx) => {
      const user = await this.active(tx, id);
      if (user.telegramChatId)
        throw new ConflictException('Сначала отключите Telegram');
      const window = new Date(Math.floor(Date.now() / 60_000) * 60_000);
      const rate = await tx.telegramRate.upsert({
        where: { chatId: `link:${id}:${window.getTime()}` },
        create: { chatId: `link:${id}:${window.getTime()}`, window, count: 1 },
        update: { count: { increment: 1 } },
      });
      if (rate.count > 10)
        throw new HttpException(
          'Слишком много попыток. Подождите минуту.',
          429,
        );
      await tx.telegramLink.deleteMany({ where: { userId: id } });
      const token = randomBytes(32).toString('base64url');
      const link = await tx.telegramLink.create({
        data: {
          userId: id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 300_000),
        },
      });
      return {
        url: `https://t.me/${name}?start=${token}`,
        expiresAt: link.expiresAt,
      };
    });
  }
  async claim(
    tx: Prisma.TransactionClient,
    token: string,
    chatId: string,
    username?: string,
  ) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const link = await tx.telegramLink.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!link) return false;
    const user = await tx.user.update({
      where: { id: link.userId },
      data: { updatedAt: new Date() },
    });
    if (
      user.status !== 'ACTIVE' ||
      user.telegramChatId ||
      (await tx.user.findUnique({ where: { telegramChatId: chatId } }))
    )
      return false;
    const result = await tx.telegramLink.updateMany({
      where: { id: link.id, claimedAt: null, expiresAt: { gt: new Date() } },
      data: { claimedAt: new Date(), chatId, username: username?.slice(0, 64) },
    });
    return result.count === 1;
  }
  async confirm(id: string, linkId: string) {
    try {
      await this.prisma.$transaction(async (tx) => {
        const user = await this.active(tx, id);
        if (user.telegramChatId)
          throw new ConflictException('Telegram уже подключён');
        const link = await tx.telegramLink.findFirst({
          where: {
            id: linkId,
            userId: id,
            claimedAt: { not: null },
            expiresAt: { gt: new Date() },
          },
        });
        if (!link?.chatId)
          throw new BadRequestException('Подтверждение истекло или недоступно');
        await tx.user.update({
          where: { id },
          data: {
            telegramChatId: link.chatId,
            telegramUsername: link.username,
            telegramMuted: false,
          },
        });
        await tx.telegramLink.deleteMany({ where: { userId: id } });
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002')
        throw new ConflictException('Этот Telegram уже подключён');
      throw error;
    }
    return this.status(id);
  }
  async unlink(id: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.active(tx, id);
      await tx.user.update({
        where: { id },
        data: {
          telegramChatId: null,
          telegramUsername: null,
          telegramMuted: false,
        },
      });
      await tx.telegramLink.deleteMany({ where: { userId: id } });
      await tx.telegramButton.deleteMany({ where: { userId: id } });
      await tx.telegramDelivery.updateMany({
        where: { userId: id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
    });
    return this.status(id);
  }
  async subscribe(id: string, category: Category, enabled: boolean) {
    await this.prisma.$transaction(async (tx) => {
      const user = await this.active(tx, id);
      if (!allowedCategories(user.role).includes(category))
        throw new ForbiddenException();
      await tx.telegramSubscription.upsert({
        where: { userId_category: { userId: id, category } },
        create: { userId: id, category, enabled },
        update: { enabled },
      });
    });
    return this.status(id);
  }
}
