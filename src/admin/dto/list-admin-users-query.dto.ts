import { IsOptional, IsString } from 'class-validator';

// Spec 10.3: 닉네임·이메일로 회원을 찾는다.
export class ListAdminUsersQueryDto {
  @IsOptional()
  @IsString()
  nickname?: string;

  @IsOptional()
  @IsString()
  email?: string;
}
