-- AlterTable
ALTER TABLE "users" ADD COLUMN     "termsAgreedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 동의 시각을 따로 기록하기 전 회원은 가입 시각(= 가입 때 약관 동의)으로 채운다.
UPDATE "users" SET "termsAgreedAt" = "createdAt";
