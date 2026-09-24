import { SurveyQuestionResponseDto } from '../../survey/dto/survey-response.dto';
import type { SurveyWithQuestions } from '../../survey/dto/survey-response.dto';

// Spec 10.2: "설문 내용(제목·설명·문항·보기)을 열어볼 수 있다" — 일반 조회
// API(GET /surveys/:id)와 달리 운영 삭제·팀 설문·타인 임시저장 등 모든 상태를
// 가린 것 없이 볼 수 있어야 해서, 11개 목록에 없던 조회 전용 엔드포인트를
// 관리자 도메인에 하나 추가했다(2026-09-25, 명세서 확장 기록).
export class AdminSurveyDetailDto {
  id: string;
  title: string;
  description: string | null;
  ownerType: string;
  ownerName: string;
  status: string;
  targetCount: number | null;
  deadlineAt: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  purgeAt: string | null;
  questions: SurveyQuestionResponseDto[];

  constructor(survey: SurveyWithQuestions, ownerName: string) {
    this.id = survey.id;
    this.title = survey.title;
    this.description = survey.description;
    this.ownerType = survey.ownerType;
    this.ownerName = ownerName;
    this.status = survey.status;
    this.targetCount = survey.targetCount;
    this.deadlineAt = survey.deadlineAt?.toISOString() ?? null;
    this.publishedAt = survey.publishedAt?.toISOString() ?? null;
    this.closedAt = survey.closedAt?.toISOString() ?? null;
    this.purgeAt = survey.purgeAt?.toISOString() ?? null;
    this.questions = survey.questions
      .sort((a, b) => a.orderNo - b.orderNo)
      .map((question) => new SurveyQuestionResponseDto(question));
  }
}
