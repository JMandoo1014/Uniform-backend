import { IsIn, IsOptional } from 'class-validator';

export type TrendRange = '7d' | '30d' | '3m';
export type TrendMetric = 'response' | 'survey';

// Spec 8.5: 참여 추이 차트 — 기간(기본 7일)과 기준(기본 응답 수) 토글.
export class WeeklyTrendQueryDto {
  @IsOptional()
  @IsIn(['7d', '30d', '3m'])
  range?: TrendRange;

  @IsOptional()
  @IsIn(['response', 'survey'])
  metric?: TrendMetric;
}
