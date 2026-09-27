import { IsNotEmpty, IsString } from 'class-validator';

export class JoinTeamDto {
  @IsString()
  @IsNotEmpty({ message: '초대 링크(토큰)를 입력해주세요.' })
  inviteToken: string;
}
