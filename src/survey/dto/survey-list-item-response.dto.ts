import { Prisma, SurveyOwnerType } from '@prisma/client';

export type SurveyListItem = Prisma.SurveyGetPayload<{
  include: { _count: { select: { questions: true } } };
}>;

// Spec 5.2 표시 정보. 응답 수(responseCount)는 원래 계산 공식/Response
// 도메인이 없어 제외했었지만(2026-09-24 결정), Survey.responseCount가 실제
// 제출 수로 채워지기 시작한 뒤로는 그 이유가 없어져 2026-09-27부터 그대로
// 노출한다(schema.prisma의 Survey.responseCount 주석 참고 — 캐시/성능
// 관련 별도 이유는 없었음, 스키마 필드를 그대로 읽는 것뿐이라 추가 조회
// 비용도 없다). 예상 소요 시간(estimatedMinutes)은 2026-09-27부터 작성자가
// 직접 입력한 값을 그대로 내려준다 — spec 5.2의 "3분 이내/5분 이내/6분
// 이상" 버킷 필터도 이 값 기준으로 계산한다(survey.service.ts listRecruiting
// 참고).
export class SurveyListItemResponseDto {
  id: string;
  title: string;
  ownerType: SurveyListItem['ownerType'];
  // Spec 3.3: 팀 설문은 목록에 팀 이름으로 표시한다 — USER는 등록자 닉네임.
  ownerNickname: string | null;
  // I4: 프론트가 팀 이름으로 그룹핑하던 걸(같은 이름의 팀이 여럿이면 깨짐)
  // 실제 id 기준으로 바꿀 수 있도록 추가. TEAM이면 ownerId(팀 id) 그대로,
  // USER면 null.
  teamId: string | null;
  questionCount: number;
  responseCount: number;
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
    this.teamId =
      survey.ownerType === SurveyOwnerType.TEAM ? survey.ownerId : null;
    this.questionCount = survey._count.questions;
    this.responseCount = survey.responseCount;
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
