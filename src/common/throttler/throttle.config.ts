import { applyDecorators, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Throttle, ThrottlerOptions } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { normalizeEmail } from '../utils/email-hash.util';

const MINUTE = 60_000;

export const LOGIN_EMAIL_THROTTLER = 'loginEmail';
const LOGIN_EMAIL_THROTTLED = 'throttle:login-email';

// e2e처럼 같은 IP(127.0.0.1)로 짧은 시간에 많이 부르는 테스트 환경에서만 한도를
// 키운다(test/setup-e2e-env.ts). 운영·개발 서버 env에는 넣지 않는다. 요청 때마다
// 읽으므로 한도를 검증하는 e2e는 앱을 띄우기 전에 1로 되돌려 실제 한도로 돈다.
function limitMultiplier(): number {
  const value = Number(process.env.THROTTLE_LIMIT_MULTIPLIER);
  return Number.isFinite(value) && value >= 1 ? value : 1;
}

export const scaledLimit = (limit: number) => (): number =>
  limit * limitMultiplier();

// 이메일 기준 제한의 추적 키. 이메일 원문 대신 해시를 쓴다(저장소 키는 가드가 한 번
// 더 해시하지만 tracker 자체도 원문을 들고 있지 않게). 이메일이 없거나 문자열이
// 아니면(검증 전에 가드가 먼저 돈다) 모든 요청이 한 칸을 같이 쓰지 않도록 IP로 센다.
export function loginEmailTracker(req: Record<string, any>): string {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email !== 'string' || email.trim() === '') {
    return `ip:${String(req.ip)}`;
  }
  const digest = createHash('sha256')
    .update(normalizeEmail(email))
    .digest('hex');
  return `email:${digest}`;
}

// 전역: IP당 분당 600회. 이메일 기준 제한은 @ThrottleLoginEmail()이 붙은
// 핸들러(로그인)에서만 센다. 계정 잠금은 두지 않는다 — 남이 일부러 틀려서 계정을
// 잠그는 공격이 되므로, 창이 지나면 다시 시도할 수 있는 시간 제한만 건다.
export const THROTTLERS: ThrottlerOptions[] = [
  { name: 'default', ttl: MINUTE, limit: scaledLimit(600) },
  {
    name: LOGIN_EMAIL_THROTTLER,
    ttl: 15 * MINUTE,
    limit: scaledLimit(10),
    getTracker: loginEmailTracker,
    skipIf: (context: ExecutionContext) =>
      Reflect.getMetadata(LOGIN_EMAIL_THROTTLED, context.getHandler()) !== true,
  },
];

// 엔드포인트별 IP 한도(전역 default를 대체). 로그인은 이메일 기준 제한도 켠다.
export const ThrottleLogin = () =>
  applyDecorators(
    Throttle({ default: { limit: scaledLimit(60), ttl: MINUTE } }),
    SetMetadata(LOGIN_EMAIL_THROTTLED, true),
  );

export const ThrottleAccountMail = () =>
  Throttle({ default: { limit: scaledLimit(30), ttl: 10 * MINUTE } });

export const ThrottleRefresh = () =>
  Throttle({ default: { limit: scaledLimit(300), ttl: MINUTE } });
