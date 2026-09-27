import { IsOptional, Matches } from 'class-validator';

// 특정 주차(그 주의 아무 날, "YYYY-MM-DD")에 제출한 응답만 볼 때.
export class ListMemberResponsesQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'week는 YYYY-MM-DD 형식이어야 합니다.',
  })
  week?: string;
}
