import { IsNotEmpty, IsString } from 'class-validator';

// Spec 3.2: 개인 초안(게시 전)을 소속 팀의 팀 초안으로 옮긴다. 역방향(팀→개인)은 불가.
export class MoveToTeamDto {
  @IsString()
  @IsNotEmpty({ message: 'teamId를 입력해주세요.' })
  teamId: string;
}
