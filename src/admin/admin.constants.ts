import { SurveyStatus, UserStatus } from '@prisma/client';

// Spec 4.4: 운영 삭제 사유 분류 — 명세서에 명시된 5개 구분 그대로.
export const SURVEY_REMOVAL_REASON_CATEGORIES = [
  '성적 내용·차별',
  '개인 식별 정보',
  '민감한 개인 정보',
  '제3자 정보·위험 유도',
  '영업·허위 보상',
] as const;
export type SurveyRemovalReasonCategory =
  (typeof SURVEY_REMOVAL_REASON_CATEGORIES)[number];

// Spec 6.3: 보상은 매주 상위 3자리(1위 1명, 2위 1명, 3위 1명).
export const REWARD_RANK_LIMIT = 3;
// 정산 1단계(응답 확인)에서 관리자가 확인하는 후보 수 — 3자리 + 부정 응답으로
// 빠질 경우 다음 순위자에게 넘길(spec 6.3) 여유 2명.
export const REWARD_CANDIDATE_COUNT = 5;

// 관리자 콘솔 보상 정산 단계(LeaderboardRewardWeek.step 1~5).
export const REWARD_STEP_LABELS = [
  '응답 확인',
  '순위 확정',
  '동점 추첨',
  '대상 확정',
  '발송 기록',
] as const;
export const REWARD_STEP_RANK_CONFIRMED = 3;
export const REWARD_STEP_FINAL = 5;

export const SURVEY_STATUS_LABELS: Record<SurveyStatus, string> = {
  DRAFT: '임시저장',
  RECRUITING: '모집 중',
  CLOSED: '마감',
  ARCHIVED: '보관',
  REMOVED: '운영 삭제',
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  PENDING_VERIFICATION: '인증 대기',
  ACTIVE: '활성',
  RESTRICTED: '이용 제한',
  WITHDRAWN: '탈퇴',
};

// 조치 기록(AdminActionLog.action) 값. 관리자 콘솔은 이 문자열에
// survey/member/response/team/reward가 들어있는지로 종류를 거른다.
export const ADMIN_ACTIONS = {
  SURVEY_REMOVE: 'survey_remove',
  SURVEY_RESTORE: 'survey_restore',
  MEMBER_RESTRICT: 'member_restrict',
  MEMBER_UNRESTRICT: 'member_unrestrict',
  MEMBER_RENAME: 'member_rename',
  MEMBER_STAFF: 'member_staff',
  RESPONSE_EXCLUDE: 'response_exclude',
  RESPONSE_VIEW: 'response_view',
  TEAM_RENAME: 'team_rename',
  REWARD_ADVANCE: 'reward_advance',
  REWARD_LOTTERY: 'reward_lottery',
  REWARD_SENT: 'reward_sent',
  REWARD_NOTICE_UPDATE: 'reward_notice_update',
} as const;

export const ADMIN_TARGET_TYPES = {
  SURVEY: 'survey',
  MEMBER: 'member',
  RESPONSE: 'response',
  TEAM: 'team',
  REWARD_WEEK: 'reward_week',
  NOTICE: 'notice',
} as const;
