import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import {
  TaskPriority,
  TaskStatus,
} from '../../generated/prisma/enums.js';

export class UpdateTaskDto {
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  nextAction?: string;

  @IsOptional()
  @IsDateString()
  reminderAt?: string;
}