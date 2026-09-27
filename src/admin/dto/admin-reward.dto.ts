import { UserStatus } from '@prisma/client';
import type { AdminMemberRole } from './admin-member.dto';

// Spec 10.4: 주차별 전체 순위 한 줄(관리자 조회 — 이용 제한·운영팀 계정도 보인다).
export class AdminWeeklyRankDto {
  rank: number;
  userId: string;
  nickname: string;
  points: number;
  status: UserStatus;
  role: AdminMemberRole;
  warningWeek: number;
  lastActiveAt: string;

  constructor(init: AdminWeeklyRankDto) {
    Object.assign(this, init);
  }
}

export class AdminWeeklyLeaderboardDto {
  week: string;
  range: string;
  ranks: AdminWeeklyRankDto[];
}

export class AdminRewardCandidateDto {
  userId: string;
  nickname: string;
  rank: number;
  points: number;
  warningWeek: number;
}

export class AdminRewardWinnerDto {
  // 보상 자리(1~3).
  rank: number;
  userId: string;
  nickname: string;
  email: string | null;
  reward: string | null;
  sentAt: string | null;
}

// 보상 정산 목록 한 줄.
export class AdminRewardWeekDto {
  week: string;
  range: string;
  step: number;
  stepLabel: string;
  participantCount: number;
  // 추첨이 필요한 동점 그룹 인원(없으면 0).
  tieCount: number;
  // 대상 확정 전이면 현재 순위 기준 예상 대상.
  winners: AdminRewardWinnerDto[];
  sentCount: number;

  constructor(init: AdminRewardWeekDto) {
    Object.assign(this, init);
  }
}

export class AdminRewardLotteryDto {
  executedAt: string;
  contestedUserIds: string[];
  winnerUserIds: string[];
}

export class AdminRewardWeekDetailDto extends AdminRewardWeekDto {
  // 1단계에서 응답을 확인할 후보(보상 대상 자격이 있는 상위 회원).
  candidates: AdminRewardCandidateDto[];
  lottery: AdminRewardLotteryDto | null;

  constructor(init: AdminRewardWeekDetailDto) {
    super(init);
    this.candidates = init.candidates;
    this.lottery = init.lottery;
  }
}
