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
