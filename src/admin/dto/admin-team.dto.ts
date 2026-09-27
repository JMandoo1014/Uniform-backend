export class AdminTeamMemberDto {
  id: string;
  nickname: string | null;
}

// 관리자 콘솔 팀 관리 — 팀 구성과 팀 설문 수.
export class AdminTeamDto {
  id: string;
  name: string;
  leaderId: string;
  leaderNickname: string | null;
  createdAt: string;
  disbandedAt: string | null;
  members: AdminTeamMemberDto[];
  surveyCount: number;

  constructor(init: AdminTeamDto) {
    Object.assign(this, init);
  }
}

export class AdminTeamRenamedDto {
  name: string;
}
