import { Injectable, Logger } from '@nestjs/common';

type PurchaseRequestNotification = {
  number: number;
  requesterName: string | null;
  items: Array<{
    name: string;
    quantity: unknown;
    unit: string;
    notes: string | null;
  }>;
};

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  async sendNewPurchaseRequest(
    request: PurchaseRequestNotification,
  ): Promise<void> {
    /*
     * Во время автоматических тестов реальные сообщения
     * в Telegram не отправляем.
     */
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      this.logger.warn(
        'Telegram notification skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured',
      );
      return;
    }

    const requesterName =
      request.requesterName?.trim() || 'Не указан';

    const positions = request.items
      .map((item, index) => {
        const description = item.notes?.trim()
          ? `\n   ${item.notes.trim()}`
          : '';

        return (
          `${index + 1}. ${item.name}\n` +
          `   ${String(item.quantity)} ${item.unit}` +
          description
        );
      })
      .join('\n\n');

    const frontendOrigin =
      process.env.FRONTEND_ORIGIN?.replace(/\/$/, '');

    const requestLink = frontendOrigin
      ? `\n\nОткрыть входящие заявки:\n${frontendOrigin}/requests`
      : '';

    const message = this.truncateMessage(
      `📦 Новая заявка №${request.number}\n\n` +
        `👤 Заявитель: ${requesterName}\n\n` +
        `📋 Позиций: ${request.items.length}\n\n` +
        `${positions}` +
        requestLink,
    );

    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          disable_web_page_preview: true,
        }),
      },
    );

    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      description?: string;
    } | null;

    if (!response.ok || !data?.ok) {
      throw new Error(
        data?.description ||
          `Telegram API returned HTTP ${response.status}`,
      );
    }
  }

  private truncateMessage(message: string): string {
    const maxLength = 4000;

    if (message.length <= maxLength) {
      return message;
    }

    return (
      message.slice(0, maxLength - 80) +
      '\n\n…Сообщение сокращено. Откройте заявку в Supply Manager.'
    );
  }
}
