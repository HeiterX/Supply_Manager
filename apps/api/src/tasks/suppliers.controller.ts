import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { SaveSupplierDto } from './dto/save-supplier.dto.js';
import { SuppliersService } from './suppliers.service.js';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROCUREMENT', 'ADMIN')
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}

  @Get()
  list(@Query('q') query?: string) {
    return this.service.list(query);
  }

  @Get('responsibles')
  responsibles() {
    return this.service.responsibles();
  }

  @Get(':id')
  one(@Param('id') id: string) {
    return this.service.one(id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: SaveSupplierDto) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: SaveSupplierDto) {
    return this.service.update(id, dto, user.id);
  }
}
