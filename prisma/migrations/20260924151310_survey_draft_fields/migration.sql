-- AlterTable
ALTER TABLE "surveys" ALTER COLUMN "targetCount" DROP NOT NULL;

-- AlterTable
ALTER TABLE "survey_questions" ADD COLUMN     "maxScaleLabel" TEXT,
ADD COLUMN     "minScaleLabel" TEXT;

-- AlterTable
ALTER TABLE "survey_options" ADD COLUMN     "isEtc" BOOLEAN NOT NULL DEFAULT false;

