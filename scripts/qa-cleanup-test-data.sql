-- ============================================================
-- QA 테스트 데이터 정리 스크립트 (Uni-Form backend)
--
-- 이 파일은 Claude Code가 작성만 했고 실행하지 않았다. 아래 순서대로
-- 사람이 직접 psql에서 한 블록씩 실행하며 결과를 확인할 것.
--
--   docker exec -it uniform-postgres psql -U uniform -d uniform_dev
--   (psql 프롬프트 안에서) \i scripts/qa-cleanup-test-data.sql
--   또는 STEP 단위로 필요한 부분만 복사해서 실행
--
-- ------------------------------------------------------------
-- 대상 정의
--   [테스트 유저]   email이 'uftest%@example.com' 패턴(대소문자 무시)인 User
--   [제목 매칭 설문] title이 '캠퍼스 카페 이용 조사' 또는
--                   '화면 테스트: 도서관 이용 조사 (수정)'로 시작하는 Survey
--                   (만든 사람과 무관하게 전부 대상 — 중복 여러 건 포함)
--   [대상 설문]     [제목 매칭 설문] ∪ (creatorId가 [테스트 유저]인 Survey)
--   [대상 응답]     surveyId가 [대상 설문]인 response_sessions
--                   ∪ userId가 [테스트 유저]인 response_sessions
--                   (테스트 유저가 실제(비대상) 설문에 남긴 응답도 유저 자체를
--                   지우려면 같이 정리해야 한다 — 유저 삭제 자체는 CASCADE라
--                   놔둬도 지워지지만, 그러면 그 실제 설문의 responseCount가
--                   부정확해지므로 STEP 2 마지막에 보정 쿼리를 넣었다)
--
-- ------------------------------------------------------------
-- FK/CASCADE 확인 (prisma/schema.prisma + 실제 적용된 migration.sql 기준,
-- 2026-09-26 시점 grep으로 대조 확인함 — 라이브 DB에 직접 질의하지 않음)
--
--   CASCADE (부모를 지우면 자동으로 같이 지워짐):
--     surveys → survey_questions → survey_options
--     surveys → response_sessions → session_answers
--     surveys → formmate_messages → formmate_proposed_changes
--     surveys → formmate_proposed_changes (surveyId FK, 별도)
--     response_sessions → leaderboard_scores(submissionId)
--     teams → team_members
--     users → team_members / response_sessions / leaderboard_scores(userId) /
--             leaderboard_rewards / notifications / user_status_histories /
--             user_profile_histories / user_restrictions(userId)
--
--   ⚠ RESTRICT (부모를 못 지우게 막음 — 자식을 먼저 지우거나 옮겨야 함):
--     teams.leaderId → users.id           (teams_leaderId_fkey)
--     admin_action_logs.adminId → users.id
--     user_restrictions.createdByAdminId → users.id
--
--   即 테스트 유저가 "실사용자와 공유된 팀"의 팀장이면, 그 팀은 이번에 안
--   지우는데 teams.leaderId가 여전히 그 유저를 가리키므로 users DELETE가
--   막힌다. 마찬가지로 테스트 유저가 admin 활동 기록에 남아있어도 막힌다.
--   아래 STEP 0에서 이걸 미리 확인하고, STEP 2에서는 이런 유저를 자동으로
--   삭제 대상에서 제외한 뒤 목록으로 보여준다(스크립트가 중간에 에러로
--   멈추지 않게).
--
--   참고: notifications는 Survey에 대한 실제 FK가 없다(targetUrl 문자열에
--   설문 id가 들어있을 뿐). 그래서 이 스크립트는 notifications를 "테스트
--   유저 명의"로만 지우고, "실사용자 명의인데 내용이 대상 설문을 가리키는"
--   알림은 건드리지 않는다 — 지워진 설문을 링크하는 좀 낡은 알림 하나가
--   실사용자 화면에 남는 게, 실사용자 데이터를 임의로 지우는 것보다 안전
--   하다고 판단했다. 필요하면 별도로 처리할 것.
-- ============================================================


