import { Injectable } from '@nestjs/common';
import { Api, GrammyError } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';

export class TelegramFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryAfter = 0,
  ) {
    super(`Telegram delivery failed: ${code}`);
  }
}

@Injectable()
export class TelegramService {
  private api?: Api;
  isConfigured() {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN);
  }
  async send(chatId: string, text: string, keyboard?: InlineKeyboardMarkup) {
    if (!this.isConfigured()) throw new TelegramFailure('DISABLED');
    this.api ??= new Api(process.env.TELEGRAM_BOT_TOKEN!, {
      timeoutSeconds: 15,
    });
    try {
      return await this.api.sendMessage(chatId, text.slice(0, 4000), {
        reply_markup: keyboard,
        protect_content: true,
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      // Library errors may contain token URLs and request bodies. Never propagate them.
      if (error instanceof GrammyError)
        throw new TelegramFailure(
          String(error.error_code),
          error.parameters.retry_after ?? 0,
        );
      throw new TelegramFailure('NETWORK');
    }
  }
  async answer(callbackId: string) {
    if (!this.isConfigured()) return;
    this.api ??= new Api(process.env.TELEGRAM_BOT_TOKEN!, {
      timeoutSeconds: 15,
    });
    await this.api.answerCallbackQuery(callbackId).catch(() => undefined);
  }
}
