import { Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { NextActionsService } from './next-actions.service.js';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROCUREMENT', 'ADMIN')
export class NotificationsController {
  constructor(private readonly actions: NextActionsService) {}
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('filter') filter?: string,
    @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.actions.notifications(user, filter ?? 'all', Number(page ?? '1'), Number(limit ?? '20'));
  }
  @Patch(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.actions.readNotification(user, id);
  }
}
