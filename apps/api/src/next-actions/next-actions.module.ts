import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { NextActionsService } from './next-actions.service.js';
import { NextActionsController } from './next-actions.controller.js';
import { NotificationsController } from './notifications.controller.js';

@Module({
  imports: [PrismaModule, AuthModule, TelegramModule],
  providers: [NextActionsService],
  controllers: [NextActionsController, NotificationsController],
  exports: [NextActionsService],
})
export class NextActionsModule {}