-- ============================================================
-- STEP 0. 사전 점검 (전부 SELECT — 여기서 나온 게 있으면 STEP 2 실행 전에
-- 먼저 읽어볼 것. 스크립트 자체는 이런 유저를 자동으로 건너뛰도록 만들어져
-- 있지만, "왜 스킵됐는지"를 사람이 알고 있는 게 안전하다.)
-- ============================================================

-- 0-1. 테스트 유저 중 admin 계정이 있는지 (있으면 안 됨 — 있으면 여기서 멈추고
--      먼저 확인할 것. isAdmin=true인 계정을 이 패턴으로 잘못 만들었을 수 있음)
SELECT id, email, "isAdmin"
FROM users
WHERE email ILIKE 'uftest%@example.com' AND "isAdmin" = true;

-- 0-2. 테스트 유저가 admin_action_logs.adminId로 남아있는지 (RESTRICT)
SELECT aal.id, aal."adminId", u.email, aal.action, aal."createdAt"
FROM admin_action_logs aal
JOIN users u ON u.id = aal."adminId"
WHERE u.email ILIKE 'uftest%@example.com';

-- 0-3. 테스트 유저가 user_restrictions.createdByAdminId로 남아있는지 (RESTRICT)
SELECT ur.id, ur."userId", ur."createdByAdminId", u.email
FROM user_restrictions ur
JOIN users u ON u.id = ur."createdByAdminId"
WHERE u.email ILIKE 'uftest%@example.com';

-- 0-4. 테스트 유저가 "실사용자와 공유된 팀"의 팀장인지 (RESTRICT — 이 팀은
--      이번에 안 지우므로 teams.leaderId가 계속 이 유저를 가리켜서 막힘)
WITH test_users AS (
  SELECT id FROM users WHERE email ILIKE 'uftest%@example.com'
)
SELECT
  t.id AS team_id,
  t.name AS team_name,
  t."leaderId",
  leader.email AS leader_email,
  count(tm.id) FILTER (WHERE tm."userId" NOT IN (SELECT id FROM test_users)) AS real_user_members
FROM teams t
JOIN users leader ON leader.id = t."leaderId"
LEFT JOIN team_members tm ON tm."teamId" = t.id
WHERE t."leaderId" IN (SELECT id FROM test_users)
GROUP BY t.id, t.name, t."leaderId", leader.email
HAVING count(tm.id) FILTER (WHERE tm."userId" NOT IN (SELECT id FROM test_users)) > 0;

-- 위 0-1~0-4가 전부 0건이면 모든 테스트 유저가 문제없이 지워진다.
-- 0-1이 0건이 아니면: 그 계정이 정말 테스트용인지부터 확인(운영 admin 계정을
--   테스트 패턴으로 오인한 게 아닌지).
-- 0-2/0-3/0-4가 0건이 아니면: 해당 유저는 STEP 2에서 자동으로 삭제 대상에서
--   제외되고 목록으로 출력된다 — 필요하면 팀장 위임/관리자 권한 이전 등을
--   먼저 처리한 뒤 이 유저만 따로 다시 지울 것.


-- ============================================================
-- STEP 1. 미리보기 — 몇 건이나 지워질지 확인 (전부 SELECT, DELETE 아님)
-- ============================================================

-- 1-1. 테스트 유저 목록 및 건수
SELECT id, email, nickname, status, "createdAt"
FROM users
WHERE email ILIKE 'uftest%@example.com'
ORDER BY "createdAt";

SELECT count(*) AS test_user_count
FROM users
WHERE email ILIKE 'uftest%@example.com';

-- 1-2. 대상 설문 목록 (제목 매칭 + 테스트 유저가 만든 것, 중복 포함) 및 건수
WITH test_users AS (
  SELECT id FROM users WHERE email ILIKE 'uftest%@example.com'
)
SELECT
  s.id, s.title, s."ownerType", s."ownerId", s."creatorId",
  creator.email AS creator_email, s.status, s."createdAt"
