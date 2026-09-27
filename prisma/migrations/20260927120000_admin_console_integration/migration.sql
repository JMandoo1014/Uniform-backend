-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'TEAM_NAME_FORCED';

-- AlterTable: 운영팀 구성원 계정(spec 6.3/11)
ALTER TABLE "users" ADD COLUMN     "isStaff" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: 보상 안내를 제목/설명/1~3위 보상/동점 규칙으로 — 기존 보상 문구는 설명(body)으로 옮긴다.
ALTER TABLE "leaderboard_config" ADD COLUMN     "body" TEXT NOT NULL DEFAULT '보상은 추후 공지',
ADD COLUMN     "tiers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '주간 보상 안내';
UPDATE "leaderboard_config" SET "body" = "rewardText";
ALTER TABLE "leaderboard_config" DROP COLUMN "rewardText";

-- AlterTable: 보상 행을 "대상 확정 → 순위별 발송 기록" 흐름에 맞춘다.
ALTER TABLE "leaderboard_rewards" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "couponType" DROP NOT NULL,
ALTER COLUMN "sentAt" DROP NOT NULL,
ALTER COLUMN "sentAt" DROP DEFAULT,
ALTER COLUMN "sentByAdminId" DROP NOT NULL;

-- 예전 일괄 발송은 동점자에게 같은 순위를 줬다 — (weekStart, rank) unique를
-- 걸기 전에 주차별로 1, 2, 3… 자리 번호를 다시 매긴다.
UPDATE "leaderboard_rewards" AS r
SET "rank" = s."slot"
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "weekStart" ORDER BY "rank", "sentAt", "id") AS "slot"
  FROM "leaderboard_rewards"
) AS s
WHERE r."id" = s."id";

-- AlterTable
ALTER TABLE "admin_action_logs" ADD COLUMN     "afterValue" TEXT,
ADD COLUMN     "beforeValue" TEXT,
ADD COLUMN     "targetName" TEXT;

-- CreateTable
CREATE TABLE "leaderboard_reward_weeks" (
    "weekStart" TIMESTAMP(3) NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leaderboard_reward_weeks_pkey" PRIMARY KEY ("weekStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_rewards_weekStart_rank_key" ON "leaderboard_rewards"("weekStart", "rank");
