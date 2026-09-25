import { SurveyQuestionType } from '@prisma/client';
import { CREATABLE_SURVEY_QUESTION_TYPES } from '../survey.constants';
import { FormMateChangeType, FormMateQuestionDraft } from './formmate.types';

const CHOICE_TYPES: readonly unknown[] = [
  SurveyQuestionType.SINGLE_CHOICE,
  SurveyQuestionType.MULTI_CHOICE,
];

const CHANGE_TYPES: readonly FormMateChangeType[] = [
  'ADD_QUESTION',
  'UPDATE_QUESTION',
  'DELETE_QUESTION',
  'UPDATE_OPTION',
];

export function isFormMateChangeType(
  value: unknown,
): value is FormMateChangeType {
  return CHANGE_TYPES.includes(value as FormMateChangeType);
}

// DELETE_QUESTION을 뺀 나머지는 apply 시 after(문항 전체 상태)로 대상 문항을
// 통째로 만들거나 교체한다 — after가 없으면 적용할 내용 자체가 없다.
export function changeRequiresAfter(type: FormMateChangeType): boolean {
  return type !== 'DELETE_QUESTION';
}

function isOptional<T>(value: unknown, check: (v: unknown) => v is T): boolean {
  return value === undefined || value === null || check(value);
}

const isString = (v: unknown): v is string => typeof v === 'string';
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isInteger = (v: unknown): v is number => Number.isInteger(v);

function isOptionDraft(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const option = value as Record<string, unknown>;
  return isString(option.label) && isOptional(option.isEtc, isBoolean);
}

// Gemini가 준 after(또는 DB에 저장된 before/after)가 replaceSurveyQuestions에
// 그대로 넘겨도 되는 모양인지 확인한다. 4.3의 글자 수·개수 규칙은 여기서 보지
// 않는다 — 임시저장과 마찬가지로 그건 게시 시점에 검사한다. 여기서는 Prisma
// create가 타입 오류로 터지지 않을 최소한의 구조만 본다. 단, 선택형 문항에서
// options가 아예 빠진 경우는 거부한다 — apply는 문항을 통째로 교체하므로 모델이
// 바뀐 필드만 보내면 기존 보기가 전부 지워지기 때문이다.
export function isValidQuestionDraft(
  value: unknown,
): value is FormMateQuestionDraft {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const draft = value as Record<string, unknown>;

  return (
    (CREATABLE_SURVEY_QUESTION_TYPES as readonly unknown[]).includes(
      draft.type,
    ) &&
    isString(draft.questionText) &&
    draft.questionText.trim().length > 0 &&
    isOptional(draft.id, isString) &&
    isOptional(draft.required, isBoolean) &&
    isOptional(draft.minSelect, isInteger) &&
    isOptional(draft.maxSelect, isInteger) &&
    isOptional(draft.minScaleLabel, isString) &&
    isOptional(draft.maxScaleLabel, isString) &&
    (Array.isArray(draft.options)
      ? draft.options.every(isOptionDraft)
      : (draft.options === undefined || draft.options === null) &&
        !CHOICE_TYPES.includes(draft.type))
  );
}
