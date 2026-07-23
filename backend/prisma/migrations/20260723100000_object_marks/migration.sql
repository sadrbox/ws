-- Метки: ссылки на объекты, прикреплённые к произвольной записи (многие-ко-многим
-- через полиморфную пару). Уникальность пары «владелец → цель» гасит дубли,
-- индекс по цели даёт обратный поиск «кто ссылается на этот объект».
CREATE TABLE "object_marks" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerUuid" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetUuid" TEXT NOT NULL,
    "targetLabel" TEXT,
    "organizationUuid" TEXT,
    "authorUuid" TEXT,
    "authorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "object_marks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "object_marks_uuid_key" ON "object_marks"("uuid");
CREATE UNIQUE INDEX "object_marks_owner_target_key" ON "object_marks"("ownerType", "ownerUuid", "targetType", "targetUuid");
CREATE INDEX "object_marks_ownerType_ownerUuid_idx" ON "object_marks"("ownerType", "ownerUuid");
CREATE INDEX "object_marks_targetType_targetUuid_idx" ON "object_marks"("targetType", "targetUuid");
CREATE INDEX "object_marks_organizationUuid_idx" ON "object_marks"("organizationUuid");
