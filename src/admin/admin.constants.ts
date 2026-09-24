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

// Spec 6.4/10.4: 리더보드 보상은 1~3위(금·은·동)까지.
export const REWARD_RANK_LIMIT = 3;
