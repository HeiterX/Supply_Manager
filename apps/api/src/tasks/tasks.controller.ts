import {
  Body,
  Controller,
  Delete,
  Get,
  Res,
  UploadedFile,
  UseInterceptors,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthUser } from '../auth/auth.types.js';

import { HandOverPurchaseOrderDto } from './dto/hand-over-purchase-order.dto.js';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto.js';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto.js';
import { CreateSupplierOfferDto } from './dto/create-supplier-offer.dto.js';
import { CreateTaskActivityDto } from './dto/create-task-activity.dto.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { CreateTaskItemDto } from './dto/create-task-item.dto.js';
import { ShipPurchaseOrderDto } from './dto/ship-purchase-order.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { UpdateTaskItemDto } from './dto/update-task-item.dto.js';
import { TasksService } from './tasks.service.js';
import { MultiOrdersService } from './multi-orders.service.js';
import { OfferDocumentsService } from './offer-documents.service.js';
import { DecideSupplierOfferDto } from './dto/decide-supplier-offer.dto.js';

@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('PROCUREMENT', 'ADMIN')
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly multiOrders: MultiOrdersService,
    private readonly offerDocs: OfferDocumentsService,
  ) {}

  @Post()
  create(@Body() dto: CreateTaskDto) {
    return this.tasksService.create(dto);
  }

  @Get()
  findAll() {
    return this.tasksService.findAll();
  }

  @Get('items/registry')
  findItemRegistry() {
    return this.tasksService.findItemRegistry();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Get(':id/allocation')
  getAllocation(@Param('id') id: string) {
    return this.multiOrders.allocation(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.tasksService.update(id, dto);
  }

  @Get(':taskId/items')
  findTaskItems(@Param('taskId') taskId: string) {
    return this.tasksService.findTaskItems(taskId);
  }

  @Post(':taskId/items')
  addTaskItem(
    @CurrentUser() user: AuthUser,
    @Param('taskId') taskId: string,
    @Body() dto: CreateTaskItemDto,
  ) {
    return this.tasksService.addTaskItem(taskId, dto, user.id);
  }

  @Patch(':taskId/items/:itemId')
  updateTaskItem(
    @CurrentUser() user: AuthUser,
    @Param('taskId') taskId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateTaskItemDto,
  ) {
    return this.tasksService.updateTaskItem(taskId, itemId, dto, user.id);
  }

  @Get(':taskId/items/:itemId/history')
  findTaskItemHistory(
    @Param('taskId') taskId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.tasksService.findTaskItemHistory(taskId, itemId);
  }

  @Delete(':taskId/items/:itemId')
  deleteTaskItem(
    @CurrentUser() user: AuthUser,
    @Param('taskId') taskId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.tasksService.deleteTaskItem(taskId, itemId, user.id);
  }

  @Post(':id/activities')
  addActivity(
    @Param('id') id: string,
    @Body() dto: CreateTaskActivityDto,
  ) {
    return this.tasksService.addActivity(id, dto);
  }

  @Post(':id/supplier-offers')
  addSupplierOffer(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateSupplierOfferDto,
  ) {
    return this.tasksService.addSupplierOffer(id, dto, user.id);
  }

  @Patch(':taskId/supplier-offers/:offerId')
  updateSupplierOffer(
    @CurrentUser() user: AuthUser,
    @Param('taskId') taskId: string,
    @Param('offerId') offerId: string,
    @Body() dto: CreateSupplierOfferDto,
  ) {
    return this.multiOrders.updateOffer(taskId, offerId, dto, user.id);
  }

  @Patch(':taskId/supplier-offers/:offerId/decision')
  decideSupplierOffer(
    @CurrentUser() user: AuthUser,
    @Param('taskId') taskId: string,
    @Param('offerId') offerId: string,
    @Body() dto: DecideSupplierOfferDto,
  ) {
    return this.multiOrders.selectOffer(taskId, offerId, dto.reason, user.id);
  }

  @Post(':taskId/supplier-offers/:offerId/documents')
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
  }))
  uploadOfferDocument(
    @CurrentUser() user: AuthUser,
    @Param('taskId') taskId: string,
    @Param('offerId') offerId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.offerDocs.upload(taskId, offerId, user.id, file);
  }

  @Get(':taskId/supplier-offers/:offerId/documents/:documentId')
  async downloadOfferDocument(
    @Param('taskId') taskId: string,
    @Param('offerId') offerId: string,
    @Param('documentId') documentId: string,
    @Res() response: Response,
  ) {
    const document = await this.offerDocs.download(taskId, offerId, documentId);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', 'sandbox');
    response.type(document.mimeType);
    return response.download(document.path, document.originalName);
  }

  @Patch(':taskId/supplier-offers/:offerId/select')
  selectSupplierOffer(
    @Param('taskId') taskId: string,
    @Param('offerId') offerId: string,
  ) {
    return this.tasksService.selectSupplierOffer(taskId, offerId);
  }

  @Post(
    ':taskId/supplier-offers/:offerId/purchase-order',
  )
  createPurchaseOrderForOffer(
    @CurrentUser() user: AuthUser,
    @Param('taskId') taskId: string,
    @Param('offerId') offerId: string,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.multiOrders.createOrder(taskId, offerId, dto, user.id);
  }

  @Patch(':taskId/orders/close')
  closeMultiSupplierTask(@Param('taskId') taskId: string) {
    return this.multiOrders.closeTask(taskId);
  }

  @Patch(':taskId/orders/:orderId')
  updateMultiSupplierOrder(
    @CurrentUser() user: AuthUser,
    @Param('taskId') taskId: string,
    @Param('orderId') orderId: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.multiOrders.updateOrder(taskId, orderId, dto, user.id);
  }

  @Patch(':taskId/orders/:orderId/:action')
  changeSupplierOrder(
    @CurrentUser() user: AuthUser,
    @Param('taskId') taskId: string,
    @Param('orderId') orderId: string,
    @Param('action') action: string,
    @Body() body: Record<string, string>,
  ) {
    return this.multiOrders.action(taskId, orderId, action, body, user.id);
  }

  @Post(':id/purchase-order')
  createPurchaseOrder(
    @Param('id') id: string,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.tasksService.createPurchaseOrder(id, dto);
  }

  @Patch(':id/purchase-order/send-to-payment')
  sendPurchaseOrderToPayment(@Param('id') id: string) {
    return this.tasksService.sendPurchaseOrderToPayment(id);
  }

  @Patch(':id/purchase-order/cancel')
  cancelPurchaseOrder(
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ) {
    return this.tasksService.cancelPurchaseOrder(id, body.reason);
  }

  @Patch(':id/purchase-order/confirm-payment')
  confirmPurchaseOrderPayment(@Param('id') id: string) {
    return this.tasksService.confirmPurchaseOrderPayment(id);
  }

  @Patch(':id/purchase-order/ship')
  shipPurchaseOrder(
    @Param('id') id: string,
    @Body() dto: ShipPurchaseOrderDto,
  ) {
    return this.tasksService.shipPurchaseOrder(id, dto);
  }

  @Patch(':id/purchase-order/ready-for-pickup')
  markPurchaseOrderReadyForPickup(@Param('id') id: string) {
    return this.tasksService.markPurchaseOrderReadyForPickup(id);
  }

  @Patch(':id/purchase-order/receive')
  receivePurchaseOrder(@Param('id') id: string) {
    return this.tasksService.receivePurchaseOrder(id);
  }
  
  @Patch(':id/purchase-order/hand-over')
  handOverPurchaseOrder(
    @Param('id') id: string,
    @Body() dto: HandOverPurchaseOrderDto,
  ) {
    return this.tasksService.handOverPurchaseOrder(id, dto);
  }
  
  @Patch(':id/purchase-order/close')
  closePurchaseOrder(@Param('id') id: string) {
    return this.tasksService.closePurchaseOrder(id);
  }
}
