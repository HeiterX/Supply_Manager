import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

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
}