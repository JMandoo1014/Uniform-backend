import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { UpdateSurveyQuestionDto } from './update-survey-question.dto';

// Spec 4.1: 임시저장은 낙관적 락(version)으로 동시 수정 충돌을 막는다. title 등은
// 생략하면 기존 값을 유지하고, null을 보내면 값을 비운다(targetCount/deadlineDate만
// 해당 — title은 필수 항목이라 비울 수 없다).
export class UpdateSurveyDraftDto {
  @IsInt()
  version: number;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsInt()
  targetCount?: number | null;

  // "YYYY-MM-DD" 형식의 캘린더 날짜. 실제 마감 시각(그날 23:59:59 KST)으로 변환해
  // 저장한다. 형식/실제 날짜 유효성은 검사하되, "오늘 이후"인지는 게시 시점에만 검사한다.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: '마감일은 YYYY-MM-DD 형식이어야 합니다.',
  })
  deadlineDate?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateSurveyQuestionDto)
  questions?: UpdateSurveyQuestionDto[];
}
