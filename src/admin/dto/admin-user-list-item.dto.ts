// Spec 10.3: 회원 조회 — 가입일/상태/게시 설문 수/응답 수/경고 후 제출 수/소속 팀.
// 비밀번호는 애초에 포함하지 않는다.
export class AdminUserListItemDto {
  id: string;
  nickname: string | null;
  email: string | null;
  createdAt: string;
  status: string;
  surveyCount: number;
  responseCount: number;
  warningCount: number;
  teamNames: string[];

  constructor(init: AdminUserListItemDto) {
    Object.assign(this, init);
  }
}
