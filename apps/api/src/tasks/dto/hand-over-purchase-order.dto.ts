import {
  IsNotEmpty,
  IsString,
  MaxLength,
} from 'class-validator';

export class HandOverPurchaseOrderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  handedOverTo!: string;
}