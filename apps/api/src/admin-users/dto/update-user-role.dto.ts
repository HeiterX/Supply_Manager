import { IsIn } from 'class-validator';

export class UpdateUserRoleDto {
  @IsIn(['EMPLOYEE', 'PROCUREMENT', 'ADMIN'])
  role!: 'EMPLOYEE' | 'PROCUREMENT' | 'ADMIN';
}
