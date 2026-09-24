-- AlterTable
ALTER TABLE "users" ADD COLUMN     "marketingOptInChangedAt" TIMESTAMP(3),
ALTER COLUMN "email" DROP NOT NULL,
ALTER COLUMN "nickname" DROP NOT NULL,
ALTER COLUMN "gender" DROP NOT NULL,
ALTER COLUMN "grade" DROP NOT NULL,
ALTER COLUMN "majorField" DROP NOT NULL,
ALTER COLUMN "enrollmentStatus" DROP NOT NULL;

-- CreateTable
CREATE TABLE "user_profile_histories" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_profile_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawn_emails" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "withdrawnAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "withdrawn_emails_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_profile_histories_userId_idx" ON "user_profile_histories"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "withdrawn_emails_emailHash_key" ON "withdrawn_emails"("emailHash");

-- AddForeignKey
ALTER TABLE "user_profile_histories" ADD CONSTRAINT "user_profile_histories_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

