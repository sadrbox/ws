-- DropForeignKey
ALTER TABLE "activity_history" DROP CONSTRAINT "activity_history_organizationUuid_fkey";



-- AlterTable
ALTER TABLE "activity_history" ADD COLUMN     "diff" JSONB,
ADD COLUMN     "userUuid" TEXT,
ALTER COLUMN "organizationUuid" DROP NOT NULL,
ALTER COLUMN "organizationShortName" DROP NOT NULL,
ALTER COLUMN "bin" DROP NOT NULL,
ALTER COLUMN "host" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "activity_history_userUuid_idx" ON "activity_history"("userUuid");

-- AddForeignKey
ALTER TABLE "activity_history" ADD CONSTRAINT "activity_history_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

