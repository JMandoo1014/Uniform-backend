import { IsDateString, IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Spec 6.3/10.4: 순위별 보상 발송 기록 — 관리자가 직접 입력한 보상 내용과 발송 시각.
export class MarkRewardSentDto {
  @IsString()
  @IsNotEmpty({ message: '보상 내용을 입력해주세요.' })
  @MaxLength(200)
  reward: string;

  @IsDateString({}, { message: '발송 시각 형식이 올바르지 않습니다.' })
  sentAt: string;
}
