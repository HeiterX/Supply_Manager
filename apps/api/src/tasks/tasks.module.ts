import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';
import { MultiOrdersService } from './multi-orders.service.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
import { SuppliersService } from './suppliers.service.js';
import { SuppliersController } from './suppliers.controller.js';
import { OfferDocumentsService } from './offer-documents.service.js';

import { FulfillmentController } from './fulfillment.controller.js';
import { FulfillmentService } from './fulfillment.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TasksController, CatalogController, SuppliersController, FulfillmentController],
  providers: [TasksService, MultiOrdersService, CatalogService, SuppliersService, OfferDocumentsService, FulfillmentService],
})
export class TasksModule {}