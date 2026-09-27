/*
  Warnings:

  - You are about to drop the column `targetQuestionId` on the `formmate_proposed_changes` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "formmate_proposed_changes" DROP COLUMN "targetQuestionId",
ADD COLUMN     "targetStableKey" TEXT;
