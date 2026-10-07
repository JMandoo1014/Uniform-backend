// 개인정보 보유 기간. 정리 배치(RetentionService)와 각 도메인 검사가 같은 값을
// 써야 해서 한곳에 모은다.

// Spec 2.5: 탈퇴일로부터 같은 이메일 재가입 차단 기간. 지나면 해시 행도 지운다.
export const WITHDRAWN_EMAIL_BLOCK_DAYS = 30;

// Spec 2.2: 인증 대기 상태로 이 기간이 지나면 가입 정보를 지우고 닉네임 선점을 푼다.
export const UNVERIFIED_ACCOUNT_TTL_DAYS = 7;

// 처리 완료(ANSWERED)된 문의를 지우기까지의 기간.
export const ANSWERED_INQUIRY_RETENTION_DAYS = 365;

// 관리자 조치 기록: 이 기간이 지나면 조치 종류·일시·관리자 id·대상 id만 남기고
// 대상 이름·사유·메모·변경 전후 값을 파기 문구로 덮어쓴다(명세 10.1 변경).
export const ADMIN_LOG_PERSONAL_DATA_RETENTION_DAYS = 365;

// 알림: 발송(생성) 후 이 기간이 지나면 행을 삭제한다.
export const NOTIFICATION_RETENTION_DAYS = 365;

// 이용 제한 기록: 해제(liftedAt) 후 이 기간이 지나면 사유 등 식별 정보를 파기한다.
// 기록 자체(누가·언제·얼마나 제한됐는지)는 남긴다.
export const RESTRICTION_PERSONAL_DATA_RETENTION_DAYS = 365;

// 보유 기간이 지나 파기한 텍스트 자리에 남기는 문구(관리자 로그·이용 제한 기록 공통).
export const SCRUBBED_TEXT = '(보관 기간이 지나 파기됨)';

export const DAY_MS = 24 * 60 * 60 * 1000;
