import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const fulfillmentActions = [
  'enable-ledger',
  'create-invoice',
  'edit-invoice',
  'approve-invoice',
  'cancel-invoice',
  'register-payment',
  'cancel-payment',
  'create-shipment',
  'dispatch-shipment',
  'arrive-shipment',
  'cancel-shipment',
  'short-close-shipment',
  'receive',
  'return',
  'handover',
  'report-discrepancy',
  'resolve-discrepancy',
] as const;

export const moneyPattern = /^\d{1,12}(?:\.\d{1,2})?$/;
export const quantityPattern = /^\d{1,11}(?:\.\d{1,3})?$/;

class ShipmentLineDto {
  @IsUUID()
  itemId!: string;

  @Matches(quantityPattern)
  quantity!: string;
}

const supplied = (_: unknown, value: unknown) => value !== undefined;

export class FulfillmentDto {
  @IsUUID('4')
  key!: string;

  @IsIn(fulfillmentActions)
  action!: (typeof fulfillmentActions)[number];

  @ValidateIf(supplied)
  @IsUUID()
  targetId?: string;

  @ValidateIf(supplied)
  @IsString()
  @MaxLength(120)
  number?: string;

  @ValidateIf(supplied)
  @Matches(moneyPattern)
  amount?: string;

  @ValidateIf(supplied)
  @Matches(/^[A-Z]{3}$/)
  currency?: string;

  @ValidateIf(supplied)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ValidateIf(supplied)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  expectedOn?: string;

  @ValidateIf(supplied)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueOn?: string;

  @ValidateIf(supplied)
  @Matches(quantityPattern)
  quantity?: string;

  @ValidateIf(supplied)
  @IsString()
  @MaxLength(240)
  carrier?: string;

  @ValidateIf(supplied)
  @IsString()
  @MaxLength(160)
  trackingNumber?: string;

  @ValidateIf(supplied)
  @IsString()
  @MaxLength(1500)
  comment?: string;

  @ValidateIf(supplied)
  @IsIn(['SHORTAGE', 'DAMAGED', 'WRONG_ITEM', 'INCOMPLETE', 'OTHER'])
  reason?: string;

  @ValidateIf(supplied)
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShipmentLineDto)
  items?: ShipmentLineDto[];
}
