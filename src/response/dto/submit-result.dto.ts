// Spec 5.4 step 5: 완료 화면에 필요한 값("+1회", 이번 주 내 순위).
// weeklyRank는 관리자가 부정 응답으로 점수를 뺀 상태 등으로 랭킹에 아직
// 없을 수 있어 null을 허용한다(예: 이번 주 첫 응답 직후 집계 지연 등은 없지만,
// 방어적으로 optional 처리).
export class SubmitResultDto {
  success: true;
  pointsEarned: number;
  weeklyRank: number | null;

  constructor(pointsEarned: number, weeklyRank: number | null) {
    this.success = true;
    this.pointsEarned = pointsEarned;
    this.weeklyRank = weeklyRank;
  }
}
