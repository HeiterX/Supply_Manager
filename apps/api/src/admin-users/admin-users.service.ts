
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { AuthUser } from '../auth/auth.types.js';
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

function isTransactionConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2034'
  );
}

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: adminUserSelect,
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });
  }

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
      if (isTransactionConflict(error)) {
        throw new ConflictException(
          'Данные пользователя изменились. Повторите операцию.',
        );
      }

      throw error;
    }
  }

  async changeRole(
    userId: string,
    actorId: string,
    newRole: AuthUser['role'],
  ) {
    if (userId === actorId) {
      throw new ForbiddenException(
        'Нельзя изменять собственную роль',
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

          if (target.role === newRole) {
            throw new ConflictException(
              'У пользователя уже назначена эта роль',
            );
          }

          if (
            target.role === 'ADMIN' &&
            target.status === 'ACTIVE' &&
            newRole !== 'ADMIN'
          ) {
            const activeAdmins = await tx.user.count({
              where: {
                role: 'ADMIN',
                status: 'ACTIVE',
              },
            });

            if (activeAdmins <= 1) {
              throw new ConflictException(
                'Нельзя изменить роль последнего активного администратора',
              );
            }
          }

          const result = await tx.user.updateMany({
            where: {
              id: userId,
              role: target.role,
              status: target.status,
            },
            data: {
              role: newRole,
            },
          });

          if (result.count !== 1) {
            throw new ConflictException(
              'Данные пользователя изменились. Повторите операцию.',
            );
          }

          await tx.securityAuditEvent.create({
            data: {
              actorId,
              targetUserId: userId,
              action:
                `USER_ROLE_CHANGED_${target.role}_TO_${newRole}`,
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
      if (isTransactionConflict(error)) {
        throw new ConflictException(
          'Конкурирующее изменение пользователя. Повторите операцию.',
        );
      }

      throw error;
    }
  }
}
