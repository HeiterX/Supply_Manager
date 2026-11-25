import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import {
  TelegramUpdatesService,
  verifyWebhookSecret,
} from './telegram-updates.service.js';

@Controller('telegram')
export class TelegramWebhookController {
  constructor(private readonly updates: TelegramUpdatesService) {}
  @Post('webhook')
  @HttpCode(200)
  handle(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: unknown,
  ) {
    verifyWebhookSecret(secret);
    return this.updates.handle(update);
  }
}
