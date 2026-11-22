import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { MultiOrdersService } from './multi-orders.service.js';
import { TelegramModule } from '../telegram/telegram.module.js';

@Module({
  imports: [PrismaModule, AuthModule, TelegramModule],
  controllers: [TasksController],
  providers: [TasksService, MultiOrdersService],
  exports: [TasksService],
})
export class TasksModule {}
