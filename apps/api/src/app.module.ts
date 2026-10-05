import { Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PurchaseRequestsModule } from './purchase-requests/purchase-requests.module.js';
import { TasksModule } from './tasks/tasks.module.js';

@Module({
  imports: [PrismaModule, AuthModule, PurchaseRequestsModule, TasksModule],
})
export class AppModule {}
