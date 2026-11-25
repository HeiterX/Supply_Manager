import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { FulfillmentDto } from './dto/fulfillment.dto.js';
import { FulfillmentService } from './fulfillment.service.js';

@Controller('tasks/:taskId')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'PROCUREMENT')
export class FulfillmentController {
  constructor(private readonly fulfillment: FulfillmentService) {}

  @Get('fulfillment')
  view(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fulfillment.view(taskId, user);
  }

  @Post('orders/:orderId/fulfillment')
  execute(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: FulfillmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fulfillment.execute(taskId, orderId, dto, user);
  }
}
