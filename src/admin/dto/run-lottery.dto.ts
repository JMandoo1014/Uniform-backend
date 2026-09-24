import { Matches } from 'class-validator';

// Spec 10.4: 추첨 대상 주차. "YYYY-MM-DD"는 그 주의 월요일(KST) 날짜.
export class RunLotteryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'week는 YYYY-MM-DD 형식이어야 합니다.',
  })
  week: string;
}
