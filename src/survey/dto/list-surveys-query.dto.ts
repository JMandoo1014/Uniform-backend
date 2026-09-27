import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SURVEY_LIST_MAX_LIMIT } from '../survey.constants';

// Spec 5.2: "예상 소요 시간(전체 / 3분 이내 / 5분 이내 / 6분 이상)" 필터 —
// "전체"는 이 값을 아예 안 보내는 것으로 표현한다(다른 목록 필터들과 같은 패턴).
// estimatedMinutes가 null인 설문(작성자가 입력하지 않음)은 어떤 구간에도
// 잡히지 않는다 — "이 정도 걸린다"는 정보가 없으므로 필터링 대상에서 제외.
export enum EstimatedDurationFilter {
  UNDER_3 = 'UNDER_3',
  UNDER_5 = 'UNDER_5',
  OVER_6 = 'OVER_6',
}

export class ListSurveysQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SURVEY_LIST_MAX_LIMIT)
  limit?: number;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsEnum(EstimatedDurationFilter)
  estimatedDuration?: EstimatedDurationFilter;
}
