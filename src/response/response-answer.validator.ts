import { SurveyQuestionType } from '@prisma/client';
import { SurveyWithQuestions } from '../survey/dto/survey-response.dto';
import { SCALE_MAX, SCALE_MIN } from '../survey/survey.constants';
import {
  NARRATIVE_MAX_LENGTH,
  SAME_SCALE_WARNING_MIN_COUNT,
  SHORT_ANSWER_MAX_LENGTH,
} from './response.constants';

type QuestionWithOptions = SurveyWithQuestions['questions'][number];

// 단일선택 값 형태: 보기는 SurveyOption.id(실제 PK)로 가리킨다. isEtc 보기를
// 고른 경우에만 etcText를 함께 보낸다 (4.3: "기타 입력을 허용하면 입력 내용도 저장").
interface SingleChoiceAnswer {
  optionId: string;
  etcText?: string;
}

function isBlankAnswer(type: SurveyQuestionType, raw: unknown): boolean {
  if (raw === undefined || raw === null) return true;
  if (type === SurveyQuestionType.MULTI_CHOICE) {
    return !Array.isArray(raw) || raw.length === 0;
  }
  if (type === SurveyQuestionType.SINGLE_CHOICE) {
    const answer = raw as Partial<SingleChoiceAnswer>;
    return (
      typeof answer !== 'object' ||
      answer === null ||
      typeof answer.optionId !== 'string' ||
      !answer.optionId.trim()
    );
  }
  if (type === SurveyQuestionType.SCALE) {
    return typeof raw !== 'number' || Number.isNaN(raw);
  }
  // SHORT_ANSWER / NARRATIVE — 공백뿐인 답은 미응답으로 본다(4.3).
  return typeof raw !== 'string' || !raw.trim();
}

function validateSingleChoice(
  question: QuestionWithOptions,
  raw: unknown,
  errors: string[],
): void {
  const { optionId, etcText } = raw as SingleChoiceAnswer;
  const option = question.options.find((o) => o.id === optionId);
  if (!option) {
    errors.push(`${question.orderNo}번 문항의 보기를 찾을 수 없습니다.`);
    return;
  }
  if (option.isEtc && !etcText?.trim()) {
    errors.push(`${question.orderNo}번 문항의 기타 입력 내용을 적어주세요.`);
  }
}

function validateMultiChoice(
  question: QuestionWithOptions,
  raw: unknown,
  errors: string[],
): void {
  const values = raw as unknown[];
  const validOptionIds = new Set(question.options.map((o) => o.id));

  if (!values.every((v) => typeof v === 'string' && validOptionIds.has(v))) {
    errors.push(`${question.orderNo}번 문항의 보기를 찾을 수 없습니다.`);
    return;
  }
  if (new Set(values).size !== values.length) {
    errors.push(`${question.orderNo}번 문항에 중복된 보기가 있습니다.`);
  }

  const min = question.minSelect ?? 1;
  const max = question.maxSelect ?? question.options.length;
  if (values.length < min || values.length > max) {
    errors.push(
      `${question.orderNo}번 문항은 ${min}~${max}개를 선택해야 합니다.`,
    );
  }
}

function validateScale(
  question: QuestionWithOptions,
  raw: unknown,
  errors: string[],
): void {
  const value = raw as number;
  const min = question.minScale ?? SCALE_MIN;
  const max = question.maxScale ?? SCALE_MAX;
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(
      `${question.orderNo}번 문항은 ${min}~${max}점 사이로 답해주세요.`,
    );
  }
}

function validateText(
  question: QuestionWithOptions,
  raw: unknown,
  maxLength: number,
  errors: string[],
): void {
  const text = (raw as string).trim();
  if (text.length > maxLength) {
    errors.push(
      `${question.orderNo}번 문항은 ${maxLength}자 이하로 입력해주세요.`,
    );
  }
}

