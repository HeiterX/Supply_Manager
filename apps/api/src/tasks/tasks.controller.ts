import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { HandOverPurchaseOrderDto } from './dto/hand-over-purchase-order.dto.js';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto.js';
import { CreateSupplierOfferDto } from './dto/create-supplier-offer.dto.js';
import { CreateTaskActivityDto } from './dto/create-task-activity.dto.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { CreateTaskItemDto } from './dto/create-task-item.dto.js';
import { ShipPurchaseOrderDto } from './dto/ship-purchase-order.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { UpdateTaskItemDto } from './dto/update-task-item.dto.js';
import { TasksService } from './tasks.service.js';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

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
    @Param('taskId') taskId: string,
    @Body() dto: CreateTaskItemDto,
  ) {
    return this.tasksService.addTaskItem(taskId, dto);
  }

  @Patch(':taskId/items/:itemId')
  updateTaskItem(
    @Param('taskId') taskId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateTaskItemDto,
  ) {
    return this.tasksService.updateTaskItem(taskId, itemId, dto);
  }

  @Delete(':taskId/items/:itemId')
  deleteTaskItem(
    @Param('taskId') taskId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.tasksService.deleteTaskItem(taskId, itemId);
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
    @Param('id') id: string,
    @Body() dto: CreateSupplierOfferDto,
  ) {
    return this.tasksService.addSupplierOffer(id, dto);
  }

  @Patch(':taskId/supplier-offers/:offerId/select')
  selectSupplierOffer(
    @Param('taskId') taskId: string,
    @Param('offerId') offerId: string,
  ) {
    return this.tasksService.selectSupplierOffer(taskId, offerId);
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
