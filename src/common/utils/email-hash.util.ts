import { createHash, createHmac } from 'crypto';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// 탈퇴 이메일 보관용(2.5). 솔트 없는 해시는 이메일을 아는 사람이면 누구나
// 대조할 수 있어서 서버 비밀키로 HMAC한다.
export function hmacEmail(email: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(normalizeEmail(email))
    .digest('hex');
}

// HMAC 도입 전에 저장된 행과의 대조 전용 — 새로 저장할 때는 쓰지 않는다.
// 이전 행은 탈퇴 30일 뒤 정리 배치가 지우므로 그 뒤엔 이 함수도 지워도 된다.
export function legacySha256Email(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex');
}
