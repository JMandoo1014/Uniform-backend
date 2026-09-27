-- CreateEnum
CREATE TYPE "ResponseSessionStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SURVEY_CLOSED', 'TEAM_JOINED', 'TEAM_SURVEY_PUBLISHED', 'TEAM_LEADER_CHANGED', 'TEAM_DISBANDED', 'SEASON_ENDED', 'REWARD_SELECTED', 'REWARD_SENT', 'PURGE_WARNING', 'SURVEY_REMOVED', 'ACCOUNT_RESTRICTED', 'NICKNAME_FORCED');

-- AlterTable
ALTER TABLE "surveys" ADD COLUMN     "responseCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "response_sessions" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "ResponseSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "sameScaleWarningAcknowledged" BOOLEAN NOT NULL DEFAULT false,
    "excludedAt" TIMESTAMP(3),
    "excludedReason" TEXT,
    "excludedByAdminId" TEXT,

    CONSTRAINT "response_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_answers" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_scores" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "revokedByAdminId" TEXT,

    CONSTRAINT "leaderboard_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "rewardText" TEXT NOT NULL DEFAULT '보상은 추후 공지',
    "tieRuleText" TEXT NOT NULL DEFAULT '동점자의 보상 대상자는 무작위 추첨으로 선정됩니다.',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByAdminId" TEXT,

    CONSTRAINT "leaderboard_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_lotteries" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "result" JSONB NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executedByAdminId" TEXT NOT NULL,

    CONSTRAINT "leaderboard_lotteries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaderboard_rewards" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "rank" INTEGER NOT NULL,
    "couponType" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentByAdminId" TEXT NOT NULL,

    CONSTRAINT "leaderboard_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "message" TEXT NOT NULL,
    "targetUrl" TEXT,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_action_logs" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_action_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_restrictions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "durationDays" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "liftedAt" TIMESTAMP(3),
    "liftedReason" TEXT,
    "createdByAdminId" TEXT NOT NULL,

    CONSTRAINT "user_restrictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "response_sessions_userId_idx" ON "response_sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "response_sessions_surveyId_userId_key" ON "response_sessions"("surveyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_answers_sessionId_questionId_key" ON "session_answers"("sessionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_scores_submissionId_key" ON "leaderboard_scores"("submissionId");

-- CreateIndex
CREATE INDEX "leaderboard_scores_weekStart_userId_idx" ON "leaderboard_scores"("weekStart", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_lotteries_weekStart_key" ON "leaderboard_lotteries"("weekStart");

-- CreateIndex
CREATE INDEX "leaderboard_rewards_weekStart_idx" ON "leaderboard_rewards"("weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_rewards_userId_weekStart_key" ON "leaderboard_rewards"("userId", "weekStart");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "admin_action_logs_targetType_targetId_idx" ON "admin_action_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "user_restrictions_userId_idx" ON "user_restrictions"("userId");

-- AddForeignKey
ALTER TABLE "response_sessions" ADD CONSTRAINT "response_sessions_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_sessions" ADD CONSTRAINT "response_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_answers" ADD CONSTRAINT "session_answers_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "response_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_scores" ADD CONSTRAINT "leaderboard_scores_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_scores" ADD CONSTRAINT "leaderboard_scores_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "response_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_rewards" ADD CONSTRAINT "leaderboard_rewards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_action_logs" ADD CONSTRAINT "admin_action_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_restrictions" ADD CONSTRAINT "user_restrictions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_restrictions" ADD CONSTRAINT "user_restrictions_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
