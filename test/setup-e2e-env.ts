// e2e는 AppModule을 그대로 띄운다 — 로컬 .env에 TERMS_VERSION이 아직 없어도
// 돌 수 있게 .env.example과 같은 값을 기본으로 둔다(있으면 그 값을 쓴다).
process.env.TERMS_VERSION ??= '2026-09-01';
