import { Prisma } from '@prisma/client';

export type SurveyListItem = Prisma.SurveyGetPayload<{
  include: { _count: { select: { questions: true } } };
}>;

// Spec 5.2 표시 정보 중 이번 범위에 포함된 것만 반환한다. 응답 수는 계산
// 공식/Response 도메인이 아직 없어 제외한다(사용자 확인 완료). 예상 소요
// 시간(estimatedMinutes)은 2026-09-27부터 작성자가 직접 입력한 값을 그대로
// 내려준다 — spec 5.2의 "3분 이내/5분 이내/6분 이상" 버킷 필터도 이 값
// 기준으로 계산한다(survey.service.ts listRecruiting 참고).
export class SurveyListItemResponseDto {
  id: string;
  title: string;
  ownerType: SurveyListItem['ownerType'];
  // Spec 3.3: 팀 설문은 목록에 팀 이름으로 표시한다 — USER는 등록자 닉네임.
  ownerNickname: string | null;
  questionCount: number;
  category: string | null;
  estimatedMinutes: number | null;
  targetCount: number | null;
  deadlineAt: string | null;
  status: SurveyListItem['status'];
  publishedAt: string | null;
  isOwner: boolean;
  // survey-detail-response.dto.ts의 canManage와 같은 정의 — TEAM은
  // leaderId === viewerId, USER는 isOwner와 동일.
  canManage: boolean;

  constructor(
    survey: SurveyListItem,
    ownerNickname: string | null,
    viewerId: string,
    canManage: boolean,
  ) {
    this.id = survey.id;
    this.title = survey.title;
    this.ownerType = survey.ownerType;
    this.ownerNickname = ownerNickname;
    this.questionCount = survey._count.questions;
    this.category = survey.category;
    this.estimatedMinutes = survey.estimatedMinutes;
    this.targetCount = survey.targetCount;
    this.deadlineAt = survey.deadlineAt?.toISOString() ?? null;
    this.status = survey.status;
    this.publishedAt = survey.publishedAt?.toISOString() ?? null;
    this.isOwner = survey.ownerId === viewerId;
    this.canManage = canManage;
  }
}
