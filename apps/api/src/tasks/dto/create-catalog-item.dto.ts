import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateCatalogItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  partNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  unit!: string;

  // Валидация содержимого выполняется отдельно в сервисе,
  // чтобы запрещать вложенные объекты и неоднозначные атрибуты.
  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;
}
