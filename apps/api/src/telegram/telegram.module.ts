import { Module } from '@nestjs/common';

import { TelegramService } from './telegram.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TelegramLinkService } from './telegram-link.service.js';
import { TelegramDeliveryService } from './telegram-delivery.service.js';
import { TelegramSettingsController } from './telegram-settings.controller.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TelegramSettingsController],
  providers: [TelegramService, TelegramLinkService, TelegramDeliveryService],
  exports: [TelegramService, TelegramLinkService, TelegramDeliveryService],
})
export class TelegramModule {}
