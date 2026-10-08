import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreatePurchaseOrderItemDto {
  @IsUUID()
  supplierOfferItemId!: string;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;
}

export class CreatePurchaseOrderDto {
  @IsString()
  @MinLength(1, {
    message: 'Необходимо указать номер счёта',
  })
  @MaxLength(100)
  invoiceNumber!: string;

  @IsDateString(
    {},
    {
      message: 'Необходимо указать корректную дату счёта',
    },
  )
  invoiceDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /*
   * Для нового многопоставочного сценария.
   *
   * Пока поле необязательное, чтобы старый endpoint
   * оформления заказа продолжал работать.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderItemDto)
  items?: CreatePurchaseOrderItemDto[];
}
