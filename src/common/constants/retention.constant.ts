// 개인정보 보유 기간. 정리 배치(RetentionService)와 각 도메인 검사가 같은 값을
// 써야 해서 한곳에 모은다.

// Spec 2.5: 탈퇴일로부터 같은 이메일 재가입 차단 기간. 지나면 해시 행도 지운다.
export const WITHDRAWN_EMAIL_BLOCK_DAYS = 30;

// Spec 2.2: 인증 대기 상태로 이 기간이 지나면 가입 정보를 지우고 닉네임 선점을 푼다.
export const UNVERIFIED_ACCOUNT_TTL_DAYS = 7;

// 처리 완료(ANSWERED)된 문의를 지우기까지의 기간.
export const ANSWERED_INQUIRY_RETENTION_DAYS = 365;

// 관리자 조치 기록은 지우지 않되(10.1), 이 기간이 지나면 당시 닉네임 등
// 개인정보가 들어갈 수 있는 필드만 비운다.
export const ADMIN_LOG_PERSONAL_DATA_RETENTION_DAYS = 365;

export const DAY_MS = 24 * 60 * 60 * 1000;
