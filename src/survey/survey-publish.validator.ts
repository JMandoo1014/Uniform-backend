import { SurveyQuestionType } from '@prisma/client';
import {
  getKstTodayDateString,
  toKstDateString,
} from '../common/utils/kst-date.util';
import { SurveyWithQuestions } from './dto/survey-response.dto';
import {
  CHOICE_OPTION_MAX_COUNT,
  CHOICE_OPTION_MIN_COUNT,
  MAX_QUESTION_COUNT,
  MIN_QUESTION_COUNT,
  OPTION_LABEL_MAX_LENGTH,
  QUESTION_TEXT_MAX_LENGTH,
  QUESTION_TEXT_MIN_LENGTH,
  TARGET_COUNT_MAX,
  TARGET_COUNT_MIN,
} from './survey.constants';

// Spec 4.5 step 1 + 4.3: 게시 시점에만 전체 완성도(문항 수, 글자 수, 목표
// 인원·마감일)를 검사한다. 임시저장 중에는 미완성을 허용하므로(4.1) 이 검사는
// PATCH가 아니라 publish 흐름에서만 호출한다. 위반 사항을 모두 모아 반환한다.
export function validatePublishableSurvey(
  survey: SurveyWithQuestions,
): string[] {
  const errors: string[] = [];

  if (!survey.title.trim()) {
    errors.push('제목을 입력해주세요.');
  }

  const questionCount = survey.questions.length;
  if (
    questionCount < MIN_QUESTION_COUNT ||
    questionCount > MAX_QUESTION_COUNT
  ) {
    errors.push(
      `문항 수는 ${MIN_QUESTION_COUNT}개 이상 ${MAX_QUESTION_COUNT}개 이하여야 합니다.`,
    );
  }

  survey.questions.forEach((question, index) => {
    const position = index + 1;
    const text = question.questionText.trim();
    if (
      text.length < QUESTION_TEXT_MIN_LENGTH ||
      text.length > QUESTION_TEXT_MAX_LENGTH
    ) {
      errors.push(
        `${position}번 문항의 질문은 ${QUESTION_TEXT_MIN_LENGTH}~${QUESTION_TEXT_MAX_LENGTH}자여야 합니다.`,
      );
    }

    if (
      question.type === SurveyQuestionType.SINGLE_CHOICE ||
      question.type === SurveyQuestionType.MULTI_CHOICE
    ) {
      const options = question.options;
      if (
        options.length < CHOICE_OPTION_MIN_COUNT ||
        options.length > CHOICE_OPTION_MAX_COUNT
      ) {
        errors.push(
          `${position}번 문항의 보기는 ${CHOICE_OPTION_MIN_COUNT}~${CHOICE_OPTION_MAX_COUNT}개여야 합니다.`,
        );
      }
      options.forEach((option, optionIndex) => {
        const label = option.label.trim();
        if (!label) {
          errors.push(
            `${position}번 문항의 ${optionIndex + 1}번 보기는 공백일 수 없습니다.`,
          );
        } else if (label.length > OPTION_LABEL_MAX_LENGTH) {
          errors.push(
            `${position}번 문항의 ${optionIndex + 1}번 보기는 ${OPTION_LABEL_MAX_LENGTH}자 이하여야 합니다.`,
          );
        }
      });

      const etcCount = options.filter((option) => option.isEtc).length;
      if (etcCount > 1) {
        errors.push(
          `${position}번 문항에는 기타(직접 입력) 보기를 하나만 둘 수 있습니다.`,
        );
      }
      if (etcCount > 0 && question.type !== SurveyQuestionType.SINGLE_CHOICE) {
        errors.push(
          `기타(직접 입력) 보기는 단일선택 문항에만 사용할 수 있습니다.`,
        );
      }

      if (question.type === SurveyQuestionType.MULTI_CHOICE) {
        const { minSelect, maxSelect } = question;
        if (
          minSelect == null ||
          maxSelect == null ||
          minSelect < 1 ||
          minSelect > maxSelect ||
          maxSelect > options.length
        ) {
          errors.push(
            `${position}번 문항의 선택 개수 설정(최소 ≤ 최대 ≤ 보기 수)이 올바르지 않습니다.`,
          );
        }
      }
    }

    if (question.type === SurveyQuestionType.SCALE) {
      if (!question.minScaleLabel?.trim() || !question.maxScaleLabel?.trim()) {
        errors.push(
          `${position}번 문항은 1점과 5점의 설명을 모두 입력해야 합니다.`,
        );
      }
    }
  });

  if (survey.targetCount == null) {
    errors.push('목표 인원을 입력해주세요.');
  } else if (
    survey.targetCount < TARGET_COUNT_MIN ||
    survey.targetCount > TARGET_COUNT_MAX
  ) {
    errors.push(
      `목표 인원은 ${TARGET_COUNT_MIN}~${TARGET_COUNT_MAX}명이어야 합니다.`,
    );
  }

  if (!survey.deadlineAt) {
    errors.push('마감일을 입력해주세요.');
  } else if (toKstDateString(survey.deadlineAt) < getKstTodayDateString()) {
    errors.push('마감일은 오늘 이후여야 합니다.');
  }

  return errors;
}
