-- Заметки к записи (документ/справочник). Основание для задач.
CREATE TABLE "notes" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityUuid" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "organizationUuid" TEXT,
    "authorUuid" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notes_uuid_key" ON "notes"("uuid");
CREATE INDEX "notes_entityType_entityUuid_idx" ON "notes"("entityType", "entityUuid");
CREATE INDEX "notes_organizationUuid_idx" ON "notes"("organizationUuid");
CREATE INDEX "notes_authorUuid_idx" ON "notes"("authorUuid");
