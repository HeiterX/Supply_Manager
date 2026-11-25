import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Module,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AnalyticsService } from './analytics.service.js';
import {
  isEntity,
  ListQuery,
  ReportQuery,
  SearchQuery,
} from './discovery.dto.js';
import { DiscoveryService } from './discovery.service.js';
import { ExportService } from './export-file.js';

@Controller('discovery')
@UseGuards(JwtAuthGuard, RolesGuard)
class DiscoveryController {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly analytics: AnalyticsService,
    private readonly exports: ExportService,
  ) {}

  @Get('search')
  @Header('Cache-Control', 'private, no-store')
  search(@CurrentUser() user: AuthUser, @Query() query: SearchQuery) {
    return this.discovery.search(user, query);
  }

  @Get('lists/:entity')
  @Header('Cache-Control', 'private, no-store')
  list(
    @CurrentUser() user: AuthUser,
    @Param('entity') entity: string,
    @Query() query: ListQuery,
  ) {
    if (!isEntity(entity))
      throw new BadRequestException('Неизвестный тип выборки');
    return this.discovery.list(user, entity, query);
  }

  @Get('lists/:entity/export')
  @Header('Cache-Control', 'private, no-store')
  async exportList(
    @CurrentUser() user: AuthUser,
    @Param('entity') entity: string,
    @Query() query: ListQuery,
  ) {
    if (!isEntity(entity))
      throw new BadRequestException('Неизвестный тип выборки');
    if (!query.format) throw new BadRequestException('Укажите формат выгрузки');
    return this.exports.create(entity, query.format, () =>
      this.discovery.export(user, entity, query),
    );
  }

  @Get('analytics')
  @Roles('PROCUREMENT', 'ADMIN')
  @Header('Cache-Control', 'private, no-store')
  report(@Query() query: ReportQuery) {
    return this.analytics.report(query);
  }

  @Get('analytics/export')
  @Roles('PROCUREMENT', 'ADMIN')
  @Header('Cache-Control', 'private, no-store')
  async exportReport(@Query() query: ReportQuery) {
    if (!query.format) throw new BadRequestException('Укажите формат выгрузки');
    return this.exports.create('analytics', query.format, () =>
      this.analytics.export(query),
    );
  }

  @Get('task-overview')
  @Roles('PROCUREMENT', 'ADMIN')
  @Header('Cache-Control', 'private, no-store')
  overview() {
    return this.discovery.overview();
  }

  @Get('suppliers/:id')
  @Roles('PROCUREMENT', 'ADMIN')
  @Header('Cache-Control', 'private, no-store')
  supplier(@Param('id') id: string) {
    return this.discovery.supplier(id);
  }
}

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, AnalyticsService, ExportService],
})
export class DiscoveryModule {}
