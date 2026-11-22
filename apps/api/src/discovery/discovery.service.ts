import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  entities,
  type Entity,
  type ListQuery,
  type SearchQuery,
} from './discovery.dto.js';
import { attentionRules, overdueTasks, taskView } from './discovery.filters.js';
import {
  makeSelection,
  matchingNumbers,
  taskSelect,
  type SearchHit,
} from './discovery.selections.js';

type PrismaTaskSummary = Prisma.TaskGetPayload<{ select: typeof taskSelect }>;

const snapshot = { isolationLevel: 'RepeatableRead', timeout: 10000 } as const;
export const exportLimit = 2000;

function pagination(total: number, q: SearchQuery) {
  return {
    total,
    page: q.page,
    pageSize: q.pageSize,
    hasPrevious: q.page > 1,
    hasNext: q.page * q.pageSize < total,
  };
}

function enforceAccess(user: AuthUser, entity: Entity) {
  if (user.role === 'EMPLOYEE' && entity !== 'requests')
    throw new ForbiddenException();
}

@Injectable()
export class DiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(now = new Date()) {
    return this.prisma.$transaction(async (db) => {
      const activeWhere = taskView('active', now);
      const active = await db.task.count({ where: activeWhere });
      const attention = await db.task.count({
        where: taskView('attention', now),
      });
      const overdue = await db.task.count({ where: overdueTasks(now) });
      const inTransit = await db.task.count({
        where: taskView('logistics', now),
      });
      const attentionTasks = new Map<string, PrismaTaskSummary>();
      for (const rule of attentionRules(now)) {
        if (attentionTasks.size >= 6) break;
        const rows = await db.task.findMany({
          where: { AND: [activeWhere, rule] },
          take: 6,
          select: taskSelect,
          orderBy: [
            { deadline: { sort: 'asc', nulls: 'last' } },
            { id: 'asc' },
          ],
        });
        for (const row of rows) {
          if (attentionTasks.size >= 6) break;
          attentionTasks.set(row.id, row);
        }
      }
      return {
        active,
        attention,
        overdue,
        inTransit,
        attentionTasks: [...attentionTasks.values()],
      };
    }, snapshot);
  }

  async supplier(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        contact: true,
        email: true,
        phone: true,
        website: true,
      },
    });
    if (!supplier) throw new NotFoundException('Поставщик не найден');
    return supplier;
  }

  async search(user: AuthUser, q: SearchQuery) {
    if (!q.q) return { items: [], ...pagination(0, q) };
    const allowed =
      user.role === 'EMPLOYEE' ? (['requests'] as const) : entities;
    return this.prisma.$transaction(async (db) => {
      const { tasks, requests } = await matchingNumbers(db, user, q.q);
      const now = new Date();
      const selections = allowed.map((entity) =>
        makeSelection(
          db,
          entity,
          user,
          q,
          now,
          entity === 'requests' ? requests : tasks,
        ),
      );
      let skip = (q.page - 1) * q.pageSize;
      let total = 0;
      const items: SearchHit[] = [];
      for (const selection of selections) {
        const count = await selection.count();
        total += count;
        if (skip < count && items.length < q.pageSize) {
          items.push(
            ...(await selection.hits({
              skip,
              take: Math.min(q.pageSize - items.length, count - skip),
            })),
          );
        }
        skip = Math.max(0, skip - count);
      }
      return { items, ...pagination(total, q) };
    }, snapshot);
  }

  async list(user: AuthUser, entity: Entity, q: ListQuery) {
    enforceAccess(user, entity);
    return this.prisma.$transaction(async (db) => {
      const { tasks, requests } = await matchingNumbers(db, user, q.q, entity);
      const selection = makeSelection(
        db,
        entity,
        user,
        q,
        new Date(),
        entity === 'requests' ? requests : tasks,
      );
      const total = await selection.count();
      const skip = (q.page - 1) * q.pageSize;
      const items =
        skip >= total ? [] : await selection.rows({ skip, take: q.pageSize });
      return { items, ...pagination(total, q) };
    }, snapshot);
  }

  async export(user: AuthUser, entity: Entity, q: ListQuery) {
    enforceAccess(user, entity);
    return this.prisma.$transaction(async (db) => {
      const { tasks, requests } = await matchingNumbers(db, user, q.q, entity);
      const selection = makeSelection(
        db,
        entity,
        user,
        q,
        new Date(),
        entity === 'requests' ? requests : tasks,
      );
      if ((await selection.count()) > exportLimit) {
        throw new PayloadTooLargeException(
          `Выгрузка ограничена ${exportLimit} строками. Уточните фильтры`,
        );
      }
      return {
        headings: selection.headings,
        rows: await selection.exportRows({ take: exportLimit }),
      };
    }, snapshot);
  }
}
