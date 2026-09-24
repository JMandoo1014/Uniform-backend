// Spec 10.4: 이번 주와 지난 주들의 전체 순위 + 회원별 그 주 제출 목록(설문,
// 제출 시각, 경고 후 제출 여부, 답변).
export class AdminLeaderboardRankDto {
  rank: number;
  userId: string;
  nickname: string;
  points: number;

  constructor(init: AdminLeaderboardRankDto) {
    Object.assign(this, init);
  }
}

export class AdminSubmissionDto {
  sessionId: string;
  surveyId: string;
  surveyTitle: string;
  submittedAt: string;
  sameScaleWarningAcknowledged: boolean;
  excluded: boolean;
  answers: Record<string, unknown>;

  constructor(init: AdminSubmissionDto) {
    Object.assign(this, init);
  }
}

export class AdminWeeklyLeaderboardResponseDto {
  weekStart: string;
  ranks: AdminLeaderboardRankDto[];
  submissionsByUser: Record<string, AdminSubmissionDto[]>;

  constructor(init: AdminWeeklyLeaderboardResponseDto) {
    Object.assign(this, init);
  }
}
