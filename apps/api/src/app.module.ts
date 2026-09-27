import { Module } from '@nestjs/common';

import { PrismaModule } from './prisma/prisma.module.js';
import { TasksModule } from './tasks/tasks.module.js';

@Module({
  imports: [PrismaModule, TasksModule],
})
export class AppModule {}