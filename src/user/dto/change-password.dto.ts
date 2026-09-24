import { IsString } from 'class-validator';
import { IsValidPassword } from '../../common/validators/password.validator';

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsValidPassword()
  newPassword: string;
}
