import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { HandOverPurchaseOrderDto } from './dto/hand-over-purchase-order.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto.js';
import { CreateSupplierOfferDto } from './dto/create-supplier-offer.dto.js';
import { CreateTaskActivityDto } from './dto/create-task-activity.dto.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { CreateTaskItemDto } from './dto/create-task-item.dto.js';
import { ShipPurchaseOrderDto } from './dto/ship-purchase-order.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { UpdateTaskItemDto } from './dto/update-task-item.dto.js';

@Injectable()
export class TasksService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateTaskDto) {
    return this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        priority: dto.priority,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
      },
    });
  }

  findAll() {
    return this.prisma.task.findMany({
      include: {
        items: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      include: {
        items: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        activities: {
          orderBy: {
            createdAt: 'desc',
          },
        },
        supplierOffers: {
          include: {
            supplier: true,
            items: {
              include: {
                taskItem: true,
              },
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
        selectedOffer: {
          include: {
            supplier: true,
            items: {
              include: {
                taskItem: true,
              },
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
        },
        purchaseOrder: {
          include: {
            supplier: true,
            supplierOffer: true,
            items: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
        },
        purchaseOrders: {
          include: {
            supplier: true,
            supplierOffer: true,
            items: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    return task;
  }

  async update(id: string, dto: UpdateTaskDto) {
    const currentTask = await this.prisma.task.findUnique({
      where: { id },
    });

    if (!currentTask) {
      throw new NotFoundException('Задача не найдена');
    }

    if (dto.status === 'CLOSED') {
      throw new BadRequestException(
        'Закупку нельзя закрыть вручную. Используйте действие «Закрыть закупку» после передачи товара',
      );
    }

    if (dto.status !== undefined) {
      const hasMultiOrders = await this.prisma.purchaseOrder.findFirst({
        where: { taskId: id, items: { some: {} } }, select: { id: true },
      });
      if (hasMultiOrders) throw new ConflictException('Этап многопоставочной закупки меняется через действия с заказами');
    }

    if (currentTask.status === 'CLOSED' && dto.status !== undefined) {
      throw new ConflictException('Закрытую закупку нельзя повторно открыть вручную');
    }

    const nextStatus = dto.status ?? currentTask.status;
    const nextPriority = dto.priority ?? currentTask.priority;

    const nextAction =
      dto.nextAction !== undefined
        ? dto.nextAction.trim() || null
        : currentTask.nextAction;

    const nextReminderAt =
      dto.reminderAt !== undefined
        ? new Date(dto.reminderAt)
        : currentTask.reminderAt;

    const changes: string[] = [];

    if (dto.status !== undefined && dto.status !== currentTask.status) {
      changes.push(
        `Этап изменён: «${this.getStatusLabel(currentTask.status)}» → «${this.getStatusLabel(dto.status)}»`,
      );
    }

    if (
      dto.priority !== undefined &&
      dto.priority !== currentTask.priority
    ) {
      changes.push(
        `Приоритет изменён: «${this.getPriorityLabel(currentTask.priority)}» → «${this.getPriorityLabel(dto.priority)}»`,
      );
    }

    if (
      dto.nextAction !== undefined &&
      nextAction !== currentTask.nextAction
    ) {
      if (nextAction) {
        changes.push(`Следующее действие: ${nextAction}`);
      } else {
        changes.push('Следующее действие очищено');
      }
    }

    if (
      dto.reminderAt !== undefined &&
      nextReminderAt?.getTime() !== currentTask.reminderAt?.getTime()
    ) {
      changes.push(
        `Напоминание изменено: ${this.formatDateTime(nextReminderAt)}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id },
        data: {
          status: nextStatus,
          priority: nextPriority,
          nextAction:
            dto.nextAction !== undefined ? nextAction : undefined,
          reminderAt:
            dto.reminderAt !== undefined
              ? nextReminderAt
              : undefined,
          closedAt:
            dto.status === 'CLOSED'
              ? new Date()
              : dto.status !== undefined
                ? null
                : undefined,
        },
      });

      if (changes.length > 0) {
        await tx.taskActivity.createMany({
          data: changes.map((text) => ({
            taskId: id,
            text,
          })),
        });
      }

      return tx.task.findUnique({
        where: { id },
        include: {
          items: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
          activities: {
            orderBy: {
              createdAt: 'desc',
            },
          },
          supplierOffers: {
            include: {
              supplier: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
          selectedOffer: {
            include: {
              supplier: true,
            },
          },
          purchaseOrder: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
          },
          purchaseOrders: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });
  }

  async addActivity(id: string, dto: CreateTaskActivityDto) {
    await this.ensureTaskExists(id);

    return this.prisma.taskActivity.create({
      data: {
        taskId: id,
        text: dto.text.trim(),
      },
    });
  }

  async findTaskItems(taskId: string) {
    await this.ensureTaskExists(taskId);

    return this.prisma.taskItem.findMany({
      where: { taskId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async addTaskItem(taskId: string, dto: CreateTaskItemDto) {
    await this.ensureTaskExists(taskId);
    await this.ensureTaskOpen(taskId);

    const name = dto.name.trim();
    const unit = dto.unit.trim();

    if (!name) {
      throw new BadRequestException('Укажите наименование позиции');
    }

    if (!unit) {
      throw new BadRequestException('Укажите единицу измерения');
    }

    return this.prisma.$transaction(async (tx) => {
      let sortOrder = dto.sortOrder;

      if (sortOrder === undefined) {
        const lastItem = await tx.taskItem.findFirst({
          where: { taskId },
          orderBy: [{ sortOrder: 'desc' }, { createdAt: 'desc' }],
          select: { sortOrder: true },
        });
        sortOrder = (lastItem?.sortOrder ?? -1) + 1;
      }

      const item = await tx.taskItem.create({
        data: {
          taskId,
          name,
          partNumber: dto.partNumber?.trim() || null,
          quantity: dto.quantity,
          unit,
          unitPrice: dto.unitPrice,
          currency: dto.currency?.trim().toUpperCase() || 'RUB',
          notes: dto.notes?.trim() || null,
          sortOrder,
        },
      });

      await tx.taskActivity.create({
        data: {
          taskId,
          text: `Добавлена позиция «${item.name}» — ${item.quantity.toString()} ${item.unit}`,
        },
      });

      return item;
    });
  }

  async updateTaskItem(
    taskId: string,
    itemId: string,
    dto: UpdateTaskItemDto,
  ) {
    await this.ensureTaskExists(taskId);
    await this.ensureTaskOpen(taskId);

    const currentItem = await this.prisma.taskItem.findFirst({
      where: { id: itemId, taskId },
    });

    if (!currentItem) {
      throw new NotFoundException('Позиция закупки не найдена');
    }

    const activeLine = await this.prisma.purchaseOrderItem.findFirst({
      where: { taskItemId: itemId, purchaseOrder: { taskId, cancelledAt: null } },
      select: { id: true },
    });
    if (activeLine) throw new ConflictException('Позицию с действующим заказом нельзя изменить или удалить. Сначала отмените неоплаченный заказ');

    const name = dto.name !== undefined ? dto.name.trim() : undefined;
    const unit = dto.unit !== undefined ? dto.unit.trim() : undefined;

    if (name !== undefined && !name) {
      throw new BadRequestException('Укажите наименование позиции');
    }

    if (unit !== undefined && !unit) {
      throw new BadRequestException('Укажите единицу измерения');
    }

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.taskItem.update({
        where: { id: itemId },
        data: {
          name,
          partNumber:
            dto.partNumber !== undefined
              ? dto.partNumber.trim() || null
              : undefined,
          quantity: dto.quantity,
          unit,
          unitPrice: dto.unitPrice,
          currency:
            dto.currency !== undefined
              ? dto.currency.trim().toUpperCase() || 'RUB'
              : undefined,
          notes:
            dto.notes !== undefined ? dto.notes.trim() || null : undefined,
          sortOrder: dto.sortOrder,
        },
      });

      await tx.taskActivity.create({
        data: {
          taskId,
          text: `Изменена позиция «${item.name}»`,
        },
      });

      return item;
    });
  }

  async deleteTaskItem(taskId: string, itemId: string) {
    await this.ensureTaskExists(taskId);
    await this.ensureTaskOpen(taskId);

    const item = await this.prisma.taskItem.findFirst({
      where: { id: itemId, taskId },
    });

    if (!item) {
      throw new NotFoundException('Позиция закупки не найдена');
    }

    const activeLine = await this.prisma.purchaseOrderItem.findFirst({
      where: { taskItemId: itemId, purchaseOrder: { taskId, cancelledAt: null } },
      select: { id: true },
    });
    if (activeLine) throw new ConflictException('Позицию с действующим заказом нельзя изменить или удалить. Сначала отмените неоплаченный заказ');

    return this.prisma.$transaction(async (tx) => {
      const deletedItem = await tx.taskItem.delete({
        where: { id: itemId },
      });

      await tx.taskActivity.create({
        data: {
          taskId,
          text: `Удалена позиция «${item.name}»`,
        },
      });

      return deletedItem;
    });
  }

  async addSupplierOffer(
    taskId: string,
    dto: CreateSupplierOfferDto,
  ) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
    if (!task) throw new NotFoundException('Закупка не найдена');
    if (task.status === 'CLOSED' || task.status === 'CANCELLED') {
      throw new ConflictException('Нельзя добавлять КП к закрытой или отменённой закупке');
    }

    const supplierName = dto.supplierName.trim();

    if (!supplierName) {
      throw new BadRequestException(
        'Укажите наименование поставщика',
      );
    }

    const offerItems = dto.items ?? [];

    const taskItemIds = offerItems.map(
      (item) => item.taskItemId,
    );

    if (
      new Set(taskItemIds).size !==
      taskItemIds.length
    ) {
      throw new BadRequestException(
        'Одна позиция закупки не может повторяться в одном предложении поставщика',
      );
    }

    if (taskItemIds.length > 0) {
      const taskItems =
        await this.prisma.taskItem.findMany({
          where: {
            taskId,
            id: {
              in: taskItemIds,
            },
          },
          select: {
            id: true,
            name: true,
            quantity: true,
          },
        });

      if (
        taskItems.length !==
        taskItemIds.length
      ) {
        throw new BadRequestException(
          'Одна или несколько позиций предложения не относятся к этой закупке',
        );
      }
      const taskItemMap = new Map<string, (typeof taskItems)[number]>(taskItems.map(item => [item.id, item]));
      for (const line of offerItems) {
        const item = taskItemMap.get(line.taskItemId);
        if (!item) continue;
        if (Math.round(line.quantity * 1000) > Math.round(item.quantity.toNumber() * 1000)) {
          throw new BadRequestException(`По позиции «${item.name}» предложение превышает требуемое количество`);
        }
      }
    }

    /*
     * Если для всех строк указана цена,
     * общую стоимость товара рассчитываем автоматически.
     *
     * Старое dto.price пока сохраняется как fallback,
     * чтобы существующий frontend продолжал работать.
     */
    const canCalculatePrice =
      offerItems.length > 0 &&
      offerItems.every(
        (item) => item.unitPrice !== undefined,
      );

    const calculatedPrice = canCalculatePrice
      ? offerItems.reduce(
          (sum, item) =>
            sum +
            item.quantity *
              (item.unitPrice ?? 0),
          0,
        )
      : undefined;

    return this.prisma.$transaction(
      async (tx) => {
        const supplier =
          await tx.supplier.create({
            data: {
              name: supplierName,
              contact:
                dto.contact?.trim() || null,
              phone:
                dto.phone?.trim() || null,
              email:
                dto.email?.trim() || null,
              website:
                dto.website?.trim() || null,
            },
          });

        const offer =
          await tx.supplierOffer.create({
            data: {
              taskId,
              supplierId: supplier.id,
              status: 'OFFER_RECEIVED',

              price:
                calculatedPrice ??
                dto.price,

              deliveryPrice:
                dto.deliveryPrice,

              deliveryDays:
                dto.deliveryDays,

              inStock:
                dto.inStock,

              notes:
                dto.notes?.trim() || null,

              receivedAt: new Date(),

              items:
                offerItems.length > 0
                  ? {
                      create:
                        offerItems.map(
                          (item) => ({
                            taskItemId:
                              item.taskItemId,

                            quantity:
                              item.quantity,

                            unitPrice:
                              item.unitPrice,

                            currency:
                              item.currency
                                ?.trim()
                                .toUpperCase() ||
                              'RUB',

                            inStock:
                              item.inStock,

                            notes:
                              item.notes?.trim() ||
                              null,
                          }),
                        ),
                    }
                  : undefined,
            },

            include: {
              supplier: true,

              items: {
                include: {
                  taskItem: true,
                },

                orderBy: {
                  createdAt: 'asc',
                },
              },
            },
          });

        await tx.taskActivity.create({
          data: {
            taskId,
            text:
              offerItems.length > 0
                ? `Добавлено предложение поставщика «${supplier.name}» — ${offerItems.length} поз.`
                : `Добавлено предложение поставщика «${supplier.name}»`,
          },
        });

        return offer;
      },
    );
  }

  async selectSupplierOffer(taskId: string, offerId: string) {
    await this.ensureLegacyOrderFlow(taskId);
  await this.ensureTaskExists(taskId);

  const existingOrder = await this.prisma.purchaseOrder.findFirst({
    where: {
      taskId,
      cancelledAt: null,
    },
  });

  if (existingOrder) {
    throw new ConflictException(
      'Нельзя изменить поставщика: по задаче уже оформлен заказ',
    );
  }

  const offer = await this.prisma.supplierOffer.findFirst({
      where: {
        id: offerId,
        taskId,
      },
      include: {
        supplier: true,
      },
    });

    if (!offer) {
      throw new NotFoundException(
        'Предложение поставщика для этой задачи не найдено',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.supplierOffer.updateMany({
        where: {
          taskId,
          status: 'SELECTED',
          id: {
            not: offerId,
          },
        },
        data: {
          status: 'OFFER_RECEIVED',
        },
      });

      await tx.supplierOffer.update({
        where: {
          id: offerId,
        },
        data: {
          status: 'SELECTED',
        },
      });

      await tx.task.update({
        where: {
          id: taskId,
        },
        data: {
          selectedOfferId: offerId,
          status: 'NEGOTIATION',
          nextAction: `Согласовать условия и оформить заказ у «${offer.supplier.name}»`,
        },
      });

      await tx.taskActivity.create({
        data: {
          taskId,
          text: `Выбран поставщик «${offer.supplier.name}»`,
        },
      });

      return tx.task.findUnique({
        where: {
          id: taskId,
        },
        include: {
          items: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
          activities: {
            orderBy: {
              createdAt: 'desc',
            },
          },
          supplierOffers: {
            include: {
              supplier: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
          selectedOffer: {
            include: {
              supplier: true,
            },
          },
          purchaseOrder: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
          },
          purchaseOrders: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });
  }

  async createPurchaseOrder(
    taskId: string,
    dto: CreatePurchaseOrderDto,
  ) {
    await this.ensureLegacyOrderFlow(taskId);
    const task = await this.prisma.task.findUnique({
      where: {
        id: taskId,
      },
      include: {
        selectedOffer: {
          include: {
            supplier: true,
          },
        },
        purchaseOrder: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    if (!task.selectedOffer) {
      throw new BadRequestException(
        'Сначала необходимо выбрать предложение поставщика',
      );
    }

    if (task.purchaseOrder) {
      throw new ConflictException(
        'Заказ по этой задаче уже оформлен',
      );
    }

    const offer = task.selectedOffer;

    const price = offer.price;
    const deliveryPrice = offer.deliveryPrice;

    const totalPrice =
      price !== null || deliveryPrice !== null
        ? (price?.toNumber() ?? 0) +
          (deliveryPrice?.toNumber() ?? 0)
        : null;

    return this.prisma.$transaction(async (tx) => {
      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          taskId,
          supplierId: offer.supplierId,
          supplierOfferId: offer.id,

          price,
          deliveryPrice,
          totalPrice,
          deliveryDays: offer.deliveryDays,

          invoiceNumber:
            dto.invoiceNumber?.trim() || null,

          invoiceDate:
            dto.invoiceDate
              ? new Date(dto.invoiceDate)
              : null,

          notes:
            dto.notes?.trim() || null,
        },
        include: {
          supplier: true,
          supplierOffer: true,
        },
      });

      await tx.task.update({
        where: {
          id: taskId,
        },
        data: {
          currentPurchaseOrderId: purchaseOrder.id,
          status: 'ORDERED',
          nextAction: dto.invoiceNumber
            ? 'Передать счёт на оплату'
            : `Получить счёт от «${offer.supplier.name}»`,
        },
      });

      const formattedTotal =
        totalPrice !== null
          ? new Intl.NumberFormat('ru-RU').format(totalPrice)
          : null;

      await tx.taskActivity.create({
        data: {
          taskId,
          text: formattedTotal
            ? `Оформлен заказ у «${offer.supplier.name}» на сумму ${formattedTotal} ₽`
            : `Оформлен заказ у «${offer.supplier.name}»`,
        },
      });

      return purchaseOrder;
    });
  }

  async sendPurchaseOrderToPayment(taskId: string) {
    await this.ensureLegacyOrderFlow(taskId);
    const task = await this.prisma.task.findUnique({
      where: {
        id: taskId,
      },
      include: {
        purchaseOrder: {
          include: {
            supplier: true,
            supplierOffer: true,
          },
        },
        purchaseOrders: {
          include: {
            supplier: true,
            supplierOffer: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    if (!task.purchaseOrder) {
      throw new BadRequestException(
        'Сначала необходимо оформить заказ',
      );
    }

    const purchaseOrder = task.purchaseOrder;

    if (!purchaseOrder.invoiceNumber) {
      throw new BadRequestException(
        'Нельзя передать на оплату заказ без номера счёта',
      );
    }

    if (purchaseOrder.sentToPaymentAt) {
      throw new ConflictException(
        'Счёт уже был передан на оплату',
      );
    }

    const sentToPaymentAt = new Date();

    // Автоматически напоминаем проверить оплату ровно через 24 часа.
    const reminderAt = new Date(
      sentToPaymentAt.getTime() + 24 * 60 * 60 * 1000,
    );

    const invoiceNumber = purchaseOrder.invoiceNumber;

    return this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: {
          id: purchaseOrder.id,
        },
        data: {
          sentToPaymentAt,
        },
      });

      await tx.task.update({
        where: {
          id: taskId,
        },
        data: {
          status: 'WAITING_PAYMENT',
          nextAction: `Проверить оплату счёта № ${invoiceNumber}`,
          reminderAt,
        },
      });

      await tx.taskActivity.create({
        data: {
          taskId,
          text:
            `Счёт № ${invoiceNumber} передан на оплату. ` +
            `Напоминание проверить оплату: ${this.formatDateTime(reminderAt)}`,
        },
      });

      return tx.task.findUnique({
        where: {
          id: taskId,
        },
        include: {
          items: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
          activities: {
            orderBy: {
              createdAt: 'desc',
            },
          },
          supplierOffers: {
            include: {
              supplier: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
          selectedOffer: {
            include: {
              supplier: true,
            },
          },
          purchaseOrder: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
          },
          purchaseOrders: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });
  }

  async cancelPurchaseOrder(taskId: string, reason?: string) {
    await this.ensureLegacyOrderFlow(taskId);
    const cancelReason = reason?.trim();

    if (!cancelReason) {
      throw new BadRequestException('Укажите причину отмены поставщика');
    }

    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        selectedOffer: {
          include: { supplier: true },
        },
        purchaseOrder: {
          include: {
            supplier: true,
            supplierOffer: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    if (!task.selectedOffer && !task.purchaseOrder) {
      throw new BadRequestException('В задаче нет выбранного поставщика');
    }

    if (task.purchaseOrder?.paidAt) {
      throw new ConflictException(
        'Нельзя отменить выбор поставщика: оплата уже подтверждена',
      );
    }

    const purchaseOrder = task.purchaseOrder;
    const supplierName =
      purchaseOrder?.supplier.name ??
      task.selectedOffer?.supplier.name ??
      'поставщика';
    const invoiceNumber = purchaseOrder?.invoiceNumber ?? null;
    const cancelledAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      if (purchaseOrder) {
        await tx.purchaseOrder.update({
          where: { id: purchaseOrder.id },
          data: {
            cancelledAt,
            cancelReason,
          },
        });
      }

      await tx.supplierOffer.updateMany({
        where: {
          taskId,
          status: 'SELECTED',
        },
        data: {
          status: 'OFFER_RECEIVED',
        },
      });

      await tx.task.update({
        where: { id: taskId },
        data: {
          currentPurchaseOrderId: null,
          selectedOfferId: null,
          status: 'SEARCHING',
          nextAction: 'Выбрать нового поставщика',
          reminderAt: null,
        },
      });

      const activityText = purchaseOrder
        ? `Заказ у «${supplierName}» отменён${invoiceNumber ? `, счёт № ${invoiceNumber}` : ''}. Причина: ${cancelReason}`
        : `Выбор поставщика «${supplierName}» отменён. Причина: ${cancelReason}`;

      await tx.taskActivity.create({
        data: {
          taskId,
          text: activityText,
        },
      });

      return tx.task.findUnique({
        where: { id: taskId },
        include: {
          items: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
          activities: {
            orderBy: { createdAt: 'desc' },
          },
          supplierOffers: {
            include: { supplier: true },
            orderBy: { createdAt: 'desc' },
          },
          selectedOffer: {
            include: { supplier: true },
          },
          purchaseOrder: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
          },
          purchaseOrders: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });
  }

  async confirmPurchaseOrderPayment(taskId: string) {
    await this.ensureLegacyOrderFlow(taskId);
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        purchaseOrder: {
          include: {
            supplier: true,
            supplierOffer: true,
          },
        },
        purchaseOrders: {
          include: {
            supplier: true,
            supplierOffer: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    if (!task.purchaseOrder) {
      throw new BadRequestException('Сначала необходимо оформить заказ');
    }

    const purchaseOrder = task.purchaseOrder;

    if (!purchaseOrder.sentToPaymentAt) {
      throw new BadRequestException(
        'Сначала необходимо передать счёт на оплату',
      );
    }

    if (purchaseOrder.paidAt) {
      throw new ConflictException('Оплата уже была подтверждена');
    }

    if (task.status !== 'WAITING_PAYMENT') {
      throw new ConflictException(
        'Подтвердить оплату можно только на этапе ожидания оплаты',
      );
    }

    const paidAt = new Date();
    const invoiceNumber = purchaseOrder.invoiceNumber;

    return this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: { paidAt },
      });

      await tx.task.update({
        where: { id: taskId },
        data: {
          status: 'WAITING_SHIPMENT',
          nextAction: 'Проконтролировать отгрузку поставщиком',
          reminderAt: null,
        },
      });

      await tx.taskActivity.create({
        data: {
          taskId,
          text: invoiceNumber
            ? `Оплата счёта № ${invoiceNumber} подтверждена`
            : 'Оплата заказа подтверждена',
        },
      });

      return tx.task.findUnique({
        where: { id: taskId },
        include: {
          items: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
          activities: {
            orderBy: { createdAt: 'desc' },
          },
          supplierOffers: {
            include: { supplier: true },
            orderBy: { createdAt: 'desc' },
          },
          selectedOffer: {
            include: { supplier: true },
          },
          purchaseOrder: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
          },
          purchaseOrders: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });
  }


  async shipPurchaseOrder(taskId: string, dto: ShipPurchaseOrderDto) {
    await this.ensureLegacyOrderFlow(taskId);
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        purchaseOrder: {
          include: {
            supplier: true,
            supplierOffer: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    if (!task.purchaseOrder) {
      throw new BadRequestException('Сначала необходимо оформить заказ');
    }

    const purchaseOrder = task.purchaseOrder;

    if (!purchaseOrder.paidAt) {
      throw new BadRequestException(
        'Отметить отгрузку можно только после подтверждения оплаты',
      );
    }

    if (purchaseOrder.shippedAt) {
      throw new ConflictException('Отгрузка уже была подтверждена');
    }

    if (task.status !== 'WAITING_SHIPMENT') {
      throw new ConflictException(
        'Подтвердить отгрузку можно только на этапе ожидания отгрузки',
      );
    }

    const carrier = dto.carrier.trim();
    const trackingNumber = dto.trackingNumber?.trim() || null;
    const shippedAt = new Date(dto.shippedAt);
    const expectedDeliveryAt = dto.expectedDeliveryAt
      ? new Date(dto.expectedDeliveryAt)
      : null;

    if (
      expectedDeliveryAt &&
      expectedDeliveryAt.getTime() < shippedAt.getTime()
    ) {
      throw new BadRequestException(
        'Ожидаемая дата прибытия не может быть раньше даты отгрузки',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: {
          shippedAt,
          carrier,
          trackingNumber,
          expectedDeliveryAt,
        },
      });

      await tx.task.update({
        where: { id: taskId },
        data: {
          status: 'IN_TRANSIT',
          nextAction: trackingNumber
            ? `Отслеживать доставку ${carrier}, трек / ТТН ${trackingNumber}`
            : `Отслеживать доставку ${carrier}`,
          reminderAt: expectedDeliveryAt,
        },
      });

      const details = [
        `Заказ отгружен поставщиком. Транспортная компания: ${carrier}`,
        trackingNumber ? `трек / ТТН: ${trackingNumber}` : null,
        expectedDeliveryAt
          ? `ожидаемое прибытие: ${this.formatDateTime(expectedDeliveryAt)}`
          : null,
      ]
        .filter(Boolean)
        .join('. ');

      await tx.taskActivity.create({
        data: {
          taskId,
          text: details,
        },
      });

      return tx.task.findUnique({
        where: { id: taskId },
        include: {
          items: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
          activities: {
            orderBy: { createdAt: 'desc' },
          },
          supplierOffers: {
            include: { supplier: true },
            orderBy: { createdAt: 'desc' },
          },
          selectedOffer: {
            include: { supplier: true },
          },
          purchaseOrder: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
          },
          purchaseOrders: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });
  }

  async markPurchaseOrderReadyForPickup(taskId: string) {
    await this.ensureLegacyOrderFlow(taskId);
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        purchaseOrder: {
          include: {
            supplier: true,
            supplierOffer: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    if (!task.purchaseOrder) {
      throw new BadRequestException('Сначала необходимо оформить заказ');
    }

    const purchaseOrder = task.purchaseOrder;

    if (!purchaseOrder.shippedAt) {
      throw new BadRequestException(
        'Нельзя отметить прибытие: заказ ещё не был отгружен',
      );
    }

    if (purchaseOrder.readyForPickupAt) {
      throw new ConflictException(
        'Прибытие груза уже было подтверждено',
      );
    }

    if (task.status !== 'IN_TRANSIT') {
      throw new ConflictException(
        'Подтвердить прибытие можно только для заказа в пути',
      );
    }

    const readyForPickupAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: {
          readyForPickupAt,
        },
      });

      await tx.task.update({
        where: { id: taskId },
        data: {
          status: 'READY_FOR_PICKUP',
          nextAction: 'Получить товар',
          reminderAt: null,
        },
      });

      const carrier = purchaseOrder.carrier;
      const trackingNumber = purchaseOrder.trackingNumber;

      const details = [
        'Груз прибыл и готов к получению',
        carrier ? `транспортная компания: ${carrier}` : null,
        trackingNumber ? `трек / ТТН: ${trackingNumber}` : null,
      ]
        .filter(Boolean)
        .join('. ');

      await tx.taskActivity.create({
        data: {
          taskId,
          text: details,
        },
      });

      return tx.task.findUnique({
        where: { id: taskId },
        include: {
          items: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
          activities: {
            orderBy: { createdAt: 'desc' },
          },
          supplierOffers: {
            include: { supplier: true },
            orderBy: { createdAt: 'desc' },
          },
          selectedOffer: {
            include: { supplier: true },
          },
          purchaseOrder: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
          },
          purchaseOrders: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });
  }

  async receivePurchaseOrder(taskId: string) {
    await this.ensureLegacyOrderFlow(taskId);
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        purchaseOrder: {
          include: {
            supplier: true,
            supplierOffer: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    if (!task.purchaseOrder) {
      throw new BadRequestException('Сначала необходимо оформить заказ');
    }

    const purchaseOrder = task.purchaseOrder;

    if (!purchaseOrder.readyForPickupAt) {
      throw new BadRequestException(
        'Нельзя подтвердить получение: груз ещё не прибыл',
      );
    }

    if (purchaseOrder.receivedAt) {
      throw new ConflictException(
        'Получение товара уже было подтверждено',
      );
    }

    if (task.status !== 'READY_FOR_PICKUP') {
      throw new ConflictException(
        'Подтвердить получение можно только для груза, готового к получению',
      );
    }

    const receivedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: {
          receivedAt,
        },
      });

      await tx.task.update({
        where: { id: taskId },
        data: {
          status: 'RECEIVED',
          nextAction: 'Передать товар конечному получателю',
          reminderAt: null,
        },
      });

      const details = [
        'Товар получен',
        purchaseOrder.carrier
          ? `транспортная компания: ${purchaseOrder.carrier}`
          : null,
        purchaseOrder.trackingNumber
          ? `трек / ТТН: ${purchaseOrder.trackingNumber}`
          : null,
      ]
        .filter(Boolean)
        .join('. ');

      await tx.taskActivity.create({
        data: {
          taskId,
          text: details,
        },
      });

      return tx.task.findUnique({
        where: { id: taskId },
        include: {
          items: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
          activities: {
            orderBy: { createdAt: 'desc' },
          },
          supplierOffers: {
            include: { supplier: true },
            orderBy: { createdAt: 'desc' },
          },
          selectedOffer: {
            include: { supplier: true },
          },
          purchaseOrder: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
          },
          purchaseOrders: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });
  }

  async handOverPurchaseOrder(
    taskId: string,
    dto: HandOverPurchaseOrderDto,
  ) {
    await this.ensureLegacyOrderFlow(taskId);
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        purchaseOrder: {
          include: {
            supplier: true,
            supplierOffer: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    if (!task.purchaseOrder) {
      throw new BadRequestException('Сначала необходимо оформить заказ');
    }

    const purchaseOrder = task.purchaseOrder;

    if (!purchaseOrder.receivedAt) {
      throw new BadRequestException(
        'Нельзя передать товар: сначала необходимо подтвердить его получение',
      );
    }

    if (purchaseOrder.handedOverAt) {
      throw new ConflictException('Товар уже был передан конечному получателю');
    }

    if (task.status !== 'RECEIVED') {
      throw new ConflictException(
        'Передать товар можно только после подтверждения его получения',
      );
    }

    const handedOverTo = dto.handedOverTo.trim();

    if (!handedOverTo) {
      throw new BadRequestException('Укажите, кому передан товар');
    }

    const handedOverAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrder.id },
        data: {
          handedOverAt,
          handedOverTo,
        },
      });

      await tx.task.update({
        where: { id: taskId },
        data: {
          status: 'HANDED_OVER',
          nextAction: 'Закрыть закупку',
          reminderAt: null,
        },
      });

      await tx.taskActivity.create({
        data: {
          taskId,
          text: `Товар передан: ${handedOverTo}`,
        },
      });

      return tx.task.findUnique({
        where: { id: taskId },
        include: {
          items: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
          activities: {
            orderBy: { createdAt: 'desc' },
          },
          supplierOffers: {
            include: { supplier: true },
            orderBy: { createdAt: 'desc' },
          },
          selectedOffer: {
            include: { supplier: true },
          },
          purchaseOrder: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
          },
          purchaseOrders: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });
  }

  async closePurchaseOrder(taskId: string) {
    await this.ensureLegacyOrderFlow(taskId);
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        purchaseOrder: {
          include: {
            supplier: true,
            supplierOffer: true,
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }

    if (!task.purchaseOrder) {
      throw new BadRequestException('Сначала необходимо оформить заказ');
    }

    const purchaseOrder = task.purchaseOrder;

    if (!purchaseOrder.handedOverAt) {
      throw new BadRequestException(
        'Нельзя закрыть закупку: товар ещё не передан конечному получателю',
      );
    }

    if (task.status === 'CLOSED') {
      throw new ConflictException('Закупка уже закрыта');
    }

    if (task.status !== 'HANDED_OVER') {
      throw new ConflictException(
        'Закрыть закупку можно только после передачи товара',
      );
    }

    const closedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: taskId },
        data: {
          status: 'CLOSED',
          closedAt,
          nextAction: null,
          reminderAt: null,
        },
      });

      await tx.taskActivity.create({
        data: {
          taskId,
          text: 'Закупка закрыта',
        },
      });

      return tx.task.findUnique({
        where: { id: taskId },
        include: {
          items: {
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
          activities: {
            orderBy: { createdAt: 'desc' },
          },
          supplierOffers: {
            include: { supplier: true },
            orderBy: { createdAt: 'desc' },
          },
          selectedOffer: {
            include: { supplier: true },
          },
          purchaseOrder: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
          },
          purchaseOrders: {
            include: {
              supplier: true,
              supplierOffer: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });
    });
  }

  async findItemRegistry() {
    return this.prisma.taskItem.findMany({
      include: {
        task: {
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            priority: true,
            deadline: true,
            nextAction: true,
            selectedOffer: {
              select: {
                id: true,
                supplier: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
            purchaseOrder: {
              select: {
                id: true,
                supplier: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  private async ensureTaskOpen(taskId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
    if (!task) throw new NotFoundException('Закупка не найдена');
    if (task.status === 'CLOSED' || task.status === 'CANCELLED') {
      throw new ConflictException('Нельзя изменять позиции закрытой или отменённой закупки');
    }
  }

  private async ensureLegacyOrderFlow(taskId: string) {
    const multiOrder = await this.prisma.purchaseOrder.findFirst({
      where: { taskId, items: { some: {} } },
      select: { id: true },
    });
    if (multiOrder) {
      throw new ConflictException('Для этой закупки используйте действия с отдельными заказами поставщиков');
    }
  }

  private async ensureTaskExists(id: string) {
    const task = await this.prisma.task.findUnique({
      where: { id },
      select: {
        id: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Задача не найдена');
    }
  }

  private getStatusLabel(status: string) {
    const labels: Record<string, string> = {
      NEW: 'Новая',
      SEARCHING: 'Поиск поставщика',
      NEGOTIATION: 'Переговоры / согласование',
      ORDERED: 'Заказано',
      WAITING_PAYMENT: 'Ожидает оплаты',
      WAITING_SHIPMENT: 'Ожидает отгрузки',
      IN_TRANSIT: 'В пути',
      READY_FOR_PICKUP: 'Готово к получению',
      RECEIVED: 'Получено',
      HANDED_OVER: 'Передано',
      CLOSED: 'Закрыто',
      CANCELLED: 'Отменено',
    };

    return labels[status] ?? status;
  }

  private getPriorityLabel(priority: string) {
    const labels: Record<string, string> = {
      LOW: 'Низкий',
      NORMAL: 'Обычный',
      HIGH: 'Высокий',
      URGENT: 'Срочный',
    };

    return labels[priority] ?? priority;
  }

  private formatDateTime(value: Date | null) {
    if (!value) {
      return 'не установлено';
    }

    return new Intl.DateTimeFormat('ru-RU', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Europe/Moscow',
    }).format(value);
  }
}