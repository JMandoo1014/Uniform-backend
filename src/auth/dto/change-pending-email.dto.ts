import { IsEmail, IsString } from 'class-validator';

export class ChangePendingEmailDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsEmail()
  newEmail: string;
}
