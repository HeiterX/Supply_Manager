import { BadRequestException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const entities = [
  'tasks',
  'items',
  'suppliers',
  'orders',
  'requests',
] as const;
export type Entity = (typeof entities)[number];
export const sorts = [
  'createdAt',
  'deadline',
  'priority',
  'status',
  'number',
  'name',
] as const;
export type Sort = (typeof sorts)[number];
export const formats = ['csv', 'xlsx'] as const;
export type Format = (typeof formats)[number];
// eslint-disable-next-line no-control-regex -- PostgreSQL text accepts no null character.
const plainText = /^[^\x00-\x1f\x7f]*$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export class SearchQuery {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(120)
  @Matches(plainText)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;
}

export class ListQuery extends SearchQuery {
  @IsOptional() @IsIn(['active', 'attention', 'logistics']) view?:
    'active' | 'attention' | 'logistics';
  @IsOptional() @IsIn(sorts) sort?: Sort;
  @IsOptional() @IsIn(['asc', 'desc']) direction?: 'asc' | 'desc';
  @IsOptional() @IsString() @MaxLength(32) status?: string;
  @IsOptional() @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']) priority?:
    'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Matches(plainText)
  supplier?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsIn(['true', 'false']) hasOrders?: 'true' | 'false';
  @IsOptional() @IsIn(['true', 'false']) overdue?: 'true' | 'false';
  @IsOptional() @IsIn(['paid', 'unpaid']) payment?: 'paid' | 'unpaid';
  @IsOptional() @IsString() @MaxLength(32) delivery?: string;
  @IsOptional() @IsIn(formats) format?: Format;

  @IsOptional()
  @Matches(datePattern)
  @IsDateString({ strict: true })
  createdFrom?: string;
  @IsOptional()
  @Matches(datePattern)
  @IsDateString({ strict: true })
  createdTo?: string;
  @IsOptional()
  @Matches(datePattern)
  @IsDateString({ strict: true })
  deadlineFrom?: string;
  @IsOptional()
  @Matches(datePattern)
  @IsDateString({ strict: true })
  deadlineTo?: string;
}

export class ReportQuery {
  @IsOptional()
  @Matches(datePattern)
  @IsDateString({ strict: true })
  from?: string;
  @IsOptional()
  @Matches(datePattern)
  @IsDateString({ strict: true })
  to?: string;
  @IsOptional() @IsIn(formats) format?: Format;
}

// The calendar used by the ERP reports and exported timestamps.
export const reportTimeZone = 'Europe/Moscow';

export function dateRange(from?: string, to?: string) {
  if (from && to && from > to) {
    throw new BadRequestException(
      'Начало периода должно предшествовать окончанию',
    );
  }
  const gte = from ? new Date(`${from}T00:00:00+03:00`) : undefined;
  const lt = to
    ? new Date(new Date(`${to}T00:00:00+03:00`).getTime() + 86400000)
    : undefined;
  return gte || lt ? { gte, lt } : undefined;
}

export function isEntity(value: string): value is Entity {
  return entities.some((entity) => entity === value);
}
