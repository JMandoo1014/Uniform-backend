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
  // survey 도메인 DTO들의 canManage와 같은 정의 — TEAM은 leaderId ===
  // 조회자, USER는 항상 true(이 목록엔 본인 설문만 나오므로).
  canManage: boolean;
  // Spec 3.4: TEAM 설문이고 그 팀이 해산됐으면 해산 시각, 그 외(USER 설문 또는
  // 아직 해산 안 된 팀의 설문)엔 null. 프론트가 ownerName(팀 이름)과 함께
  // "OO팀 (해산됨)"처럼 구분해 보여줄 수 있게 canManage와 같은 레벨로 내려준다.
  teamDisbandedAt: string | null;

  constructor(init: MySurveyResponseDto) {
    Object.assign(this, init);
  }
}
