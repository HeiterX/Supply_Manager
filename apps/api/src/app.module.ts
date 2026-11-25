
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { CsrfGuard } from './security/csrf.guard.js';

import { AdminUsersModule } from './admin-users/admin-users.module.js';
import { AuthModule } from './auth/auth.module.js';
import { DiscoveryModule } from './discovery/discovery.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { PurchaseRequestsModule } from './purchase-requests/purchase-requests.module.js';
import { TasksModule } from './tasks/tasks.module.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AdminUsersModule,
    PurchaseRequestsModule,
    TasksModule,
    DiscoveryModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: CsrfGuard,
    },
  ],
})
export class AppModule {}
