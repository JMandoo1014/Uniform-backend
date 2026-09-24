// Spec 10.2: 관리자용 설문 목록 — 모든 상태 포함.
export class AdminSurveyListItemDto {
  id: string;
  title: string;
  ownerName: string;
  status: string;
  publishedAt: string | null;

  constructor(init: AdminSurveyListItemDto) {
    Object.assign(this, init);
  }
}
