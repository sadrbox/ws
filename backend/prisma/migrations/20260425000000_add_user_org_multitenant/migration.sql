-- CreateTable: user_organizations (many-to-many users <-> organizations with role)
CREATE TABLE "user_organizations" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "userUuid" TEXT NOT NULL,
    "organizationUuid" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_organizations_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: один пользователь — одна запись на организацию
CREATE UNIQUE INDEX "user_organizations_uuid_key" ON "user_organizations"("uuid");
CREATE UNIQUE INDEX "user_organizations_userUuid_organizationUuid_key" ON "user_organizations"("userUuid", "organizationUuid");
CREATE INDEX "user_organizations_userUuid_idx" ON "user_organizations"("userUuid");
CREATE INDEX "user_organizations_organizationUuid_idx" ON "user_organizations"("organizationUuid");
CREATE INDEX "user_organizations_updatedAt_idx" ON "user_organizations"("updatedAt");

-- FK constraints
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_userUuid_fkey"
    FOREIGN KEY ("userUuid") REFERENCES "users"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_organizationUuid_fkey"
    FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: access_rights — добавить organizationUuid
ALTER TABLE "access_rights" ADD COLUMN "organizationUuid" TEXT;
CREATE INDEX "access_rights_organizationUuid_idx" ON "access_rights"("organizationUuid");

-- Удаляем старый уникальный индекс [userUuid, modelName]
DROP INDEX IF EXISTS "access_rights_userUuid_modelName_key";

-- Новый уникальный индекс с учётом организации
-- NULL-значения в PostgreSQL не нарушают UNIQUE, поэтому используем partial unique index
CREATE UNIQUE INDEX "access_rights_userUuid_organizationUuid_modelName_key"
    ON "access_rights"("userUuid", "organizationUuid", "modelName")
    WHERE "organizationUuid" IS NOT NULL;

CREATE UNIQUE INDEX "access_rights_userUuid_null_org_modelName_key"
    ON "access_rights"("userUuid", "modelName")
    WHERE "organizationUuid" IS NULL;

-- FK для access_rights.organizationUuid
ALTER TABLE "access_rights" ADD CONSTRAINT "access_rights_organizationUuid_fkey"
    FOREIGN KEY ("organizationUuid") REFERENCES "organizations"("uuid") ON DELETE CASCADE ON UPDATE CASCADE;

-- Заполнить user_organizations из существующих user.organizationUuid
-- (переносим текущую привязку как запись со стандартной ролью "member")
INSERT INTO "user_organizations" ("userUuid", "organizationUuid", "role")
SELECT "uuid", "organizationUuid", 'member'
FROM "users"
WHERE "organizationUuid" IS NOT NULL
ON CONFLICT DO NOTHING;
