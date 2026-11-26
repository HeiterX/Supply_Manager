import {
  BadRequestException, ConflictException, ForbiddenException, Injectable,
  NotFoundException, OnModuleDestroy, OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, type NextAction } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TelegramDeliveryService } from '../telegram/telegram-delivery.service.js';
import { ActionInputDto } from './action-input.dto.js';

// A consistent server-owned definition of "today" for the procurement workspace.
// Europe/Moscow has remained UTC+3 since 2014; IANA zone is returned to clients.
const TIME_ZONE = 'Europe/Moscow';
function sqlSchema() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not defined');
  const schema = new URL(url).searchParams.get('schema') ?? 'public';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error('Invalid PostgreSQL schema identifier');
  return schema;
}
async function actionSearchPath(tx: Prisma.TransactionClient) {
  const path = '"' + sqlSchema() + '", public';
  await tx.$queryRaw`SELECT pg_catalog.set_config('search_path', ${path}, true)`;
}
const day = (now: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
function todayRange(now: Date) {
  const iso = day(now);
  const start = new Date(iso + 'T00:00:00+03:00');
  return { start, end: new Date(start.getTime() + 86_400_000) };
}
const activeTask: Prisma.TaskWhereInput = { status: { notIn: ['CLOSED', 'CANCELLED'] } };
const waiting: Prisma.TaskWhereInput = { supplierOffers: { some: { status: { in: ['REQUESTED', 'WAITING_RESPONSE'] } } } };

type ActionRow = NextAction & {
  task: { id: string; number: number; title: string; priority: string; status: string; supplierOffers?: { id: string }[] };
  assignee: { id: string; fullName: string } | null;
};
type Normalized = { title: string; assigneeId: string | null; dueAt: Date | null; reminderAt: Date | null };

function readVersion(value: string | undefined) {
  if (!value || !/^"[1-9]\d*"$/.test(value)) throw new BadRequestException('Укажите If-Match с актуальной версией действия');
  return Number(value.slice(1, -1));
}
function checkKey(value: string | undefined) {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
    throw new BadRequestException('Необходим Idempotency-Key (UUID)');
  return value;
}
function parseDate(value: string | null | undefined, current: Date | null) {
  if (value === undefined) return current;
  if (value === null) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new BadRequestException('Неверная дата');
  return parsed;
}
function isEditable(row: ActionRow, user: AuthUser) {
  return user.role === 'ADMIN' || row.assigneeId === user.id || row.assigneeId === null;
}
function visibleWhere(user: AuthUser, scope: string) {
  if (scope === 'all' && user.role === 'ADMIN') return {};
  if (scope === 'unassigned') return { assigneeId: null };
  return { assigneeId: user.id };
}
const viewInclude = {
  task: { select: { id: true, number: true, title: true, status: true, priority: true,
    supplierOffers: { where: { status: { in: ['REQUESTED', 'WAITING_RESPONSE'] } }, select: { id: true }, take: 1 } } },
  assignee: { select: { id: true, fullName: true } },
} satisfies Prisma.NextActionInclude;

@Injectable()
export class NextActionsService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  constructor(private readonly prisma: PrismaService, private readonly telegram: TelegramDeliveryService) {}
  onModuleInit() {
    if (process.env.NODE_ENV !== 'test') this.plan();
  }
  onModuleDestroy() { this.stopping = true; clearTimeout(this.timer); }
  private plan() {
    this.timer = setTimeout(() => {
      void this.dispatchDue().catch(() => { /* worker retries next tick; never fail the web request */ })
        .finally(() => { if (!this.stopping) this.plan(); });
    }, 60_000);
    this.timer.unref();
  }
  private toView(row: ActionRow, user: AuthUser, now = new Date()) {
    const { start, end } = todayRange(now);
    const due = row.dueAt?.getTime();
    const status = row.status !== 'ACTIVE' ? row.status
      : due !== undefined && due < now.getTime() ? 'OVERDUE'
      : due !== undefined && due >= start.getTime() && due < end.getTime() ? 'TODAY'
      : row.task.supplierOffers?.length ? 'WAITING_SUPPLIER' : 'PLANNED';
    return {
      id: row.id, title: row.title, version: row.version, status,
      assignee: row.assignee, dueAt: row.dueAt, reminderAt: row.reminderAt,
      task: { id: row.task.id, number: row.task.number, title: row.task.title },
      priority: row.task.priority,
      allowedOperations: row.status === 'ACTIVE' && row.task.status !== 'CLOSED' && row.task.status !== 'CANCELLED'
        && isEditable(row, user) ? ['UPDATE', 'COMPLETE'] : [],
    };
  }
  private async activeOwner(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true, status: true, role: true } });
    if (!user || user.status !== 'ACTIVE' || !['ADMIN','PROCUREMENT'].includes(user.role))
      throw new BadRequestException('Ответственный должен быть активным снабженцем или администратором');
  }
  private verifyAccess(row: ActionRow, user: AuthUser) {
    if (user.role === 'EMPLOYEE' || (user.role !== 'ADMIN' && row.assigneeId !== user.id && row.assigneeId !== null))
      throw new NotFoundException('Действие не найдено');
  }
  async assignees() {
    return this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { in: ['PROCUREMENT', 'ADMIN'] } },
      select: { id: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' }, take: 500,
    });
  }
  async list(user: AuthUser, scope = 'mine', filter = 'all', q = '', page = 1, limit = 20) {
    if (!['mine','all','unassigned'].includes(scope)) throw new BadRequestException('Неверная область действий');
    if (scope === 'all' && user.role !== 'ADMIN') throw new ForbiddenException('Полный список доступен администратору');
    if (!['all','today','overdue','waiting_supplier'].includes(filter)) throw new BadRequestException('Неверный фильтр');
    if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException('Неверная пагинация');
    const now = new Date(), { end } = todayRange(now);
    const base: Prisma.NextActionWhereInput = {
      status: 'ACTIVE', task: activeTask, ...visibleWhere(user, scope),
    };
    const overdue: Prisma.NextActionWhereInput = { dueAt: { lt: now } };
    const today: Prisma.NextActionWhereInput = { dueAt: { gte: now, lt: end } };
    const waitingSupplier: Prisma.NextActionWhereInput = {
      OR: [{ dueAt: null }, { dueAt: { gte: end } }],
      task: { ...activeTask, ...waiting },
    };
    const filters: Record<string, Prisma.NextActionWhereInput> = {
      all: {}, today, overdue, waiting_supplier: waitingSupplier,
    };
    const search: Prisma.NextActionWhereInput = q.trim().slice(0,200)
      ? { OR: [
        { title: { contains: q.trim().slice(0,200), mode: 'insensitive' } },
        { task: { title: { contains: q.trim().slice(0,200), mode: 'insensitive' } } },
        ...(/^\d+$/.test(q.trim()) && Number.isSafeInteger(Number(q.trim()))
          ? [{ task: { number: Number(q.trim()) } }] : []),
      ] } : {};
    const where: Prisma.NextActionWhereInput = { AND: [base, filters[filter], search] };
    const [all, todayCount, overdueCount, waitingCount, total, items] = await this.prisma.$transaction([
      this.prisma.nextAction.count({ where: base }),
      this.prisma.nextAction.count({ where: { AND: [base, today] } }),
      this.prisma.nextAction.count({ where: { AND: [base, overdue] } }),
      this.prisma.nextAction.count({ where: { AND: [base, waitingSupplier] } }),
      this.prisma.nextAction.count({ where }),
      this.prisma.nextAction.findMany({
        where, include: viewInclude, orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        skip: (page - 1) * limit, take: limit,
      }),
    ]);
    return { items: items.map(item => this.toView(item as ActionRow, user, now)),
      counts: { all, today: todayCount, overdue: overdueCount, waiting_supplier: waitingCount },
      total, page, pageSize: limit, timeZone: TIME_ZONE };
  }
  async byTask(user: AuthUser, taskId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
    if (!task) throw new NotFoundException('Закупка не найдена');
    const action = await this.prisma.nextAction.findFirst({
      where: { taskId, status: 'ACTIVE' }, include: viewInclude,
    });
    if (action) this.verifyAccess(action as ActionRow, user);
    const lastAction = action ? null : await this.prisma.nextAction.findFirst({
      where: { taskId, ...(user.role === 'ADMIN' ? {} : { OR: [{ assigneeId: user.id }, { assigneeId: null }] }) },
      select: { id: true }, orderBy: { createdAt: 'desc' },
    });
    return { action: action ? this.toView(action as ActionRow, user) : null,
      lastActionId: lastAction?.id ?? null, timeZone: TIME_ZONE };
  }
  async history(user: AuthUser, id: string) {
    const row = await this.prisma.nextAction.findUnique({ where: { id }, include: viewInclude });
    if (!row) throw new NotFoundException('Действие не найдено');
    this.verifyAccess(row as ActionRow, user);
    const items = await this.prisma.nextActionHistory.findMany({
      where: { actionId: id }, orderBy: { createdAt: 'desc' }, take: 200,
      include: { actor: { select: { fullName: true } } },
    });
    return { items: items.map(({ actor, id, type, createdAt, comment }) => ({ id, type, createdAt, comment, actor })) };
  }
  private async prepare(input: ActionInputDto, current: NextAction | null, actor: AuthUser): Promise<Normalized> {
    const title = input.title !== undefined ? input.title.trim() : current?.title;
    if (!title || title.length > 500) throw new BadRequestException('Укажите следующее действие (1–500 символов)');
    const assigneeId = input.assigneeId === undefined ? (current?.assigneeId ?? actor.id) : input.assigneeId;
    if (assigneeId) {
      if (actor.role !== 'ADMIN' && assigneeId !== actor.id) throw new ForbiddenException('Нельзя назначить другого сотрудника');
      if (current?.assigneeId && actor.role !== 'ADMIN' && assigneeId !== current.assigneeId)
        throw new ForbiddenException('Переназначение доступно администратору');
      await this.activeOwner(assigneeId);
    } else if (actor.role !== 'ADMIN') throw new ForbiddenException('Снять ответственного может только администратор');
    const dueAt = parseDate(input.dueAt, current?.dueAt ?? null);
    const reminderAt = parseDate(input.reminderAt, current?.reminderAt ?? null);
    if (dueAt && reminderAt && reminderAt > dueAt)
      throw new BadRequestException('Напоминание должно быть не позже срока действия');
    return { title, assigneeId, dueAt, reminderAt };
  }
  private async notice(tx: Prisma.TransactionClient, actionId: string, userId: string | null, key: string,
    type: string, title: string, message: string | null, path: string) {
    if (!userId) return;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true, role: true } });
    if (!user || user.status !== 'ACTIVE' || !['ADMIN','PROCUREMENT'].includes(user.role)) return;
    await tx.nextActionNotification.createMany({
      data: [{ actionId, userId, eventKey: key, type, title, message }], skipDuplicates: true,
    });
    // Reuse the existing CORE-10 transactional outbox. No second Telegram sender.
    await this.telegram.publish(tx, {
      id: key, category: type === 'ACTION_OVERDUE' ? 'OVERDUE'
        : type === 'ACTION_DUE' ? 'DUE_SOON' : 'ASSIGNED_ACTION',
      recipientIds: [userId], text: title, path,
    });
  }
  async create(user: AuthUser, taskId: string, dto: ActionInputDto) {
    return this.prisma.$transaction(async tx => {
      await actionSearchPath(tx);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Task" WHERE "id" = ${taskId} FOR UPDATE`);
      const task = await tx.task.findUnique({ where: { id: taskId } });
      if (!task) throw new NotFoundException('Закупка не найдена');
      if (['CLOSED','CANCELLED'].includes(task.status)) throw new ConflictException('Закупка завершена');
      if (await tx.nextAction.count({ where: { taskId, status: 'ACTIVE' } }))
        throw new ConflictException('Сначала завершите текущее действие');
      const data = await this.prepare(dto, null, user);
      const action = await tx.nextAction.create({
        data: { ...data, taskId, history: { create: { type: 'CREATED', actorId: user.id } } }, include: viewInclude,
      });
      await this.notice(tx, action.id, action.assigneeId, 'core09:' + action.id + ':1:ASSIGNED',
        'ACTION_CREATED', 'Назначено действие: ' + action.title, null, '/tasks/' + taskId);
      return this.toView(action as ActionRow, user);
    });
  }
  async change(user: AuthUser, id: string, dto: ActionInputDto, match: string | undefined, key: string | undefined,
    complete = false) {
    const expected = readVersion(match), operationKey = checkKey(key);
    const fingerprint = createHash('sha256').update(JSON.stringify([complete, dto])).digest('hex');
    return this.prisma.$transaction(async tx => {
      await actionSearchPath(tx);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "NextAction" WHERE "id" = ${id} FOR UPDATE`);
      const row = await tx.nextAction.findUnique({ where: { id }, include: viewInclude });
      if (!row) throw new NotFoundException('Действие не найдено');
      this.verifyAccess(row as ActionRow, user);
      if (!isEditable(row as ActionRow, user)) throw new ForbiddenException('Недостаточно прав');
      const previous = await tx.nextActionMutation.findUnique({ where: { actionId_key: { actionId: id, key: operationKey } } });
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ConflictException('Ключ операции использован с другим содержимым');
        return previous.response;
      }
      if (row.version !== expected || row.status !== 'ACTIVE' || ['CLOSED','CANCELLED'].includes(row.task.status))
        throw new ConflictException('Действие изменено или закупка закрыта. Обновите данные');
      const normalized = complete ? null : await this.prepare(dto, row, user);
      const updateData = complete ? { status: 'COMPLETED', version: { increment: 1 } }
        : { ...normalized!, version: { increment: 1 } };
      const updated = await tx.nextAction.update({ where: { id }, data: updateData, include: viewInclude });
      const event = complete ? 'COMPLETED'
        : updated.assigneeId !== row.assigneeId ? 'ASSIGNED'
        : updated.dueAt?.getTime() !== row.dueAt?.getTime() || updated.reminderAt?.getTime() !== row.reminderAt?.getTime()
          ? 'RESCHEDULED' : 'UPDATED';
      await tx.nextActionHistory.create({ data: { actionId: id, actorId: user.id, type: event } });
      // Stale queued messages cannot survive a version change or completion.
      await tx.telegramDelivery.updateMany({
        where: { eventKey: { startsWith: 'core09:' + id + ':' }, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      if (updated.assigneeId && (updated.assigneeId !== row.assigneeId || complete)) {
        await this.notice(tx, id, updated.assigneeId, 'core09:' + id + ':' + updated.version + ':' + event,
          complete ? 'ACTION_COMPLETED' : 'ASSIGNEE_CHANGED',
          complete ? 'Действие выполнено: ' + updated.title : 'Вам назначено действие: ' + updated.title,
          null, '/tasks/' + updated.taskId);
      }
      const result = this.toView(updated as ActionRow, user);
      await tx.nextActionMutation.create({
        data: { actionId: id, key: operationKey, fingerprint, response: result as unknown as Prisma.InputJsonValue },
      });
      return result;
    });
  }
  async notifications(user: AuthUser, filter = 'all', page = 1, limit = 20) {
    if (!['all','read','unread'].includes(filter)) throw new BadRequestException('Неверный фильтр');
    if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException('Неверная пагинация');
    const where: Prisma.NextActionNotificationWhereInput = {
      userId: user.id, action: { assigneeId: user.id }, ...(filter === 'read' ? { readAt: { not: null } } : filter === 'unread' ? { readAt: null } : {}),
    };
    const [items, total, unreadCount] = await this.prisma.$transaction([
      this.prisma.nextActionNotification.findMany({
        where, include: { action: { include: { task: { select: { id: true, number: true, title: true } } } } },
        orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit,
      }),
      this.prisma.nextActionNotification.count({ where }),
      this.prisma.nextActionNotification.count({ where: { userId: user.id, action: { assigneeId: user.id }, readAt: null } }),
    ]);
    return {
      items: items.map(item => ({ id: item.id, type: item.type, title: item.title,
        message: item.message, task: item.action.task, readAt: item.readAt, createdAt: item.createdAt })),
      total, unreadCount, page, pageSize: limit,
    };
  }
  async readNotification(user: AuthUser, id: string) {
    const changed = await this.prisma.nextActionNotification.updateMany({
      where: { id, userId: user.id, action: { assigneeId: user.id }, readAt: null }, data: { readAt: new Date() },
    });
    if (!changed.count) {
      const exists = await this.prisma.nextActionNotification.findFirst({ where: { id, userId: user.id, action: { assigneeId: user.id } }, select: { id: true } });
      if (!exists) throw new NotFoundException('Уведомление не найдено');
    }
    return { ok: true };
  }
  // Idempotent scheduler across NestJS replicas: action lock + (action, version, kind) unique receipt.
  async dispatchDue(now = new Date()) {
    const actionTable = Prisma.raw('"' + sqlSchema() + '"."NextAction"');
    const taskTable = Prisma.raw('"' + sqlSchema() + '"."Task"');
    const receiptTable = Prisma.raw('"' + sqlSchema() + '"."NextActionScheduleReceipt"');
    const ids = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT a."id" FROM ${actionTable} a JOIN ${taskTable} t ON t."id"=a."taskId"
      WHERE a."status"='ACTIVE' AND a."assigneeId" IS NOT NULL
        AND t."status" NOT IN ('CLOSED','CANCELLED')
        AND (
          (a."reminderAt" <= ${now} AND NOT EXISTS
            (SELECT 1 FROM ${receiptTable} r
             WHERE r."actionId"=a."id" AND r."version"=a."version" AND r."kind"='ACTION_DUE'))
          OR (a."dueAt" < ${now} AND NOT EXISTS
            (SELECT 1 FROM "NextActionScheduleReceipt" r
             WHERE r."actionId"=a."id" AND r."version"=a."version" AND r."kind"='ACTION_OVERDUE'))
        ) ORDER BY COALESCE(a."reminderAt",a."dueAt") ASC LIMIT 50
    `);
    for (const { id } of ids) {
      if (this.stopping) break;
      await this.prisma.$transaction(async tx => {
        await actionSearchPath(tx);
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "NextAction" WHERE "id" = ${id} FOR UPDATE`);
        const action = await tx.nextAction.findUnique({ where: { id }, include: viewInclude });
        if (!action || action.status !== 'ACTIVE' || !action.assigneeId ||
          ['CLOSED','CANCELLED'].includes(action.task.status)) return;
        const target = await tx.user.findUnique({
          where: { id: action.assigneeId }, select: { id: true, status: true, role: true },
        });
        if (target?.status !== 'ACTIVE' || !['ADMIN','PROCUREMENT'].includes(target.role ?? '')) return;
        const types = [
          action.reminderAt && action.reminderAt <= now ? 'ACTION_DUE' : null,
          action.dueAt && action.dueAt < now ? 'ACTION_OVERDUE' : null,
        ].filter((kind): kind is string => kind !== null);
        for (const kind of types) {
          const inserted = await tx.nextActionScheduleReceipt.createMany({
            data: [{ actionId: id, version: action.version, kind }], skipDuplicates: true,
          });
          if (!inserted.count) continue;
          await this.notice(tx, id, target.id, 'core09:' + id + ':' + action.version + ':' + kind,
            kind, kind === 'ACTION_OVERDUE' ? 'Просрочено: ' + action.title : 'Напоминание: ' + action.title,
            null, '/tasks/' + action.taskId);
        }
      }, { timeout: 15000 });
    }
    return ids.length;
  }
}
