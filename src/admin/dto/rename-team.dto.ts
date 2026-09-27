import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// 관리자 콘솔 "팀 이름 강제 변경": 새 이름은 서버가 "팀+숫자 5자리"로 만든다.
export class RenameTeamDto {
  @IsString()
  @IsNotEmpty({ message: '사유를 입력해주세요.' })
  @MaxLength(100)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  memo?: string;
}