FROM surveys s
LEFT JOIN users creator ON creator.id = s."creatorId"
WHERE s.title LIKE '캠퍼스 카페 이용 조사%'
   OR s.title LIKE '화면 테스트: 도서관 이용 조사 (수정)%'
   OR s."creatorId" IN (SELECT id FROM test_users)
ORDER BY s."createdAt";

WITH test_users AS (
  SELECT id FROM users WHERE email ILIKE 'uftest%@example.com'
)
SELECT count(*) AS target_survey_count
FROM surveys s
WHERE s.title LIKE '캠퍼스 카페 이용 조사%'
   OR s.title LIKE '화면 테스트: 도서관 이용 조사 (수정)%'
   OR s."creatorId" IN (SELECT id FROM test_users);

-- 1-3. 대상 설문에 딸린 하위 데이터 건수 (survey_questions/options,
--      response_sessions/session_answers, formmate_*, leaderboard_scores)
--      + 테스트 유저 본인 명의 notifications 건수
WITH test_users AS (
  SELECT id FROM users WHERE email ILIKE 'uftest%@example.com'
),
target_surveys AS (
  SELECT s.id FROM surveys s
  WHERE s.title LIKE '캠퍼스 카페 이용 조사%'
     OR s.title LIKE '화면 테스트: 도서관 이용 조사 (수정)%'
     OR s."creatorId" IN (SELECT id FROM test_users)
),
target_sessions AS (
  SELECT rs.id, rs."surveyId"
  FROM response_sessions rs
  WHERE rs."surveyId" IN (SELECT id FROM target_surveys)
     OR rs."userId" IN (SELECT id FROM test_users)
)
SELECT
  (SELECT count(*) FROM survey_questions WHERE "surveyId" IN (SELECT id FROM target_surveys)) AS survey_questions,
  (SELECT count(*) FROM survey_options so
     JOIN survey_questions sq ON sq.id = so."questionId"
     WHERE sq."surveyId" IN (SELECT id FROM target_surveys)) AS survey_options,
  (SELECT count(*) FROM target_sessions WHERE "surveyId" IN (SELECT id FROM target_surveys)) AS response_sessions_on_target_surveys,
  (SELECT count(*) FROM target_sessions WHERE "surveyId" NOT IN (SELECT id FROM target_surveys)) AS response_sessions_by_test_user_on_real_surveys,
  (SELECT count(*) FROM session_answers WHERE "sessionId" IN (SELECT id FROM target_sessions)) AS session_answers,
  (SELECT count(*) FROM leaderboard_scores WHERE "submissionId" IN (SELECT id FROM target_sessions)) AS leaderboard_scores,
  (SELECT count(*) FROM formmate_messages WHERE "surveyId" IN (SELECT id FROM target_surveys)) AS formmate_messages,
  (SELECT count(*) FROM formmate_proposed_changes WHERE "surveyId" IN (SELECT id FROM target_surveys)) AS formmate_proposed_changes,
  (SELECT count(*) FROM notifications WHERE "userId" IN (SELECT id FROM test_users)) AS notifications_by_test_user;

-- response_sessions_by_test_user_on_real_surveys가 0이 아니면, 그 실제
-- 설문들의 responseCount가 이번 정리로 부정확해질 수 있다 — STEP 2 마지막의
-- 보정 쿼리가 이걸 다시 맞춰준다.

-- 1-4. 테스트 유저가 속한 팀 중 "실사용자와 공유되지 않는" 팀만 추려서 확인
--      (팀장이든 일반 멤버든 상관없이, 팀 전체 멤버가 100% 테스트 유저인
--      경우에만 팀 자체를 지운다. 실사용자가 한 명이라도 있으면 팀은 그대로
--      두고 테스트 유저의 team_members row만 지운다)
WITH test_users AS (
  SELECT id FROM users WHERE email ILIKE 'uftest%@example.com'
),
candidate_teams AS (
  SELECT DISTINCT t.id
  FROM teams t
  LEFT JOIN team_members tm ON tm."teamId" = t.id
  WHERE t."leaderId" IN (SELECT id FROM test_users)
     OR tm."userId" IN (SELECT id FROM test_users)
)
SELECT
  t.id AS team_id,
  t.name,
  leader.email AS leader_email,
  count(tm.id) AS total_members,
  count(tm.id) FILTER (WHERE tm."userId" IN (SELECT id FROM test_users)) AS test_user_members,
  count(tm.id) FILTER (WHERE tm."userId" NOT IN (SELECT id FROM test_users)) AS real_user_members,
  (count(tm.id) FILTER (WHERE tm."userId" NOT IN (SELECT id FROM test_users)) = 0) AS safe_to_delete_team