// 문항 하나의 값 자체가 유효한지(선택 개수·점수 범위·존재하는 보기·글자 수)만
// 검사한다 — 필수/누락 여부는 호출자가 각자의 맥락에 맞게 따로 판단한다.
function validateAnswerValue(
  question: QuestionWithOptions,
  raw: unknown,
  errors: string[],
): void {
  switch (question.type) {
    case SurveyQuestionType.SINGLE_CHOICE:
      validateSingleChoice(question, raw, errors);
      break;
    case SurveyQuestionType.MULTI_CHOICE:
      validateMultiChoice(question, raw, errors);
      break;
    case SurveyQuestionType.SCALE:
      validateScale(question, raw, errors);
      break;
    case SurveyQuestionType.SHORT_ANSWER:
      validateText(question, raw, SHORT_ANSWER_MAX_LENGTH, errors);
      break;
    case SurveyQuestionType.NARRATIVE:
      validateText(question, raw, NARRATIVE_MAX_LENGTH, errors);
      break;
  }
}

// Spec 4.3/5.3: 서버는 설문에 없는 문항, 필수 누락, 선택 개수·점수 범위·길이
// 위반을 확인해 거부한다. 위반 사항을 모두 모아 반환한다(게시 검증과 동일한 패턴).
// 제출(submit)의 answers는 그 시점의 전체 스냅샷으로 취급한다 — 여기 없는
// 문항은 "빈 답"이다(response.service.ts가 세션에서도 같은 기준으로 지운다).
export function validateSubmittedAnswers(
  survey: SurveyWithQuestions,
  rawAnswers: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const knownStableKeys = new Set(survey.questions.map((q) => q.stableKey));

  for (const stableKey of Object.keys(rawAnswers)) {
    if (!knownStableKeys.has(stableKey)) {
      errors.push(`설문에 없는 문항입니다: ${stableKey}`);
    }
  }

  for (const question of survey.questions) {
    const raw = rawAnswers[question.stableKey];

    if (isBlankAnswer(question.type, raw)) {
      if (question.required) {
        errors.push(`${question.orderNo}번 문항은 필수 응답입니다.`);
      }
      continue;
    }

    validateAnswerValue(question, raw, errors);
  }

  return errors;
}

// Spec 5.3 "답 입력·변경"(임시저장): 아직 작성 중이라 빈 칸·미완성이 정상이므로
// 필수 여부는 검사하지 않는다 — 다만 채워 넣은 값 자체가 유효한지(범위·존재하는
// 보기·글자 수)는 제출과 동일한 기준으로 검사해, 잘못된 값이 세션에 쌓였다가
// 그대로 제출되는 걸 막는다. 지운 답(이 객체에 아예 없는 문항)은 에러 없이
// 통과시킨다 — "비움"과 "잘못된 값"은 구분해야 한다.
export function validateAnswerValues(
  survey: SurveyWithQuestions,
  rawAnswers: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const questionByKey = new Map(survey.questions.map((q) => [q.stableKey, q]));

  for (const [stableKey, raw] of Object.entries(rawAnswers)) {
    const question = questionByKey.get(stableKey);
    if (!question || isBlankAnswer(question.type, raw)) {
      continue;
    }
    validateAnswerValue(question, raw, errors);
  }

  return errors;
}

// Spec 5.4: 답한 척도 문항이 3개 이상이고 모두 같은 점수인지 서버가 직접
// 최종 답변에서 재계산한다 — 클라이언트가 보낸 플래그를 신뢰하지 않는다
// (10.4/6.6: 관리자가 보는 "경고 후 제출" 표시가 클라이언트 조작에 영향받지 않도록).
export function hasSameScaleWarning(
  survey: SurveyWithQuestions,
  rawAnswers: Record<string, unknown>,
): boolean {
  const scaleValues = survey.questions
    .filter((q) => q.type === SurveyQuestionType.SCALE)
    .map((q) => rawAnswers[q.stableKey])
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));

  if (scaleValues.length < SAME_SCALE_WARNING_MIN_COUNT) return false;
  return new Set(scaleValues).size === 1;
}
