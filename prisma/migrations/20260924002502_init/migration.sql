-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'RESTRICTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ENROLLED', 'LEAVE_OF_ABSENCE', 'GRADUATED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "GradeLevel" AS ENUM ('FRESHMAN', 'SOPHOMORE', 'JUNIOR', 'SENIOR_OR_ABOVE', 'GRADUATE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "MajorField" AS ENUM ('HUMANITIES_SOCIAL', 'BUSINESS', 'ENGINEERING', 'NATURAL_SCIENCE', 'MEDICINE', 'ARTS_SPORTS', 'EDUCATION', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "SurveyOwnerType" AS ENUM ('USER', 'TEAM');

-- CreateEnum
CREATE TYPE "SurveyStatus" AS ENUM ('DRAFT', 'RECRUITING', 'CLOSED', 'ARCHIVED', 'REMOVED');

-- CreateEnum
CREATE TYPE "SurveyQuestionType" AS ENUM ('SINGLE_CHOICE', 'MULTI_CHOICE', 'SCALE', 'SHORT_ANSWER', 'NARRATIVE', 'ETC');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "grade" "GradeLevel" NOT NULL,
    "majorField" "MajorField" NOT NULL,
    "enrollmentStatus" "EnrollmentStatus" NOT NULL,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "agreedTermsVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "emailVerificationToken" TEXT,
    "emailVerificationTokenExpiresAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_status_histories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL,
    "reason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_status_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "inviteToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disbandedAt" TIMESTAMP(3),

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surveys" (
    "id" TEXT NOT NULL,
    "ownerType" "SurveyOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "SurveyStatus" NOT NULL DEFAULT 'DRAFT',
    "targetCount" INTEGER NOT NULL,
    "deadlineAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "purgeAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_questions" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "orderNo" INTEGER NOT NULL,
    "stableKey" TEXT NOT NULL,
    "type" "SurveyQuestionType" NOT NULL,
    "questionText" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "minSelect" INTEGER,
    "maxSelect" INTEGER,
    "minScale" INTEGER,
    "maxScale" INTEGER,

    CONSTRAINT "survey_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_options" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "orderNo" INTEGER NOT NULL,
    "label" TEXT NOT NULL,

    CONSTRAINT "survey_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_nickname_key" ON "users"("nickname");

-- CreateIndex
CREATE UNIQUE INDEX "users_emailVerificationToken_key" ON "users"("emailVerificationToken");

-- CreateIndex
CREATE INDEX "user_status_histories_userId_idx" ON "user_status_histories"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_inviteToken_key" ON "teams"("inviteToken");

-- CreateIndex
CREATE INDEX "teams_leaderId_idx" ON "teams"("leaderId");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_teamId_userId_key" ON "team_members"("teamId", "userId");

-- CreateIndex
CREATE INDEX "surveys_ownerType_ownerId_idx" ON "surveys"("ownerType", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "survey_questions_surveyId_stableKey_key" ON "survey_questions"("surveyId", "stableKey");

-- CreateIndex
CREATE UNIQUE INDEX "survey_questions_surveyId_orderNo_key" ON "survey_questions"("surveyId", "orderNo");

-- CreateIndex
CREATE UNIQUE INDEX "survey_options_questionId_orderNo_key" ON "survey_options"("questionId", "orderNo");

-- AddForeignKey
ALTER TABLE "user_status_histories" ADD CONSTRAINT "user_status_histories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_questions" ADD CONSTRAINT "survey_questions_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "survey_options" ADD CONSTRAINT "survey_options_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "survey_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

