import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { PurchaseRequestsController } from './purchase-requests.controller.js';
import { PurchaseRequestsService } from './purchase-requests.service.js';
import { PublicRequestRateLimitGuard } from './public-request-rate-limit.guard.js';
import { TelegramUpdatesService } from './telegram-updates.service.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    TelegramModule,
  ],
  controllers: [PurchaseRequestsController],
  providers: [
    PurchaseRequestsService,
    PublicRequestRateLimitGuard,
    TelegramUpdatesService,
  ],
  exports: [PurchaseRequestsService],
})
export class PurchaseRequestsModule {}
