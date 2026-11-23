import {
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RejectPurchaseRequestDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(1500)
  reason!: string;
}
