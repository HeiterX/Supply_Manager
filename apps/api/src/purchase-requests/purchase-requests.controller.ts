import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpStatus,
  Param,
  Patch,
  ParseFilePipeBuilder,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import {
  CreatePublicPurchaseRequestDto,
  CreatePurchaseRequestDto,
} from './dto/create-purchase-request.dto.js';
import { PurchaseRequestsService } from './purchase-requests.service.js';
import { PublicRequestRateLimitGuard } from './public-request-rate-limit.guard.js';

@Controller('purchase-requests')
export class PurchaseRequestsController {
  constructor(
    private readonly purchaseRequestsService: PurchaseRequestsService,
  ) {}

  /*
   * Простая публичная форма.
   * Регистрация и авторизация работнику не нужны.
   */
  @Post('public')
  @Header('Cache-Control', 'no-store')
  @UseGuards(PublicRequestRateLimitGuard)
  createPublic(@Body() dto: CreatePublicPurchaseRequestDto) {
    return this.purchaseRequestsService.createPublic(dto);
  }

  /*
   * Загрузка фотографии конкретной позиции.
   */
  @Post('public/:requestId/items/:itemId/photo')
  @UseGuards(PublicRequestRateLimitGuard)
  @UseInterceptors(
    FileInterceptor('photo', {
      limits: {
        fileSize: 8 * 1024 * 1024,
        files: 1,
      },
    }),
  )
  uploadPublicItemPhoto(
    @Param('requestId') requestId: string,
    @Param('itemId') itemId: string,
    @Headers('x-upload-token') uploadToken: string | undefined,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType: /^image\/(jpeg|png|webp)$/,
        })
        .addMaxSizeValidator({
          maxSize: 8 * 1024 * 1024,
        })
        .build({
          errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        }),
    )
    photo: Express.Multer.File,
  ) {
    return this.purchaseRequestsService.attachPublicItemPhoto(
      requestId,
      itemId,
      photo,
      uploadToken,
    );
  }

  /*
   * Получение фотографии позиции.
   */
  @Get('public/items/:itemId/photo')
  @UseGuards(JwtAuthGuard)
  async getPublicItemPhoto(
    @CurrentUser() user: AuthUser,
    @Param('itemId') itemId: string,
    @Res() response: Response,
  ) {
    const photo =
      await this.purchaseRequestsService.getPublicItemPhoto(user, itemId);

    return response.sendFile(photo.absolutePath, {
      headers: {
        'Content-Type': photo.mimeType,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  /*
   * Старый авторизованный API оставляем.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePurchaseRequestDto,
  ) {
    return this.purchaseRequestsService.create(user, dto);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  findMine(@CurrentUser() user: AuthUser) {
    return this.purchaseRequestsService.findMine(user);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROCUREMENT', 'ADMIN')
  findAll() {
    return this.purchaseRequestsService.findAll();
  }

  @Patch(':id/accept')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PROCUREMENT', 'ADMIN')
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.purchaseRequestsService.accept(user, id);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.purchaseRequestsService.findOne(user, id);
  }
}