FROM candidate_teams ct
JOIN teams t ON t.id = ct.id
LEFT JOIN team_members tm ON tm."teamId" = t.id
LEFT JOIN users leader ON leader.id = t."leaderId"
GROUP BY t.id, t.name, leader.email
ORDER BY safe_to_delete_team DESC, t.name;

-- 1-5. (선택) 실행 전 전체 테이블 row 수 스냅샷 — STEP 3의 "실행 후" 스냅샷과
--      나란히 비교하면 의도치 않은 곳까지 건드리지 않았는지 눈으로 확인 가능
SELECT
  (SELECT count(*) FROM users) AS users_total,
  (SELECT count(*) FROM surveys) AS surveys_total,
  (SELECT count(*) FROM teams) AS teams_total,
  (SELECT count(*) FROM team_members) AS team_members_total,
  (SELECT count(*) FROM response_sessions) AS response_sessions_total,
  (SELECT count(*) FROM session_answers) AS session_answers_total,
  (SELECT count(*) FROM notifications) AS notifications_total;


-- ============================================================
-- STEP 2. 실제 삭제 (하나의 트랜잭션) — STEP 0/1을 확인한 뒤에만 실행할 것
-- ============================================================

BEGIN;

-- 삭제 도중 조건이 바뀌는 걸 막기 위해 대상을 임시 테이블에 먼저 고정한다
-- (예: users를 먼저 지우면 그 뒤 단계의 "테스트 유저" 조건이 깨짐).

CREATE TEMP TABLE tmp_test_users ON COMMIT DROP AS
SELECT id FROM users WHERE email ILIKE 'uftest%@example.com';

CREATE TEMP TABLE tmp_target_surveys ON COMMIT DROP AS
SELECT s.id FROM surveys s
WHERE s.title LIKE '캠퍼스 카페 이용 조사%'
   OR s.title LIKE '화면 테스트: 도서관 이용 조사 (수정)%'
   OR s."creatorId" IN (SELECT id FROM tmp_test_users);

CREATE TEMP TABLE tmp_target_sessions ON COMMIT DROP AS
SELECT rs.id, rs."surveyId"
FROM response_sessions rs
WHERE rs."surveyId" IN (SELECT id FROM tmp_target_surveys)
   OR rs."userId" IN (SELECT id FROM tmp_test_users);

-- 100% 테스트 유저로만 구성된 팀만 "삭제 안전" 처리
CREATE TEMP TABLE tmp_safe_teams ON COMMIT DROP AS
SELECT t.id
FROM teams t
WHERE (
        t."leaderId" IN (SELECT id FROM tmp_test_users)
        OR EXISTS (
          SELECT 1 FROM team_members tm
          WHERE tm."teamId" = t.id AND tm."userId" IN (SELECT id FROM tmp_test_users)
        )
      )
  AND NOT EXISTS (
        SELECT 1 FROM team_members tm
        WHERE tm."teamId" = t.id AND tm."userId" NOT IN (SELECT id FROM tmp_test_users)
      );

