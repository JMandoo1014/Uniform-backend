-- AlterTable
ALTER TABLE "inquiries" ADD COLUMN     "answeredAt" TIMESTAMP(3);

-- 처리 완료 시각을 기록하기 전에 ANSWERED가 된 문의는 정확한 시각을 알 수
-- 없으므로 접수 시각으로 채운다(보유 기간이 실제보다 짧게 잡히는 쪽).
UPDATE "inquiries" SET "answeredAt" = "createdAt" WHERE "status" = 'ANSWERED';

-- CreateTable
CREATE TABLE "scheduled_job_runs" (
    "jobName" TEXT NOT NULL,
    "runDate" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "scheduled_job_runs_pkey" PRIMARY KEY ("jobName","runDate")
);
