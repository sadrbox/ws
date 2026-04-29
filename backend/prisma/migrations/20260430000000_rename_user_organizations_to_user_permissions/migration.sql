-- Rename table user_organizations → user_permissions
ALTER TABLE "user_organizations" RENAME TO "user_permissions";

-- Rename constraints and indexes
ALTER INDEX "user_organizations_uuid_key" RENAME TO "user_permissions_uuid_key";
ALTER INDEX "user_organizations_userUuid_organizationUuid_key" RENAME TO "user_permissions_userUuid_organizationUuid_key";
ALTER INDEX "user_organizations_userUuid_idx" RENAME TO "user_permissions_userUuid_idx";
ALTER INDEX "user_organizations_organizationUuid_idx" RENAME TO "user_permissions_organizationUuid_idx";
ALTER INDEX "user_organizations_updatedAt_idx" RENAME TO "user_permissions_updatedAt_idx";

ALTER TABLE "user_permissions" RENAME CONSTRAINT "user_organizations_pkey" TO "user_permissions_pkey";
ALTER TABLE "user_permissions" RENAME CONSTRAINT "user_organizations_userUuid_fkey" TO "user_permissions_userUuid_fkey";
ALTER TABLE "user_permissions" RENAME CONSTRAINT "user_organizations_organizationUuid_fkey" TO "user_permissions_organizationUuid_fkey";
