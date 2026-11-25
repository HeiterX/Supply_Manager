
import {
  Body,
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
import { UpdateUserRoleDto } from './dto/update-user-role.dto.js';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AdminUsersController {
  constructor(
    private readonly adminUsersService: AdminUsersService,
  ) {}

  @Get()
  findAll() {
    return this.adminUsersService.findAll();
  }

  @Patch(':id/activate')
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.adminUsersService.activate(
      id,
      request.authUser.id,
    );
  }

  @Patch(':id/block')
  block(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.adminUsersService.block(
      id,
      request.authUser.id,
    );
  }

  @Patch(':id/role')
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.adminUsersService.changeRole(
      id,
      request.authUser.id,
      dto.role,
    );
  }
}
