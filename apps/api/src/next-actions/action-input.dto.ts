import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

// Null intentionally clears a date or assignee; omitted fields preserve their values.
export class ActionInputDto {
  @IsOptional() @IsString() @MaxLength(500)
  title?: string;
  @IsOptional() @IsUUID()
  assigneeId?: string | null;
  @IsOptional() @IsISO8601()
  dueAt?: string | null;
  @IsOptional() @IsISO8601()
  reminderAt?: string | null;
}
