-- 데이터 전용 마이그레이션(스키마 변경 없음).
-- 2026-10-04 팀 결정: 베타테스트 첫날인 10/4(일)을 다음 주(10/5 월 ~ 10/11 일)에 붙여 8일로 집계한다
-- (코드: src/common/utils/kst-date.util.ts EXTENDED_WEEKS).
-- 배포 전에 10/4에 적립된 점수는 9/28 주(key = 2026-09-28 00:00 KST)로 들어가 있으므로 10/5 주로 옮긴다.
-- weekStart/awardedAt은 UTC로 저장된다: 9/28 00:00 KST = 2026-09-27 15:00, 10/4 00:00 KST = 2026-10-03 15:00,
-- 10/5 00:00 KST = 2026-10-04 15:00.
UPDATE "leaderboard_scores"
SET "weekStart" = TIMESTAMP '2026-10-04 15:00:00'
WHERE "weekStart" = TIMESTAMP '2026-09-27 15:00:00'
  AND "awardedAt" >= TIMESTAMP '2026-10-03 15:00:00'
  AND "awardedAt" <  TIMESTAMP '2026-10-04 15:00:00';
