import { SurveyStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

// Spec 8.3: 상태별 탭(임시저장/모집 중/마감·보관/운영 삭제) — 탭 하나당 상태 값 하나.
export class ListMySurveysQueryDto {
  @IsOptional()
  @IsEnum(SurveyStatus)
  status?: SurveyStatus;
}
