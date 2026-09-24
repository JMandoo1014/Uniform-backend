import { SurveyQuestionType } from '@prisma/client';

// Spec 4.4 decision: SurveyQuestionType.ETC models a "기타" choice-option
// (SurveyOption.isEtc), not a standalone question type, so it is excluded
// from what a client may submit while authoring a survey.
export const CREATABLE_SURVEY_QUESTION_TYPES = [
  SurveyQuestionType.SINGLE_CHOICE,
  SurveyQuestionType.MULTI_CHOICE,
  SurveyQuestionType.SCALE,
  SurveyQuestionType.SHORT_ANSWER,
  SurveyQuestionType.NARRATIVE,
] as const;

// Spec 4.3: 척도는 MVP에서 1~5점 고정.
export const SCALE_MIN = 1;
export const SCALE_MAX = 5;

// Spec 4.3: 문항 수는 3~30개.
export const MIN_QUESTION_COUNT = 3;
export const MAX_QUESTION_COUNT = 30;

// Spec 4.3: 질문은 5~200자(앞뒤 공백 제외).
export const QUESTION_TEXT_MIN_LENGTH = 5;
export const QUESTION_TEXT_MAX_LENGTH = 200;

// Spec 4.3: 보기 하나당 최대 50자, 단일/복수선택 보기는 2~10개.
export const OPTION_LABEL_MAX_LENGTH = 50;
export const CHOICE_OPTION_MIN_COUNT = 2;
export const CHOICE_OPTION_MAX_COUNT = 10;

// Spec 4.5: 목표 인원은 1~100명.
export const TARGET_COUNT_MIN = 1;
export const TARGET_COUNT_MAX = 100;