-- RESTRICT 제약 때문에 못 지우는 테스트 유저는 자동으로 제외한다:
--   (a) 실사용자와 공유돼서 이번에 안 지우는 팀의 팀장인 경우
--   (b) admin_action_logs.adminId로 남아있는 경우
--   (c) user_restrictions.createdByAdminId로 남아있는 경우
CREATE TEMP TABLE tmp_blocked_users ON COMMIT DROP AS
SELECT id, 'leads a team shared with real users' AS reason
FROM tmp_test_users
WHERE id IN (
  SELECT t."leaderId" FROM teams t
  WHERE t."leaderId" IN (SELECT id FROM tmp_test_users)
    AND t.id NOT IN (SELECT id FROM tmp_safe_teams)
)
UNION
SELECT id, 'referenced in admin_action_logs.adminId' AS reason
FROM tmp_test_users
WHERE id IN (SELECT "adminId" FROM admin_action_logs)
UNION
SELECT id, 'referenced in user_restrictions.createdByAdminId' AS reason
FROM tmp_test_users
WHERE id IN (SELECT "createdByAdminId" FROM user_restrictions);

CREATE TEMP TABLE tmp_deletable_users ON COMMIT DROP AS
SELECT id FROM tmp_test_users
WHERE id NOT IN (SELECT id FROM tmp_blocked_users);

-- 위에서 걸러진(스킵된) 유저가 있으면 여기 보인다 — 0건이 정상.
SELECT * FROM tmp_blocked_users;

-- 2-1. session_answers (대상 response_sessions 하위)
SELECT count(*) AS to_delete_session_answers
FROM session_answers
WHERE "sessionId" IN (SELECT id FROM tmp_target_sessions);

DELETE FROM session_answers
WHERE "sessionId" IN (SELECT id FROM tmp_target_sessions);

-- 2-2. leaderboard_scores (대상 response_sessions 하위)
SELECT count(*) AS to_delete_leaderboard_scores
FROM leaderboard_scores
WHERE "submissionId" IN (SELECT id FROM tmp_target_sessions);

DELETE FROM leaderboard_scores
WHERE "submissionId" IN (SELECT id FROM tmp_target_sessions);

-- 2-3. response_sessions (대상 설문에 대한 응답 + 테스트 유저의 모든 응답)
SELECT count(*) AS to_delete_response_sessions
FROM response_sessions
WHERE id IN (SELECT id FROM tmp_target_sessions);

DELETE FROM response_sessions
WHERE id IN (SELECT id FROM tmp_target_sessions);

-- 2-4. notifications (테스트 유저 명의)
SELECT count(*) AS to_delete_notifications
FROM notifications
WHERE "userId" IN (SELECT id FROM tmp_deletable_users);

DELETE FROM notifications
WHERE "userId" IN (SELECT id FROM tmp_deletable_users);

-- 2-5. formmate_proposed_changes / formmate_messages (대상 설문 하위)
SELECT count(*) AS to_delete_formmate_proposed_changes
FROM formmate_proposed_changes
WHERE "surveyId" IN (SELECT id FROM tmp_target_surveys);

DELETE FROM formmate_proposed_changes
WHERE "surveyId" IN (SELECT id FROM tmp_target_surveys);

SELECT count(*) AS to_delete_formmate_messages
FROM formmate_messages
WHERE "surveyId" IN (SELECT id FROM tmp_target_surveys);

DELETE FROM formmate_messages
WHERE "surveyId" IN (SELECT id FROM tmp_target_surveys);

-- 2-6. survey_options / survey_questions (대상 설문 하위)
SELECT count(*) AS to_delete_survey_options
FROM survey_options so
JOIN survey_questions sq ON sq.id = so."questionId"
WHERE sq."surveyId" IN (SELECT id FROM tmp_target_surveys);

DELETE FROM survey_options
WHERE "questionId" IN (
  SELECT id FROM survey_questions WHERE "surveyId" IN (SELECT id FROM tmp_target_surveys)
);

SELECT count(*) AS to_delete_survey_questions
FROM survey_questions
WHERE "surveyId" IN (SELECT id FROM tmp_target_surveys);

DELETE FROM survey_questions
WHERE "surveyId" IN (SELECT id FROM tmp_target_surveys);

-- 2-7. surveys (대상 설문 본체)
SELECT count(*) AS to_delete_surveys
FROM surveys
WHERE id IN (SELECT id FROM tmp_target_surveys);

DELETE FROM surveys
WHERE id IN (SELECT id FROM tmp_target_surveys);

