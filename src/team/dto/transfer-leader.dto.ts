import { IsNotEmpty, IsString } from 'class-validator';

// Spec 3.1: 팀장 넘기기는 현재 팀장만, 새 팀장은 현재 팀원이어야 한다.
export class TransferLeaderDto {
  @IsString()
  @IsNotEmpty({ message: '새 팀장의 사용자 id를 입력해주세요.' })
  newLeaderId: string;
}
