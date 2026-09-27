import {
  EnrollmentStatus,
  Gender,
  GradeLevel,
  MajorField,
  UserStatus,
} from '@prisma/client';

export type AdminMemberRole = 'ADMIN' | 'STAFF' | 'USER';

export class AdminRestrictionDto {
  reason: string;
  startedAt: string;
  endsAt: string | null;
}

// Spec 10.3: 회원 조회 — 가입일, 계정 상태, 게시 설문 수, 응답 수, 경고 후
// 그대로 제출한 응답 수, 소속 팀. 비밀번호는 없다.
export class AdminMemberDto {
  id: string;
  nickname: string | null;
  email: string | null;
  status: UserStatus;
  role: AdminMemberRole;
  createdAt: string;
  gender: Gender | null;
  grade: GradeLevel | null;
  majorField: MajorField | null;
  enrollmentStatus: EnrollmentStatus | null;
  // 게시한(publishedAt 있는) 설문 중 본인이 만든 것 — 팀 명의로 게시한 것 포함.
  surveyCount: number;
  responseCount: number;
  warningTotal: number;
  warningWeek: number;
  weeklyCount: number;
  weeklyRank: number | null;
  teamNames: string[];
  restriction: AdminRestrictionDto | null;

  constructor(init: AdminMemberDto) {
    Object.assign(this, init);
  }
}

export class AdminNicknameChangedDto {
  nickname: string;
}

export class AdminStaffChangedDto {
  isStaff: boolean;
}
