import { Body, Controller, Get, Headers, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { ActionInputDto } from './action-input.dto.js';
import { NextActionsService } from './next-actions.service.js';

@Controller('next-actions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROCUREMENT', 'ADMIN')
export class NextActionsController {
  constructor(private readonly actions: NextActionsService) {}
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('scope') scope?: string,
    @Query('filter') filter?: string, @Query('q') q?: string,
    @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.actions.list(user, scope ?? 'mine', filter ?? 'all', q ?? '', Number(page ?? '1'), Number(limit ?? '20'));
  }
  @Get('by-task/:taskId')
  byTask(@CurrentUser() user: AuthUser, @Param('taskId') taskId: string) {
    return this.actions.byTask(user, taskId);
  }
  @Post('by-task/:taskId')
  create(@CurrentUser() user: AuthUser, @Param('taskId') taskId: string, @Body() dto: ActionInputDto) {
    return this.actions.create(user, taskId, dto);
  }
  @Get(':id/history')
  history(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.actions.history(user, id);
  }
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: ActionInputDto,
    @Headers('if-match') version?: string, @Headers('idempotency-key') key?: string) {
    return this.actions.change(user, id, dto, version, key);
  }
  @Post(':id/complete')
  complete(@CurrentUser() user: AuthUser, @Param('id') id: string,
    @Headers('if-match') version?: string, @Headers('idempotency-key') key?: string) {
    return this.actions.change(user, id, {}, version, key, true);
  }
}
