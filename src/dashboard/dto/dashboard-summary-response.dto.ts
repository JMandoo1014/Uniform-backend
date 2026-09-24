// Spec 8.5: 대시보드 상단 요약 카드 4개 — 모두 본인(+소속 팀) 기준.
export class DashboardSummaryResponseDto {
  activeSurveyCount: number;
  totalResponses: number;
  analyzableSurveyCount: number;
  weeklyParticipationCount: number;
  weeklyParticipationDelta: number;

  constructor(init: DashboardSummaryResponseDto) {
    Object.assign(this, init);
  }
}
