import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ShipPurchaseOrderDto {
  @IsDateString()
  shippedAt!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  carrier!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  trackingNumber?: string;

  @IsOptional()
  @IsDateString()
  expectedDeliveryAt?: string;
}