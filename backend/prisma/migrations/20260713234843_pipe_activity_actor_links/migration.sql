-- События 1С ссылаются на РЕАЛЬНЫЕ объекты системы (организация, пользователь),
-- а не только хранят их имена строками. ON DELETE SET NULL: удаление организации
-- или пользователя не должно уносить журнал событий.
-- AlterTable
ALTER TABLE "pipe_activity" ADD COLUMN     "organizationUuid" TEXT,
ADD COLUMN     "userUuid" TEXT;

-- CreateIndex
CREATE INDEX "pipe_activity_organizationUuid_idx" ON "pipe_activity"("organizationUuid");

-- CreateIndex
CREATE INDEX "pipe_activity_userUuid_idx" ON "pipe_activity"("userUuid");

-- AddForeignKey
ALTER TABLE "pipe_activity" ADD CONSTRAINT "pipe_activity_organizationUuid_fkey" FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipe_activity" ADD CONSTRAINT "pipe_activity_userUuid_fkey" FOREIGN KEY ("userUuid") REFERENCES "users"("uuid") ON DELETE SET NULL ON UPDATE CASCADE;

