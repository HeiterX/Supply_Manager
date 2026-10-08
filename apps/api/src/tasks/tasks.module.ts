import { Module } from '@nestjs/common';

import { PrismaModule } from '../prisma/prisma.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { MultiOrdersService } from './multi-orders.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [TasksController],
  providers: [TasksService, MultiOrdersService],
})
export class TasksModule {}