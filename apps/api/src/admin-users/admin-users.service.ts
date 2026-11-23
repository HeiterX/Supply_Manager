import {
  ConflictException,
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
  constructor(private readonly prisma: PrismaService) {}

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
}
