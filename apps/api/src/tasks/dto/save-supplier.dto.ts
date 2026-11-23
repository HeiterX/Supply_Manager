import {
  ArrayMaxSize, IsArray, IsEmail, IsEnum, IsOptional, IsString,
  IsUUID, Matches, MaxLength, MinLength,
} from 'class-validator';
import { SupplierDirectoryStatus } from '../../generated/prisma/enums.js';

export class SaveSupplierDto {
  @IsString() @MinLength(2) @MaxLength(300)
  name!: string;

  @IsOptional() @Matches(/^(?:[0-9]{10}|[0-9]{12})$/)
  taxId?: string;

  @IsOptional() @IsString() @MaxLength(500)
  legalAddress?: string;

  @IsOptional() @IsString() @MaxLength(500)
  bankDetails?: string;

  @IsOptional() @IsString() @MaxLength(300)
  contact?: string;

  @IsOptional() @IsString() @MaxLength(100)
  phone?: string;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsString() @MaxLength(500)
  website?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  categories?: string[];

  @IsOptional() @IsEnum(SupplierDirectoryStatus)
  status?: SupplierDirectoryStatus;

  @IsOptional() @IsUUID()
  responsibleId?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}
