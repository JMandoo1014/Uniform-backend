// e2e는 AppModule을 그대로 띄운다 — 로컬 .env에 TERMS_VERSION이 아직 없어도
// 돌 수 있게 .env.example과 같은 값을 기본으로 둔다(있으면 그 값을 쓴다).
process.env.TERMS_VERSION ??= '2026-10-09';
// e2e는 모든 요청이 같은 IP(127.0.0.1)라 운영 한도로는 회원가입·로그인을 여러 번
// 부르는 테스트가 429에 걸린다. 테스트에서만 한도를 크게 올린다 — 실제 한도는
// rate-limit.e2e-spec.ts가 1로 되돌려서 검증한다.
process.env.THROTTLE_LIMIT_MULTIPLIER ??= '1000';
