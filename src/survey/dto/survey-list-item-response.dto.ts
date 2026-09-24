import { Prisma } from '@prisma/client';

export type SurveyListItem = Prisma.SurveyGetPayload<{
  include: { _count: { select: { questions: true } } };
}>;

// Spec 5.2 표시 정보 중 이번 범위에 포함된 것만 반환한다. 예상 소요 시간과
// 응답 수는 계산 공식/Response 도메인이 아직 없어 제외한다(사용자 확인 완료).
export class SurveyListItemResponseDto {
  id: string;
  title: string;
  ownerNickname: string | null;
  questionCount: number;
  targetCount: number | null;
  deadlineAt: string | null;
  status: SurveyListItem['status'];
  publishedAt: string | null;
  isOwner: boolean;

  constructor(
    survey: SurveyListItem,
    ownerNickname: string | null,
    viewerId: string,
  ) {
    this.id = survey.id;
    this.title = survey.title;
    this.ownerNickname = ownerNickname;
    this.questionCount = survey._count.questions;
    this.targetCount = survey.targetCount;
    this.deadlineAt = survey.deadlineAt?.toISOString() ?? null;
    this.status = survey.status;
    this.publishedAt = survey.publishedAt?.toISOString() ?? null;
    this.isOwner = survey.ownerId === viewerId;
  }
}
