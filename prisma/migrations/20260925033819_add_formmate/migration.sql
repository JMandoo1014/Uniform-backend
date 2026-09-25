-- CreateEnum
CREATE TYPE "FormMateMessageRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "FormMateChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'REVERTED', 'REJECTED');

-- CreateTable
CREATE TABLE "formmate_messages" (
    "id" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "FormMateMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formmate_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formmate_proposed_changes" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "surveyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "status" "FormMateChangeStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "formmate_proposed_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "formmate_messages_surveyId_createdAt_idx" ON "formmate_messages"("surveyId", "createdAt");

-- AddForeignKey
ALTER TABLE "formmate_messages" ADD CONSTRAINT "formmate_messages_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formmate_proposed_changes" ADD CONSTRAINT "formmate_proposed_changes_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "formmate_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formmate_proposed_changes" ADD CONSTRAINT "formmate_proposed_changes_surveyId_fkey" FOREIGN KEY ("surveyId") REFERENCES "surveys"("id") ON DELETE CASCADE ON UPDATE CASCADE;
