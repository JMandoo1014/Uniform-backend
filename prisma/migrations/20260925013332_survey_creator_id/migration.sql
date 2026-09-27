-- Spec 3.1 "팀 초안 삭제는 팀장 또는 만든 사람만": Survey.ownerId is the team for a
-- team-owned survey, so the original author needs its own creatorId column.
--
-- Added nullable first so it can be back-filled before the NOT NULL constraint
-- goes on. Existing rows are all ownerType=USER (any leftover ownerType=TEAM
-- rows were pre-launch test data with no recoverable creator and were deleted
-- by hand before this migration was written) — for those, creatorId is simply
-- the same person as ownerId.
--
-- If this fails on the SET NOT NULL step in another environment, it means
-- that database still has an ownerType=TEAM survey with no way to know who
-- created it — stop and fill/remove those rows before re-running.
ALTER TABLE "surveys" ADD COLUMN "creatorId" TEXT;

UPDATE "surveys" SET "creatorId" = "ownerId" WHERE "ownerType" = 'USER';

ALTER TABLE "surveys" ALTER COLUMN "creatorId" SET NOT NULL;
