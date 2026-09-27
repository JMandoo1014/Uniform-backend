// CORS_ORIGIN 환경변수를 nestjs enableCors의 origin 옵션 값으로 바꾼다.
// - 안 정해져 있으면 true(전체 허용, 로컬 개발 편의용 — 기존 동작 유지).
// - 쉼표로 구분된 여러 값을 허용한다: 정확히 일치하는 문자열은 그대로 두고,
//   "*"가 들어있는 항목(예: "https://*.uni-form-go.pages.dev")은 정규식으로
//   바꿔 Cloudflare Pages 프리뷰 서브도메인(브랜치/커밋마다 달라짐)처럼
//   가변 서브도메인을 통째로 허용한다. "*"는 서브도메인 한 칸의 영문 소문자·
//   숫자·하이픈만 매치한다(Cloudflare가 실제로 만드는 서브도메인 형태) —
//   "*.example.com"이 "a.b.example.com"까지 허용하지 않도록 점(.)은 매치하지
//   않는다.
export function parseCorsOrigin(
  value: string | undefined,
): true | (string | RegExp)[] {
  if (!value) {
    return true;
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.includes('*') ? wildcardToRegExp(entry) : entry));
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '[a-z0-9-]+');
  return new RegExp(`^${escaped}$`, 'i');
}
