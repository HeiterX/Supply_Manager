import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CatalogService } from './catalog.service.js';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto.js';

@Controller('catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROCUREMENT', 'ADMIN')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  list(@Query('q') query?: string) {
    return this.catalog.list(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.catalog.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCatalogItemDto) {
    return this.catalog.create(dto);
  }
}
