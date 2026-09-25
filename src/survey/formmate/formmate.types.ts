import { SurveyQuestionType } from '@prisma/client';

// UpdateSurveyQuestionDto/UpdateSurveyOptionDto와 같은 모양의 순수 데이터 타입.
// FormMate 내부에서는 HTTP 바디가 아니라 서버가 직접 조립/병합한 값을 주고받으므로
// class-validator 데코레이터가 있는 DTO 클래스 대신 인터페이스로 둔다.
export interface FormMateOptionDraft {
  label: string;
  isEtc?: boolean;
}

export interface FormMateQuestionDraft {
  id?: string;
  type: SurveyQuestionType;
  questionText: string;
  required?: boolean;
  minSelect?: number;
  maxSelect?: number;
  minScaleLabel?: string;
  maxScaleLabel?: string;
  options?: FormMateOptionDraft[];
}

export type FormMateChangeType =
  'ADD_QUESTION' | 'UPDATE_QUESTION' | 'DELETE_QUESTION' | 'UPDATE_OPTION';

export interface FormMateProposedChangeDraft {
  type: FormMateChangeType;
  summary: string;
  targetStableKey?: string;
  // DELETE_QUESTION은 after가 없다(대상을 지우는 동작이라 "될 내용"이 없음).
  // 모델 응답을 그대로 담는 타입이라 스키마를 어긴 값이 들어올 수도 있다 —
  // 저장 전에 formmate-change.validator로 검증한다.
  after?: FormMateQuestionDraft | null;
}

export interface FormMateGenerateResult {
  replyText: string;
  changes: FormMateProposedChangeDraft[];
}

export interface FormMateConversationTurn {
  role: 'USER' | 'ASSISTANT';
  content: string;
}
