
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';

import type { AuthenticatedRequest } from '../auth/auth.types.js';

import { AdminUsersService } from './admin-users.service.js';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
  ) {}

  // GET /api/v1/admin/users
  @Get()
  findAll() {
    return this.adminUsersService.findAll();
  }

  // PATCH /api/v1/admin/users/:id/activate
  @Patch(':id/activate')
  activate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.adminUsersService.activate(
      id,
      request.authUser.id,
    );
  }

  // PATCH /api/v1/admin/users/:id/block
  @Patch(':id/block')
  block(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.adminUsersService.block(
      id,
      request.authUser.id,
    );
  }
}