-- 2-8. team_members (테스트 유저 본인 멤버십만 — 팀 자체는 안 건드림)
SELECT count(*) AS to_delete_team_members
FROM team_members
WHERE "userId" IN (SELECT id FROM tmp_deletable_users);

DELETE FROM team_members
WHERE "userId" IN (SELECT id FROM tmp_deletable_users);

-- 2-9. teams (100% 테스트 유저로만 구성됐던 팀만 — 실사용자와 공유된 팀은 제외)
SELECT count(*) AS to_delete_teams
FROM teams
WHERE id IN (SELECT id FROM tmp_safe_teams);

DELETE FROM teams
WHERE id IN (SELECT id FROM tmp_safe_teams);

-- 2-10. users (삭제 가능한 테스트 유저만 — tmp_blocked_users는 제외됨)
--       user_status_histories/user_profile_histories/leaderboard_rewards 등
--       나머지 종속 테이블은 ON DELETE CASCADE로 자동 정리된다.
SELECT count(*) AS to_delete_users
FROM users
WHERE id IN (SELECT id FROM tmp_deletable_users);

DELETE FROM users
WHERE id IN (SELECT id FROM tmp_deletable_users);

-- 2-11. (권장) responseCount 보정 — 테스트 유저가 "대상이 아닌 실제 설문"에
--       남긴 응답을 지웠다면, 그 설문의 responseCount(비정규화 캐시)가 실제
--       response_sessions 수와 어긋난다. 대상 설문은 이미 삭제됐으니 여기서는
--       살아남은 설문만 다시 계산한다.
SELECT s.id, s.title, s."responseCount" AS before_count,
       (SELECT count(*) FROM response_sessions rs
          WHERE rs."surveyId" = s.id AND rs.status = 'SUBMITTED') AS actual_count
FROM surveys s
WHERE s.id IN (
  SELECT DISTINCT "surveyId" FROM tmp_target_sessions
  WHERE "surveyId" NOT IN (SELECT id FROM tmp_target_surveys)
)
AND s."responseCount" <> (
  SELECT count(*) FROM response_sessions rs
  WHERE rs."surveyId" = s.id AND rs.status = 'SUBMITTED'
);

UPDATE surveys s
SET "responseCount" = (
  SELECT count(*) FROM response_sessions rs
  WHERE rs."surveyId" = s.id AND rs.status = 'SUBMITTED'
)
WHERE s.id IN (
  SELECT DISTINCT "surveyId" FROM tmp_target_sessions
  WHERE "surveyId" NOT IN (SELECT id FROM tmp_target_surveys)
);


-- ============================================================
-- STEP 3. 사후 확인 — 지울 건 지워졌고 실사용자 데이터는 그대로인지 확인
-- ============================================================

-- 3-1. 남은 테스트 유저 (tmp_blocked_users에 걸린 유저만 남아있어야 정상)
SELECT id, email FROM users WHERE email ILIKE 'uftest%@example.com';

-- 3-2. 남은 대상 설문 (0건이어야 정상)
SELECT count(*) AS remaining_target_surveys
FROM surveys
WHERE title LIKE '캠퍼스 카페 이용 조사%'
   OR title LIKE '화면 테스트: 도서관 이용 조사 (수정)%';

-- 3-3. 실행 후 전체 테이블 row 수 — STEP 1-5 스냅샷과 비교
SELECT
  (SELECT count(*) FROM users) AS users_total,
  (SELECT count(*) FROM surveys) AS surveys_total,
  (SELECT count(*) FROM teams) AS teams_total,
  (SELECT count(*) FROM team_members) AS team_members_total,
  (SELECT count(*) FROM response_sessions) AS response_sessions_total,
  (SELECT count(*) FROM session_answers) AS session_answers_total,
  (SELECT count(*) FROM notifications) AS notifications_total;

-- 여기까지 결과를 눈으로 확인한 뒤 아래 둘 중 하나를 실행할 것.
-- 이상 없으면:
--   COMMIT;
-- 뭔가 잘못됐으면:
--   ROLLBACK;
