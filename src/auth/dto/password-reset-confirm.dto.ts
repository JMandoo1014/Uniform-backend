import { IsString } from 'class-validator';
import { IsValidPassword } from '../../common/validators/password.validator';

export class PasswordResetConfirmDto {
  @IsString()
  token: string;

  @IsValidPassword()
  newPassword: string;
}
