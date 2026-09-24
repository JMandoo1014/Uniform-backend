import { IsNotEmpty, IsString } from 'class-validator';

// Spec 10.4: 리더보드 상단 보상 내용·동점 규칙 공지 문구.
export class UpdateAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  rewardText: string;

  @IsString()
  @IsNotEmpty()
  tieRuleText: string;
}
