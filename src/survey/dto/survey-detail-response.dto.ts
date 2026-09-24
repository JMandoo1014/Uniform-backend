import {
  SurveyQuestionResponseDto,
  SurveyWithQuestions,
} from './survey-response.dto';

// Spec 5.1~5.3: 응답자 관점 설문 상세. 응답 진행 상태(진행 중 세션 등)는
// Response 도메인 몫이라 이번 범위에서는 다루지 않는다.
export class SurveyDetailResponseDto {
  id: string;
  title: string;
  description: string | null;
  ownerType: SurveyWithQuestions['ownerType'];
  // Spec 3.3: 팀 설문은 팀 이름으로 표시한다 — USER는 등록자 닉네임.
  ownerNickname: string | null;
  status: SurveyWithQuestions['status'];
  targetCount: number | null;
  deadlineAt: string | null;
  publishedAt: string | null;
  isOwner: boolean;
  questions: SurveyQuestionResponseDto[];

  constructor(
    survey: SurveyWithQuestions,
    ownerNickname: string | null,
    viewerId: string,
  ) {
    this.id = survey.id;
    this.title = survey.title;
    this.description = survey.description;
    this.ownerType = survey.ownerType;
    this.ownerNickname = ownerNickname;
    this.status = survey.status;
    this.targetCount = survey.targetCount;
    this.deadlineAt = survey.deadlineAt?.toISOString() ?? null;
    this.publishedAt = survey.publishedAt?.toISOString() ?? null;
    this.isOwner = survey.ownerId === viewerId;
    this.questions = survey.questions
      .sort((a, b) => a.orderNo - b.orderNo)
      .map((question) => new SurveyQuestionResponseDto(question));
  }
}
