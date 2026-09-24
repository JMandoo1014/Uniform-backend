import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { SurveyQuestionType } from '@prisma/client';
import { CREATABLE_SURVEY_QUESTION_TYPES } from '../survey.constants';
import { UpdateSurveyOptionDto } from './update-survey-option.dto';

// Spec 4.1: 순서를 바꿔도 같은 질문을 구분할 수 있도록 내부 식별값(stableKey)을
// 유지한다. 기존 문항을 수정할 때는 id(stableKey)를 그대로 보내고, 새 문항은
// id 없이 보낸다. 배열에 포함되지 않은 기존 문항은 삭제된 것으로 처리한다.
export class UpdateSurveyQuestionDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsIn(CREATABLE_SURVEY_QUESTION_TYPES)
  type: SurveyQuestionType;

  @IsString()
  questionText: string;

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  // MULTI_CHOICE 전용
  @IsOptional()
  @IsInt()
  minSelect?: number;

  @IsOptional()
  @IsInt()
  maxSelect?: number;

  // SCALE 전용 — 1점/5점의 설명(spec 4.3)
  @IsOptional()
  @IsString()
  minScaleLabel?: string;

  @IsOptional()
  @IsString()
  maxScaleLabel?: string;

  // SINGLE_CHOICE / MULTI_CHOICE 전용
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateSurveyOptionDto)
  options?: UpdateSurveyOptionDto[];
}
