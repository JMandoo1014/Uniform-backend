import { SurveyStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

// Spec 10.2: 제목·게시자 닉네임·팀 이름·게시일로 찾는다(모든 상태 포함).
export class ListAdminSurveysQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsEnum(SurveyStatus)
  status?: SurveyStatus;
}
