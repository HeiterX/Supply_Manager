import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

/*
 * DTO существующей внутренней формы.
 * Оставляем для обратной совместимости.
 */
export class CreatePurchaseRequestItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  partNumber?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unit!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreatePurchaseRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string;

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsOptional()
  @IsISO8601()
  requiredAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseRequestItemDto)
  items!: CreatePurchaseRequestItemDto[];
}

/*
 * Упрощённая публичная форма работника.
 */
export class CreatePublicPurchaseRequestItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  name!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unit!: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string;
}

export class CreatePublicPurchaseRequestDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(120)
  requesterName!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreatePublicPurchaseRequestItemDto)
  items!: CreatePublicPurchaseRequestItemDto[];
}
