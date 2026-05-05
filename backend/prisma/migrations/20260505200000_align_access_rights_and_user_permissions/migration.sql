-- Align migration history with actual database state.
-- These changes were applied directly to the database earlier (during multi-tenant
-- refactor and access-rights composite-key work) but never recorded as a migration.
-- All statements are idempotent so the migration is safe to (re-)apply.

-- 1) access_rights: replace the two partial unique indexes
--    (userUuid, organizationUuid, modelName) WHERE organizationUuid IS NOT NULL
--    (userUuid, modelName)                   WHERE organizationUuid IS NULL
--    with a single non-partial unique index that matches schema.prisma's @@unique declaration.
DROP INDEX IF EXISTS "access_rights_userUuid_organizationUuid_modelName_key";
DROP INDEX IF EXISTS "access_rights_userUuid_null_org_modelName_key";
DROP INDEX IF EXISTS "access_rights_userUuid_modelName_key";

CREATE UNIQUE INDEX "access_rights_userUuid_organizationUuid_modelName_key"
    ON "access_rights" ("userUuid", "organizationUuid", "modelName");

-- 2) user_permissions: drop legacy default on uuid (uuids are now generated in the application layer)
ALTER TABLE "user_permissions" ALTER COLUMN "uuid" DROP DEFAULT;
