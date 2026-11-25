import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Header,
  Param,
  Patch,
  Post,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { IsBoolean, IsIn } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import {
  categories,
  type Category,
  TelegramLinkService,
} from './telegram-link.service.js';

class SubscriptionDto {
  @IsIn(categories) category!: Category;
  @IsBoolean() enabled!: boolean;
}

@Controller('telegram')
@UseGuards(JwtAuthGuard)
export class TelegramSettingsController {
  constructor(private readonly links: TelegramLinkService) {}
  private origin(origin?: string) {
    const allowed = (process.env.FRONTEND_ORIGIN ?? 'http://localhost:3001')
      .split(',')
      .map((s) => s.trim());
    if (!origin || !allowed.includes(origin))
      throw new ForbiddenException('Недопустимый источник запроса');
  }
  @Get('settings')
  @Header('Cache-Control', 'no-store')
  status(@CurrentUser() user: AuthUser) {
    return this.links.status(user.id);
  }
  @Post('link')
  @Header('Cache-Control', 'no-store')
  begin(
    @CurrentUser() user: AuthUser,
    @Headers('origin') origin?: string,
  ) {
    this.origin(origin);
    return this.links.begin(user.id);
  }
  @Post('link/:id/confirm') confirm(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('origin') origin?: string,
  ) {
    this.origin(origin);
    return this.links.confirm(user.id, id);
  }
  @Delete('link') unlink(
    @CurrentUser() user: AuthUser,
    @Headers('origin') origin?: string,
  ) {
    this.origin(origin);
    return this.links.unlink(user.id);
  }
  @Patch('subscriptions') subscribe(
    @CurrentUser() user: AuthUser,
    @Body() dto: SubscriptionDto,
    @Headers('origin') origin?: string,
  ) {
    this.origin(origin);
    return this.links.subscribe(user.id, dto.category, dto.enabled);
  }
}
