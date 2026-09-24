import { Prisma } from '@prisma/client';

export type SurveyWithQuestions = Prisma.SurveyGetPayload<{
  include: { questions: { include: { options: true } } };
}>;

export class SurveyOptionResponseDto {
  id: string;
  orderNo: number;
  label: string;
  isEtc: boolean;

  constructor(
    option: SurveyWithQuestions['questions'][number]['options'][number],
  ) {
    this.id = option.id;
    this.orderNo = option.orderNo;
    this.label = option.label;
    this.isEtc = option.isEtc;
  }
}

export class SurveyQuestionResponseDto {
  id: string;
  orderNo: number;
  type: SurveyWithQuestions['questions'][number]['type'];
  questionText: string;
  required: boolean;
  minSelect: number | null;
  maxSelect: number | null;
  minScaleLabel: string | null;
  maxScaleLabel: string | null;
  options: SurveyOptionResponseDto[];

  constructor(question: SurveyWithQuestions['questions'][number]) {
    // Spec 4.1: 클라이언트에는 내부 식별값(stableKey)을 id로 노출한다. DB의
    // 실제 기본 키는 응답 재생성 시 자유롭게 바뀔 수 있는 구현 세부사항이다.
    this.id = question.stableKey;
    this.orderNo = question.orderNo;
    this.type = question.type;
    this.questionText = question.questionText;
    this.required = question.required;
    this.minSelect = question.minSelect;
    this.maxSelect = question.maxSelect;
    this.minScaleLabel = question.minScaleLabel;
    this.maxScaleLabel = question.maxScaleLabel;
    this.options = question.options
      .sort((a, b) => a.orderNo - b.orderNo)
      .map((option) => new SurveyOptionResponseDto(option));
  }
}

// 작성자 본인이 보는 초안/게시 결과 응답(버전 포함). 응답자 관점 응답은
// survey-detail-response.dto.ts를 따로 둔다.
export class SurveyResponseDto {
  id: string;
  title: string;
  description: string | null;
  status: SurveyWithQuestions['status'];
  targetCount: number | null;
  deadlineAt: string | null;
  version: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  questions: SurveyQuestionResponseDto[];

  constructor(survey: SurveyWithQuestions) {
    this.id = survey.id;
    this.title = survey.title;
    this.description = survey.description;
    this.status = survey.status;
    this.targetCount = survey.targetCount;
    this.deadlineAt = survey.deadlineAt?.toISOString() ?? null;
    this.version = survey.version;
    this.publishedAt = survey.publishedAt?.toISOString() ?? null;
    this.createdAt = survey.createdAt.toISOString();
    this.updatedAt = survey.updatedAt.toISOString();
    this.questions = survey.questions
      .sort((a, b) => a.orderNo - b.orderNo)
      .map((question) => new SurveyQuestionResponseDto(question));
  }
}
