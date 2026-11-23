
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';

const adminUserSelect = {
  id: true,
  username: true,
  fullName: true,
  email: true,
  department: true,
  position: true,
  role: true,
  status: true,
  createdAt: true,
} as const;

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // Получение списка пользователей
  async findAll() {
    return this.prisma.user.findMany({
      select: adminUserSelect,
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });
  }

  // Активация нового сотрудника
  async activate(userId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.user.updateMany({
        where: {
          id: userId,
          status: 'PENDING',
        },
        data: {
          status: 'ACTIVE',
        },
      });

      if (result.count === 0) {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { id: true },
        });

        if (!user) {
          throw new NotFoundException(
            'Пользователь не найден',
          );
        }

        throw new ConflictException(
          'Активировать можно только пользователя со статусом PENDING',
        );
      }

      await tx.securityAuditEvent.create({
        data: {
          actorId,
          targetUserId: userId,
          action: 'USER_ACTIVATED',
        },
      });

      return tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: adminUserSelect,
      });
    });
  }

  // Блокировка пользователя
  async block(userId: string, actorId: string) {
    if (userId === actorId) {
      throw new ForbiddenException(
        'Нельзя заблокировать собственную учётную запись',
      );
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const actor = await tx.user.findUnique({
            where: { id: actorId },
            select: {
              role: true,
              status: true,
            },
          });

          if (
            !actor ||
            actor.role !== 'ADMIN' ||
            actor.status !== 'ACTIVE'
          ) {
            throw new ForbiddenException(
              'Недостаточно прав администратора',
            );
          }

          const target = await tx.user.findUnique({
            where: { id: userId },
            select: {
              role: true,
              status: true,
            },
          });

          if (!target) {
            throw new NotFoundException(
              'Пользователь не найден',
            );
          }

          if (target.status !== 'ACTIVE') {
            throw new ConflictException(
              'Заблокировать можно только активного пользователя',
            );
          }

          // Защита последнего администратора
          if (target.role === 'ADMIN') {
            const activeAdmins = await tx.user.count({
              where: {
                role: 'ADMIN',
                status: 'ACTIVE',
              },
            });

            if (activeAdmins <= 1) {
              throw new ConflictException(
                'Нельзя заблокировать последнего активного администратора',
              );
            }
          }

          // Меняем статус только при совпадении
          // проверенного состояния пользователя
          const result = await tx.user.updateMany({
            where: {
              id: userId,
              status: 'ACTIVE',
              role: target.role,
            },
            data: {
              status: 'BLOCKED',
            },
          });

          if (result.count !== 1) {
            throw new ConflictException(
              'Состояние пользователя изменилось. Повторите операцию.',
            );
          }

          // Записываем блокировку в журнал
          await tx.securityAuditEvent.create({
            data: {
              actorId,
              targetUserId: userId,
              action: 'USER_BLOCKED',
            },
          });

          return tx.user.findUniqueOrThrow({
            where: { id: userId },
            select: adminUserSelect,
          });
        },
        {
          isolationLevel: 'Serializable',
        },
      );
    } catch (error: unknown) {
      // Конкурирующие транзакции могут вызвать
      // Prisma P2034. Не раскрываем внутреннюю
      // ошибку БД пользователю.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2034'
      ) {
        throw new ConflictException(
          'Данные пользователя изменились. Повторите операцию.',
        );
      }

      throw error;
    }
  }
}
