import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSupplierOfferDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  supplierName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  contact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsUrl({
    require_protocol: true,
  })
  website?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryPrice?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  deliveryDays?: number;

  @IsOptional()
  @IsBoolean()
  inStock?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}