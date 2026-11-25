import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsInt, IsNumber,
  IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class UpdatePurchaseOrderItemDto {
  @IsUUID()
  supplierOfferItemId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;
}

export class UpdatePurchaseOrderDto {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  invoiceNumber?: string;

  @IsOptional()
  @IsDateString()
  invoiceDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => UpdatePurchaseOrderItemDto)
  items!: UpdatePurchaseOrderItemDto[];
}
