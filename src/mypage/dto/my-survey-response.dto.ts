// Spec 8.3: 내 설문(본인 + 소속 팀의 팀 초안·팀 설문) 관리 목록의 한 행.
export class MySurveyResponseDto {
  id: string;
  title: string;
  ownerType: string; // USER | TEAM
  ownerName: string; // 본인 닉네임 또는 팀 이름 — "게시 명의"
  status: string; // DRAFT | RECRUITING | CLOSED | ARCHIVED | REMOVED
  questionCount: number;
  responseCount: number;
  targetCount: number | null;
  achievementRate: number | null;
  deadlineAt: string | null;
  purgeAt: string | null;

  constructor(init: MySurveyResponseDto) {
    Object.assign(this, init);
  }
}
