import { Injectable, Logger } from '@nestjs/common';

export type TelegramCallbackQuery = {
  id: string;
  from: {
    id: number;
  };
  data?: string;
  message?: {
    message_id: number;
    text?: string;
    chat: {
      id: number;
    };
  };
};

export type TelegramUpdate = {
  update_id: number;
  callback_query?: TelegramCallbackQuery;
};

type PurchaseRequestNotification = {
  id: string;
  number: number;
  requesterName: string | null;
  items: Array<{
    name: string;
    quantity: unknown;
    unit: string;
    notes: string | null;
  }>;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  isConfigured(): boolean {
    return Boolean(
      process.env.TELEGRAM_BOT_TOKEN &&
        process.env.TELEGRAM_CHAT_ID,
    );
  }

  async sendNewPurchaseRequest(
    request: PurchaseRequestNotification,
  ): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!this.isConfigured() || !chatId) {
      this.logger.warn(
        'Telegram notification skipped: Telegram is not configured',
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

    const text = this.truncateMessage(
      `📦 Новая заявка №${request.number}\n\n` +
        `👤 Заявитель: ${requesterName}\n\n` +
        `📋 Позиций: ${request.items.length}\n\n` +
        positions,
    );

    const inlineKeyboard: Array<
      Array<Record<string, string>>
    > = [
      [
        {
          text: '✅ Принять в работу',
          callback_data: `accept_request:${request.id}`,
        },
      ],
    ];

    const requestUrl = this.getRequestUrl();

    if (requestUrl) {
      inlineKeyboard.unshift([
        {
          text: '📋 Открыть заявку',
          url: requestUrl,
        },
      ]);
    }

    await this.request('sendMessage', {
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: inlineKeyboard,
      },
    });
  }

  async getUpdates(
    offset: number,
  ): Promise<TelegramUpdate[]> {
    return this.request<TelegramUpdate[]>('getUpdates', {
      offset,
      timeout: 20,
      allowed_updates: ['callback_query'],
    });
  }

  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert = false,
  ): Promise<void> {
    await this.request('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
    });
  }

  async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
  ): Promise<void> {
    await this.request('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: {
        inline_keyboard: [],
      },
    });
  }

  private async request<T = unknown>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const token = process.env.TELEGRAM_BOT_TOKEN;

    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN не настроен');
    }

    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const data =
      (await response.json().catch(() => null)) as
        | TelegramApiResponse<T>
        | null;

    if (!response.ok || !data?.ok) {
      throw new Error(
        data?.description ||
          `Telegram API returned HTTP ${response.status}`,
      );
    }

    return data.result as T;
  }

  private getRequestUrl(): string | null {
    const origin =
      process.env.FRONTEND_ORIGIN?.replace(/\/$/, '');

    if (!origin) {
      return null;
    }

    try {
      const url = new URL(origin);

      if (
        url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '::1'
      ) {
        return null;
      }

      return `${origin}/requests`;
    } catch {
      return null;
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
